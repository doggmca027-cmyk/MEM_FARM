-- =============================================================================
-- Meme Farm — Ambassador module
--   * ambassador_applications  — channel applications (PENDING/APPROVED/REJECTED)
--   * ambassador_posts         — publication reports (PENDING/APPROVED/REJECTED)
--   * admin_grant_ambassador_deposit()  — promo credit, NO referral cascade
--   * admin_get_ambassador_stats()      — approved ambassadors + L1/L2/L3 rollup
--   * admin list / review RPCs for both tables
--   RLS: a user reads + inserts only their own rows (auth.uid() = user_id);
--   status / admin_comment are not client-writable (column-level grants);
--   every status change + the deposit go through SECURITY DEFINER admin RPCs.
-- =============================================================================

-- new ledger / transaction type -----------------------------------------------
alter table public.ledger_entries drop constraint if exists ledger_entries_transaction_type_check;
alter table public.ledger_entries
  add constraint ledger_entries_transaction_type_check check (transaction_type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE',
    'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD',
    'REFUND', 'WAGER_STAKE', 'WAGER_PAYOUT', 'AMBASSADOR_REWARD'
  ));

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE',
    'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD',
    'REFUND', 'WAGER_STAKE', 'WAGER_PAYOUT', 'AMBASSADOR_REWARD'
  ));

-- -----------------------------------------------------------------------------
-- 1. TABLES
-- -----------------------------------------------------------------------------
create table if not exists public.ambassador_applications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  channel_link     text not null,
  contact_username text not null,
  status           text not null default 'PENDING'
                     check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at       timestamptz not null default now()
);
create index if not exists ambassador_applications_user_idx
  on public.ambassador_applications (user_id, created_at desc);
create index if not exists ambassador_applications_status_idx
  on public.ambassador_applications (status) where status = 'PENDING';
-- at most one live (pending / approved) application per user; re-apply after reject
create unique index if not exists ambassador_applications_active_uidx
  on public.ambassador_applications (user_id)
  where status in ('PENDING', 'APPROVED');

create table if not exists public.ambassador_posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  post_link     text not null,
  status        text not null default 'PENDING'
                  check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  admin_comment text,
  created_at    timestamptz not null default now()
);
create index if not exists ambassador_posts_user_idx
  on public.ambassador_posts (user_id, created_at desc);
create index if not exists ambassador_posts_status_idx
  on public.ambassador_posts (status) where status = 'PENDING';

-- -----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY  (read-own + insert-own only)
-- -----------------------------------------------------------------------------
alter table public.ambassador_applications enable row level security;
alter table public.ambassador_posts        enable row level security;

drop policy if exists "amb_app_select_own" on public.ambassador_applications;
create policy "amb_app_select_own" on public.ambassador_applications
  for select using (auth.uid() = user_id);
drop policy if exists "amb_app_insert_own" on public.ambassador_applications;
create policy "amb_app_insert_own" on public.ambassador_applications
  for insert with check (auth.uid() = user_id);

drop policy if exists "amb_post_select_own" on public.ambassador_posts;
create policy "amb_post_select_own" on public.ambassador_posts
  for select using (auth.uid() = user_id);
drop policy if exists "amb_post_insert_own" on public.ambassador_posts;
create policy "amb_post_insert_own" on public.ambassador_posts
  for insert with check (auth.uid() = user_id);

-- no UPDATE / DELETE policy → clients can never change status or admin_comment.
-- Column-level INSERT grants keep `status` / `admin_comment` server-only too.
grant select on public.ambassador_applications to authenticated;
grant insert (user_id, channel_link, contact_username)
  on public.ambassador_applications to authenticated;
grant select on public.ambassador_posts to authenticated;
grant insert (user_id, post_link) on public.ambassador_posts to authenticated;

-- -----------------------------------------------------------------------------
-- 3. admin_grant_ambassador_deposit — promo credit, NO referral cascade
-- -----------------------------------------------------------------------------
create or replace function public.admin_grant_ambassador_deposit(
  p_user_id uuid,
  p_amount  numeric
)
returns table (new_available_gram numeric(18, 9))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric(18, 9);
begin
  perform public._assert_admin(auth.uid());

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount %', p_amount using errcode = '22023';
  end if;

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;

  -- lock this user's balance row for the credit
  select available_gram into v_balance
  from public.balances where user_id = p_user_id for update;
  if not found then
    raise exception 'no balance for user %', p_user_id using errcode = 'P0002';
  end if;

  update public.balances
  set available_gram = available_gram + p_amount, updated_at = now()
  where user_id = p_user_id
  returning available_gram into v_balance;

  -- double-entry credit — AMBASSADOR_REWARD is intentionally NOT a fee-taking
  -- event: process_referral_commission() is never called, so pried L1/L2/L3
  -- inviters receive nothing from a promo grant.
  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'AMBASSADOR_REWARD', 'CREDIT', p_amount, 0, 'GRAM',
          jsonb_build_object('source', 'ambassador_promo', 'granted_by', auth.uid()));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'AMBASSADOR_REWARD', p_amount, 0, p_amount, 'COMPLETED');

  new_available_gram := v_balance;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. admin_get_ambassador_stats — approved ambassadors + 3-level rollup
