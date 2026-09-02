-- =============================================================================
-- Meme Farm — ambassador admin RPCs: take p_admin_id, matching the rest of the
-- admin surface (admin_metrics / admin_find_user / …). _assert_admin still
-- enforces auth.uid() = p_admin_id when a JWT is present, plus profiles.is_admin.
-- Drops the auth.uid()-only variants from 20260919.
-- =============================================================================

drop function if exists public.admin_grant_ambassador_deposit(uuid, numeric);
drop function if exists public.admin_get_ambassador_stats();
drop function if exists public.admin_list_ambassador_applications();
drop function if exists public.admin_set_ambassador_application_status(uuid, text);
drop function if exists public.admin_list_ambassador_posts();
drop function if exists public.admin_set_ambassador_post_status(uuid, text, text);

-- ---------------------------------------------------------------------------
create function public.admin_grant_ambassador_deposit(
  p_admin_id uuid,
  p_user_id  uuid,
  p_amount   numeric
)
returns table (new_available_gram numeric(18, 9))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric(18, 9);
begin
  perform public._assert_admin(p_admin_id);

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount %', p_amount using errcode = '22023';
  end if;

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;

  select available_gram into v_balance
  from public.balances where user_id = p_user_id for update;
  if not found then
    raise exception 'no balance for user %', p_user_id using errcode = 'P0002';
  end if;

  update public.balances
  set available_gram = available_gram + p_amount, updated_at = now()
  where user_id = p_user_id
  returning available_gram into v_balance;

  -- AMBASSADOR_REWARD is NOT a fee-taking event: process_referral_commission()
  -- is never called, so no L1/L2/L3 cascade on a promo grant.
  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'AMBASSADOR_REWARD', 'CREDIT', p_amount, 0, 'GRAM',
          jsonb_build_object('source', 'ambassador_promo', 'granted_by', p_admin_id));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'AMBASSADOR_REWARD', p_amount, 0, p_amount, 'COMPLETED');

  new_available_gram := v_balance;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
create function public.admin_get_ambassador_stats(p_admin_id uuid)
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
  perform public._assert_admin(p_admin_id);

  return query
  with amb as (
    select distinct on (a.user_id) a.user_id, a.channel_link
    from public.ambassador_applications a
    where a.status = 'APPROVED'
    order by a.user_id, a.created_at desc
  ),
  l1 as (
    select amb.user_id as amb_id, r.referee_id as uid
    from amb join public.referrals r on r.referrer_id = amb.user_id
  ),
  l2 as (
    select l1.amb_id, r.referee_id as uid
    from l1 join public.referrals r on r.referrer_id = l1.uid
  ),
  l3 as (
    select l2.amb_id, r.referee_id as uid
    from l2 join public.referrals r on r.referrer_id = l2.uid
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

-- ---------------------------------------------------------------------------
create function public.admin_list_ambassador_applications(p_admin_id uuid)
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
  perform public._assert_admin(p_admin_id);
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

-- ---------------------------------------------------------------------------
create function public.admin_set_ambassador_application_status(
  p_admin_id uuid,
  p_id       uuid,
  p_status   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  if p_status not in ('APPROVED', 'REJECTED', 'PENDING') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;
  update public.ambassador_applications set status = p_status where id = p_id;
  if not found then
    raise exception 'application % not found', p_id using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
create function public.admin_list_ambassador_posts(p_admin_id uuid)
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
  perform public._assert_admin(p_admin_id);
  return query
  select po.id, po.user_id, p.username, p.first_name, po.post_link,
         po.status, po.admin_comment, po.created_at
  from public.ambassador_posts po
  join public.profiles p on p.id = po.user_id
  order by (po.status = 'PENDING') desc, po.created_at desc
  limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
create function public.admin_set_ambassador_post_status(
  p_admin_id uuid,
  p_id       uuid,
  p_status   text,
  p_comment  text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  if p_status not in ('APPROVED', 'REJECTED', 'PENDING') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;
  update public.ambassador_posts
  set status = p_status,
      admin_comment = nullif(trim(coalesce(p_comment, '')), '')
  where id = p_id;
  if not found then
    raise exception 'post % not found', p_id using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'admin_grant_ambassador_deposit(uuid, uuid, numeric)',
    'admin_get_ambassador_stats(uuid)',
    'admin_list_ambassador_applications(uuid)',
    'admin_set_ambassador_application_status(uuid, uuid, text)',
    'admin_list_ambassador_posts(uuid)',
    'admin_set_ambassador_post_status(uuid, uuid, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;
