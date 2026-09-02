-- =============================================================================
-- Meme Farm — in-app support chat
--   * support_messages  — one row per message (USER / ADMIN)
--   * support_threads    — one row per user: last activity, unread counters
--   RLS: a user reads only their own messages/thread and sends only via
--   support_send() (sender is forced to 'USER'). Admin reads every thread and
--   replies to ONE user via admin_support_reply() — never a broadcast.
--   An admin reply also enqueues a SUPPORT_REPLY push to that user's bot chat.
-- =============================================================================

-- SUPPORT_REPLY push type ---------------------------------------------------
alter table public.event_queue drop constraint if exists event_queue_type_check;
alter table public.event_queue
  add constraint event_queue_type_check
  check (type in ('FARM_READY', 'PVP_ATTACK', 'REFERRAL_INCOME', 'DEPOSIT', 'SUPPORT_REPLY'));

-- 1. TABLES ---------------------------------------------------------------
create table if not exists public.support_threads (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  status          text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  last_message_at timestamptz not null default now(),
  last_preview    text not null default '',
  last_sender     text not null default 'USER' check (last_sender in ('USER', 'ADMIN')),
  unread_admin    integer not null default 0,   -- unseen USER messages
  unread_user     integer not null default 0,   -- unseen ADMIN messages
  created_at      timestamptz not null default now()
);
create index if not exists support_threads_activity_idx
  on public.support_threads (last_message_at desc);

create table if not exists public.support_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  sender        text not null check (sender in ('USER', 'ADMIN')),
  body          text not null,
  read_by_user  boolean not null default false,
  read_by_admin boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists support_messages_thread_idx
  on public.support_messages (user_id, created_at);

-- 2. RLS ----------------------------------------------------------------
alter table public.support_threads  enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "support_threads_select_own" on public.support_threads;
create policy "support_threads_select_own" on public.support_threads
  for select using (auth.uid() = user_id);

drop policy if exists "support_messages_select_own" on public.support_messages;
create policy "support_messages_select_own" on public.support_messages
  for select using (auth.uid() = user_id);

-- no client writes: everything goes through the SECURITY DEFINER RPCs below
grant select on public.support_threads  to authenticated;
grant select on public.support_messages to authenticated;

-- 3. helper: touch the thread ----------------------------------------------
create or replace function public._support_touch(
  p_user_id uuid,
  p_sender  text,
  p_body    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.support_threads (user_id, status, last_message_at, last_preview, last_sender,
                                      unread_admin, unread_user)
  values (p_user_id, 'OPEN', now(), left(p_body, 120), p_sender,
          case when p_sender = 'USER'  then 1 else 0 end,
          case when p_sender = 'ADMIN' then 1 else 0 end)
  on conflict (user_id) do update set
    status          = 'OPEN',
    last_message_at = now(),
    last_preview    = left(p_body, 120),
    last_sender     = p_sender,
    unread_admin    = case when p_sender = 'USER'
                           then public.support_threads.unread_admin + 1
                           else public.support_threads.unread_admin end,
    unread_user     = case when p_sender = 'ADMIN'
                           then public.support_threads.unread_user + 1
                           else public.support_threads.unread_user end;
end;
$$;

-- 4. user: send a message ------------------------------------------------
create or replace function public.support_send(p_body text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_body text := btrim(p_body);
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'empty message' using errcode = '22023';
  end if;
  v_body := left(v_body, 2000);

  insert into public.support_messages (user_id, sender, body, read_by_user)
  values (v_uid, 'USER', v_body, true);

  perform public._support_touch(v_uid, 'USER', v_body);
end;
$$;

-- 5. user: mark admin replies as read ----------------------------------------
create or replace function public.support_mark_read()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.support_messages
  set read_by_user = true
  where user_id = v_uid and sender = 'ADMIN' and read_by_user = false;
  update public.support_threads set unread_user = 0 where user_id = v_uid;
end;
$$;

-- 6. admin: list threads ------------------------------------------------
create or replace function public.admin_support_threads(p_admin_id uuid)
returns table (
  user_id      uuid,
  username     text,
  first_name   text,
  telegram_id  bigint,
  status       text,
  last_message_at timestamptz,
  last_preview text,
  last_sender  text,
  unread_admin integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  return query
  select th.user_id, p.username, p.first_name, p.telegram_id, th.status,
         th.last_message_at, th.last_preview, th.last_sender, th.unread_admin
  from public.support_threads th
  join public.profiles p on p.id = th.user_id
  order by th.last_message_at desc
  limit 300;
end;
$$;

-- 7. admin: read one user's messages (+ mark seen) -------------------------
create or replace function public.admin_support_messages(p_admin_id uuid, p_user_id uuid)
returns table (
  id         uuid,
  sender     text,
  body       text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  update public.support_messages
  set read_by_admin = true
  where support_messages.user_id = p_user_id and sender = 'USER' and read_by_admin = false;
  update public.support_threads set unread_admin = 0 where support_threads.user_id = p_user_id;

  return query
  select m.id, m.sender, m.body, m.created_at
  from public.support_messages m
  where m.user_id = p_user_id
  order by m.created_at;
end;
$$;

-- 8. admin: reply to ONE user (+ push to their bot chat) -------------------
create or replace function public.admin_support_reply(
  p_admin_id uuid,
  p_user_id  uuid,
  p_body     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text := left(btrim(p_body), 2000);
  v_lang text;
begin
  perform public._assert_admin(p_admin_id);
  if v_body = '' then
    raise exception 'empty reply' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user % not found', p_user_id using errcode = 'P0002';
  end if;

  insert into public.support_messages (user_id, sender, body, read_by_admin)
  values (p_user_id, 'ADMIN', v_body, true);

  perform public._support_touch(p_user_id, 'ADMIN', v_body);

  select coalesce(notif_prefs ->> 'lang', 'uk') into v_lang
  from public.profiles where id = p_user_id;

  insert into public.event_queue (user_id, type, metadata)
  values (p_user_id, 'SUPPORT_REPLY',
          jsonb_build_object('lang', v_lang, 'preview', left(v_body, 160)));
end;
$$;

-- 9. admin: open / close a thread -------------------------------------------
create or replace function public.admin_support_set_status(
  p_admin_id uuid,
  p_user_id  uuid,
  p_status   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  if p_status not in ('OPEN', 'CLOSED') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;
  update public.support_threads set status = p_status where user_id = p_user_id;
  if not found then
    raise exception 'thread % not found', p_user_id using errcode = 'P0002';
  end if;
end;
$$;

-- 10. GRANTS ----------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'support_send(text)',
    'support_mark_read()',
    'admin_support_threads(uuid)',
    'admin_support_messages(uuid, uuid)',
    'admin_support_reply(uuid, uuid, text)',
    'admin_support_set_status(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;

revoke all on function public._support_touch(uuid, text, text) from public, anon, authenticated;