--    Only L1 edges are stored (one referrals row per referee); L2 / L3 are
--    found by walking referrer_id -> referee_id.
-- -----------------------------------------------------------------------------
create or replace function public.admin_get_ambassador_stats()
returns table (
  user_id          uuid,
  username         text,
  channel_link     text,
  l1_count         integer,
  l2_count         integer,
  l3_count         integer,
  l1_deposit_total numeric,
  l2_deposit_total numeric,
  l3_deposit_total numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(auth.uid());

  return query
  with amb as (
    select distinct on (a.user_id) a.user_id, a.channel_link
    from public.ambassador_applications a
    where a.status = 'APPROVED'
    order by a.user_id, a.created_at desc
  ),
  l1 as (
    select amb.user_id as amb_id, r.referee_id as uid
    from amb
    join public.referrals r on r.referrer_id = amb.user_id
  ),
  l2 as (
    select l1.amb_id, r.referee_id as uid
    from l1
    join public.referrals r on r.referrer_id = l1.uid
  ),
  l3 as (
    select l2.amb_id, r.referee_id as uid
    from l2
    join public.referrals r on r.referrer_id = l2.uid
  ),
  dep as (
    select t.user_id as uid, sum(t.amount) as total
    from public.transactions t
    where t.type = 'DEPOSIT' and t.status = 'COMPLETED'
    group by t.user_id
  )
  select
    amb.user_id,
    coalesce(nullif(p.username, ''), 'id:' || right(amb.user_id::text, 4)) as username,
    amb.channel_link,
    (select count(*) from l1 where l1.amb_id = amb.user_id)::int,
    (select count(*) from l2 where l2.amb_id = amb.user_id)::int,
    (select count(*) from l3 where l3.amb_id = amb.user_id)::int,
    coalesce((select sum(dep.total) from l1 join dep on dep.uid = l1.uid where l1.amb_id = amb.user_id), 0),
    coalesce((select sum(dep.total) from l2 join dep on dep.uid = l2.uid where l2.amb_id = amb.user_id), 0),
    coalesce((select sum(dep.total) from l3 join dep on dep.uid = l3.uid where l3.amb_id = amb.user_id), 0)
  from amb
  join public.profiles p on p.id = amb.user_id
  order by amb.channel_link;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. admin list / review RPCs
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_ambassador_applications()
returns table (
  id               uuid,
  user_id          uuid,
  username         text,
  first_name       text,
  telegram_id      bigint,
  balance_gram     numeric,
  channel_link     text,
  contact_username text,
  status           text,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(auth.uid());
  return query
  select a.id, a.user_id, p.username, p.first_name, p.telegram_id,
         coalesce(b.available_gram, 0), a.channel_link, a.contact_username,
         a.status, a.created_at
  from public.ambassador_applications a
  join public.profiles p on p.id = a.user_id
  left join public.balances b on b.user_id = a.user_id
  order by (a.status = 'PENDING') desc, a.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_set_ambassador_application_status(
  p_id     uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(auth.uid());
  if p_status not in ('APPROVED', 'REJECTED', 'PENDING') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;
  update public.ambassador_applications
  set status = p_status
  where id = p_id;
  if not found then
    raise exception 'application % not found', p_id using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_list_ambassador_posts()
returns table (
  id            uuid,
  user_id       uuid,
  username      text,
  first_name    text,
  post_link     text,
  status        text,
  admin_comment text,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(auth.uid());
  return query
  select po.id, po.user_id, p.username, p.first_name, po.post_link,
         po.status, po.admin_comment, po.created_at
  from public.ambassador_posts po
  join public.profiles p on p.id = po.user_id
  order by (po.status = 'PENDING') desc, po.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_set_ambassador_post_status(
  p_id      uuid,
  p_status  text,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(auth.uid());
  if p_status not in ('APPROVED', 'REJECTED', 'PENDING') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;
  update public.ambassador_posts
  set status        = p_status,
      admin_comment = nullif(trim(coalesce(p_comment, '')), '')
  where id = p_id;
  if not found then
    raise exception 'post % not found', p_id using errcode = 'P0002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. GRANTS — authenticated only; the auth.uid() admin check is inside each fn
-- -----------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'admin_grant_ambassador_deposit(uuid, numeric)',
    'admin_get_ambassador_stats()',
    'admin_list_ambassador_applications()',
    'admin_set_ambassador_application_status(uuid, text)',
    'admin_list_ambassador_posts()',
    'admin_set_ambassador_post_status(uuid, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;
