-- =============================================================================
-- Meme Farm — in-app Admin panel
--   * profiles.is_admin / is_banned
--   * REFUND ledger + transaction type
--   * _assert_admin() guard
--   * admin RPCs: list/process withdrawals, metrics, emission factor,
--                 user search / detail, ban
-- =============================================================================

alter table public.profiles add column if not exists is_admin  boolean not null default false;
alter table public.profiles add column if not exists is_banned boolean not null default false;

-- REFUND type (withdrawal rejection returns funds)
alter table public.ledger_entries drop constraint if exists ledger_entries_transaction_type_check;
alter table public.ledger_entries add constraint ledger_entries_transaction_type_check check (transaction_type in (
  'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE', 'SLOT_UNLOCK',
  'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD', 'REFUND'
));
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check check (type in (
  'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE', 'SLOT_UNLOCK',
  'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD', 'REFUND'
));

-- -----------------------------------------------------------------------------
-- guard: raises unless p_admin_id is the caller AND has is_admin
-- -----------------------------------------------------------------------------
create or replace function public._assert_admin(p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and auth.uid() <> p_admin_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and is_admin) then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public._assert_admin(uuid) from public, anon;
grant execute on function public._assert_admin(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Tab 1 — withdrawals queue
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_withdrawals(p_admin_id uuid)
returns table (
  tx_id         uuid,
  user_id       uuid,
  username      text,
  first_name    text,
  registered_at timestamptz,
  balance_gram  numeric(18, 9),
  amount        numeric(18, 9),
  fee           numeric(18, 9),
  net_amount    numeric(18, 9),
  wallet_address text,
  requested_at  timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  return query
    select t.id, t.user_id, p.username, p.first_name, p.created_at,
           coalesce(b.available_gram, 0), t.amount, t.fee, t.net_amount,
           t.wallet_address, t.created_at
    from public.transactions t
    join public.profiles p on p.id = t.user_id
    left join public.balances b on b.user_id = t.user_id
    where t.type = 'WITHDRAW' and t.status = 'PENDING'
    order by t.created_at asc;
end;
$$;

create or replace function public.admin_process_withdrawal(
  p_admin_id uuid,
  p_tx_id    uuid,
  p_action   text,
  p_tx_hash  text default null
)
returns table (
  status           text,
  refunded         numeric(18, 9),
  new_balance_gram numeric(18, 9)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx     public.transactions%rowtype;
  v_bal    numeric(18, 9);
  v_refund numeric(18, 9) := 0;
begin
  perform public._assert_admin(p_admin_id);
  if p_action not in ('APPROVE', 'REJECT') then
    raise exception 'invalid action %', p_action using errcode = '22023';
  end if;

  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found or v_tx.type <> 'WITHDRAW' or v_tx.status <> 'PENDING' then
    raise exception 'withdrawal % is not pending', p_tx_id using errcode = 'P0001';
  end if;

  if p_action = 'APPROVE' then
    update public.transactions
    set status = 'COMPLETED',
        tx_hash = coalesce(nullif(trim(p_tx_hash), ''), tx_hash)
    where id = p_tx_id;

    insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
    values (v_tx.user_id, 'WITHDRAW', 'DEBIT', 0, 0, 'GRAM',
            jsonb_build_object('settled', true, 'tx_id', p_tx_id,
                               'tx_hash', p_tx_hash, 'admin', p_admin_id));

    select available_gram into v_bal from public.balances where user_id = v_tx.user_id;
    status := 'COMPLETED';
  else
    v_refund := v_tx.amount;
    update public.transactions set status = 'FAILED' where id = p_tx_id;

    insert into public.balances (user_id) values (v_tx.user_id) on conflict (user_id) do nothing;
    update public.balances
    set available_gram = available_gram + v_refund
    where user_id = v_tx.user_id
    returning available_gram into v_bal;

    insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
    values (v_tx.user_id, 'REFUND', 'CREDIT', v_refund, 0, 'GRAM',
            jsonb_build_object('rejected_withdrawal', p_tx_id, 'admin', p_admin_id));

    insert into public.transactions (user_id, type, amount, fee, net_amount, status)
    values (v_tx.user_id, 'REFUND', v_refund, 0, v_refund, 'COMPLETED');

    status := 'FAILED';
  end if;

  refunded := v_refund;
  new_balance_gram := coalesce(v_bal, 0);
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tab 2 — metrics + emission factor
-- -----------------------------------------------------------------------------
create or replace function public.admin_metrics(p_admin_id uuid)
returns table (
  total_balances  numeric,
  withdrawn_24h   numeric,
  withdrawn_7d    numeric,
  pending_count   integer,
  pending_sum     numeric,
  user_count      integer,
  emission_factor numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  return query select
    coalesce((select sum(available_gram) from public.balances), 0),
    coalesce((select sum(amount) from public.transactions
              where type = 'WITHDRAW' and status = 'COMPLETED'
                and created_at > now() - interval '24 hours'), 0),
    coalesce((select sum(amount) from public.transactions
              where type = 'WITHDRAW' and status = 'COMPLETED'
                and created_at > now() - interval '7 days'), 0),
    coalesce((select count(*) from public.transactions
              where type = 'WITHDRAW' and status = 'PENDING'), 0)::int,
    coalesce((select sum(amount) from public.transactions
              where type = 'WITHDRAW' and status = 'PENDING'), 0),
    coalesce((select count(*) from public.profiles), 0)::int,
    coalesce((select emission_factor from public.farm_states order by user_id limit 1), 1.0);
end;
$$;

create or replace function public.admin_update_emission_factor(p_admin_id uuid, p_factor numeric)
returns table (updated_rows integer, emission_factor numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  if p_factor <= 0 or p_factor > 2 then
    raise exception 'emission factor out of range (0, 2]' using errcode = '22023';
  end if;

  update public.farm_states set emission_factor = p_factor;
  get diagnostics updated_rows = row_count;

  -- new sign-ups pick up the new value
  execute format('alter table public.farm_states alter column emission_factor set default %L', p_factor);

  emission_factor := p_factor;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tab 3 — user management / anti-fraud
-- -----------------------------------------------------------------------------
create or replace function public.admin_find_user(p_admin_id uuid, p_query text)
returns table (
  user_id       uuid,
  telegram_id   bigint,
  username      text,
  first_name    text,
  registered_at timestamptz,
  balance_gram  numeric(18, 9),
  is_admin      boolean,
  is_banned     boolean,
  referral_l1   integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := trim(coalesce(p_query, ''));
begin
  perform public._assert_admin(p_admin_id);
  if v_q = '' then return; end if;

  return query
    select p.id, p.telegram_id, p.username, p.first_name, p.created_at,
           coalesce(b.available_gram, 0), p.is_admin, p.is_banned,
           coalesce((select count(*)::int from public.referrals r
                     where r.referrer_id = p.id and r.tier = 1), 0)
    from public.profiles p
    left join public.balances b on b.user_id = p.id
    where p.username ilike '%' || v_q || '%'
       or p.telegram_id::text = v_q
       or p.id::text = v_q
    order by p.created_at desc
    limit 20;
end;
$$;

create or replace function public.admin_user_detail(p_admin_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  return jsonb_build_object(
    'profile', (
      select to_jsonb(x) from (
        select id, telegram_id, username, first_name, is_admin, is_banned,
               wallet_address, referral_code, created_at
        from public.profiles where id = p_user_id
      ) x
    ),
    'balance', (
      select to_jsonb(x) from (
        select available_gram, pending_gram, locked_gram
        from public.balances where user_id = p_user_id
      ) x
    ),
    'referrals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tier', r.tier, 'earned', r.total_earned_gram, 'unclaimed', r.unclaimed_gram,
               'referee', pr.username, 'joined', r.created_at
             ) order by r.created_at desc)
      from public.referrals r
      left join public.profiles pr on pr.id = r.referee_id
      where r.referrer_id = p_user_id
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', tt.type, 'amount', tt.amount, 'fee', tt.fee,
               'status', tt.status, 'ts', tt.created_at
             ) order by tt.created_at desc)
      from (
        select type, amount, fee, status, created_at
        from public.transactions where user_id = p_user_id
        order by created_at desc limit 25
      ) tt
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_ban_user(p_admin_id uuid, p_user_id uuid, p_banned boolean)
returns table (is_banned boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);

  update public.profiles set is_banned = p_banned where id = p_user_id;

  -- best-effort: also block the auth session
  begin
    update auth.users
    set banned_until = case when p_banned then 'infinity'::timestamptz else null end
    where id = p_user_id;
  exception when insufficient_privilege or undefined_table or undefined_column then
    null;
  end;

  is_banned := p_banned;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- grants
-- -----------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'admin_list_withdrawals(uuid)',
    'admin_process_withdrawal(uuid, uuid, text, text)',
    'admin_metrics(uuid)',
    'admin_update_emission_factor(uuid, numeric)',
    'admin_find_user(uuid, text)',
    'admin_user_detail(uuid, uuid)',
    'admin_ban_user(uuid, uuid, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;
