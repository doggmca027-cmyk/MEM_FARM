-- =============================================================================
-- Meme Farm — deposit auto-processing + hot-wallet payout automation
--   1. Clean start: handle_new_user already provisions balances at 0 and no
--      user_characters — re-asserted here for documentation. pvp_profiles.xp
--      defaults 0; "power" is derived from user_characters (empty -> 0).
--   2. process_auto_deposit(user, amount, tx_hash) — credit a Memo deposit,
--      idempotent on tx_hash (ton-deposit-webhook calls this).
--   3. system_settings table + withdraw_config {auto_withdraw, max_instant_limit}.
--   4. request_withdrawal — route small withdrawals to AUTO_PENDING when
--      auto_withdraw is on and net <= max_instant_limit.
--   5. admin_process_withdrawal — APPROVE without a hash now hands the payout to
--      the worker (status APPROVED) instead of marking COMPLETED.
--   6. admin_toggle_auto_withdraw / admin_get_settings.
--   7. worker_claim_payout / worker_complete_payout / worker_fail_payout —
--      SECURITY DEFINER helpers for ton-payout-worker (service-role only).
--   New transaction statuses: AUTO_PENDING, APPROVED, PROCESSING.
--   transactions.payout_tx_hash — on-chain hash of the outgoing payout.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. status vocabulary + payout hash column
-- -----------------------------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_status_check;
alter table public.transactions
  add constraint transactions_status_check check (status in (
    'PENDING', 'AUTO_PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED'
  ));

alter table public.transactions add column if not exists payout_tx_hash text;

-- -----------------------------------------------------------------------------
-- 1. clean-start re-assertion (idempotent; does not touch existing users)
-- -----------------------------------------------------------------------------
alter table public.balances alter column available_gram set default 0;
alter table public.balances alter column locked_gram    set default 0;
alter table public.balances alter column pending_gram    set default 0;

-- -----------------------------------------------------------------------------
-- 2. process_auto_deposit — idempotent Memo deposit credit
-- -----------------------------------------------------------------------------
create or replace function public.process_auto_deposit(
  p_user_id uuid,
  p_amount  numeric,
  p_tx_hash text
)
returns table (credited boolean, new_available_gram numeric(18, 9))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric(18, 9);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid deposit amount %', p_amount using errcode = '22023';
  end if;
  if coalesce(trim(p_tx_hash), '') = '' then
    raise exception 'tx_hash required' using errcode = '22023';
  end if;

  -- idempotency: bail if this on-chain tx was already credited
  if exists (
    select 1 from public.ledger_entries
    where transaction_type = 'DEPOSIT'
      and metadata ->> 'tx_hash' = p_tx_hash
  ) then
    select available_gram into v_balance from public.balances where user_id = p_user_id;
    credited := false;
    new_available_gram := coalesce(v_balance, 0);
    return next;
    return;
  end if;

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;

  update public.balances
  set available_gram = available_gram + p_amount
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'DEPOSIT', 'CREDIT', p_amount, 0, 'GRAM',
          jsonb_build_object('tx_hash', p_tx_hash, 'source', 'memo_auto'));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status, tx_hash)
  values (p_user_id, 'DEPOSIT', p_amount, 0, p_amount, 'COMPLETED', p_tx_hash);

  credited := true;
  new_available_gram := v_balance;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. system_settings
-- -----------------------------------------------------------------------------
create table if not exists public.system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.system_settings enable row level security;
-- no policies: SECURITY DEFINER functions / service_role only

insert into public.system_settings (key, value)
values ('withdraw_config', '{"auto_withdraw": false, "max_instant_limit": 5.0}'::jsonb)
on conflict (key) do nothing;

create or replace function public._withdraw_config()
returns table (auto_withdraw boolean, max_instant_limit numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((value ->> 'auto_withdraw')::boolean, false),
    coalesce((value ->> 'max_instant_limit')::numeric, 5.0)
  from public.system_settings where key = 'withdraw_config'
$$;

-- -----------------------------------------------------------------------------
-- 4. request_withdrawal — auto-route small withdrawals
-- -----------------------------------------------------------------------------
create or replace function public.request_withdrawal(
  p_user_id uuid,
  p_amount  numeric,
  p_address text
)
returns table (
  tx_id              uuid,
  fee                numeric(18, 9),
  net_amount         numeric(18, 9),
  new_available_gram numeric(18, 9)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_min      constant numeric  := 0.30;
  v_fee_min  constant numeric  := 0.01;
  v_fee_pct  constant numeric  := 0.02;
  v_cooldown constant interval := interval '24 hours';
  v_balance  numeric(18, 9);
  v_fee      numeric(18, 9);
  v_net      numeric(18, 9);
  v_last     timestamptz;
  v_tx_id    uuid;
  v_auto     boolean;
  v_limit    numeric;
  v_status   text;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_amount < v_min then
    raise exception 'minimum withdrawal is % GRAM', v_min using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_address)), 0) < 40 then
    raise exception 'invalid wallet address' using errcode = '22023';
  end if;

  select available_gram into v_balance
  from public.balances where user_id = p_user_id for update;
  if not found then
    raise exception 'balance not found for user %', p_user_id using errcode = 'P0002';
  end if;
  if v_balance < p_amount then
    raise exception 'insufficient funds: have %, need %', v_balance, p_amount using errcode = 'P0001';
  end if;

  select max(created_at) into v_last
  from public.transactions
  where user_id = p_user_id and type = 'WITHDRAW';
  if v_last is not null and now() - v_last < v_cooldown then
    raise exception 'withdrawal cooldown active until %', v_last + v_cooldown using errcode = 'P0001';
  end if;

  v_fee := round(greatest(v_fee_min, p_amount * v_fee_pct), 9);
  v_net := round(p_amount - v_fee, 9);
  if v_net <= 0 then
    raise exception 'net amount must be positive' using errcode = 'P0001';
  end if;

  select auto_withdraw, max_instant_limit into v_auto, v_limit from public._withdraw_config();
  v_status := case when coalesce(v_auto, false) and v_net <= coalesce(v_limit, 0)
                   then 'AUTO_PENDING' else 'PENDING' end;

  update public.balances
  set available_gram = available_gram - p_amount
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'WITHDRAW', 'DEBIT', p_amount, v_fee, 'GRAM',
          jsonb_build_object('address', p_address, 'net_amount', v_net, 'route', v_status));

  insert into public.transactions (user_id, type, amount, fee, net_amount, wallet_address, status)
  values (p_user_id, 'WITHDRAW', p_amount, v_fee, v_net, p_address, v_status)
  returning id into v_tx_id;

  tx_id              := v_tx_id;
  fee                := v_fee;
  net_amount         := v_net;
  new_available_gram := v_balance;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. admin_process_withdrawal — APPROVE hands off to the payout worker
-- -----------------------------------------------------------------------------
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
  v_hash   text := nullif(trim(p_tx_hash), '');
begin
  perform public._assert_admin(p_admin_id);
  if p_action not in ('APPROVE', 'REJECT') then
    raise exception 'invalid action %', p_action using errcode = '22023';
  end if;

  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found or v_tx.type <> 'WITHDRAW'
     or v_tx.status not in ('PENDING', 'AUTO_PENDING', 'APPROVED') then
    raise exception 'withdrawal % is not actionable', p_tx_id using errcode = 'P0001';
  end if;

  if p_action = 'APPROVE' then
    if v_hash is not null then
      -- legacy manual settlement: hash supplied, mark done
      update public.transactions
      set status = 'COMPLETED', tx_hash = v_hash, payout_tx_hash = v_hash
      where id = p_tx_id;
      insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
      values (v_tx.user_id, 'WITHDRAW', 'DEBIT', 0, 0, 'GRAM',
              jsonb_build_object('settled', true, 'tx_id', p_tx_id,
                                 'tx_hash', v_hash, 'admin', p_admin_id, 'manual', true));
      status := 'COMPLETED';
    else
      -- hand the payout to ton-payout-worker
      update public.transactions set status = 'APPROVED' where id = p_tx_id;
      insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
      values (v_tx.user_id, 'WITHDRAW', 'DEBIT', 0, 0, 'GRAM',
              jsonb_build_object('approved', true, 'tx_id', p_tx_id, 'admin', p_admin_id));
      status := 'APPROVED';
    end if;
    select available_gram into v_bal from public.balances where user_id = v_tx.user_id;
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
-- 6. admin settings — read + toggle auto-withdraw
-- -----------------------------------------------------------------------------
create or replace function public.admin_get_settings(p_admin_id uuid)
returns table (auto_withdraw boolean, max_instant_limit numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  return query select * from public._withdraw_config();
end;
$$;

create or replace function public.admin_toggle_auto_withdraw(
  p_admin_id uuid,
  p_enabled  boolean,
  p_limit    numeric
)
returns table (auto_withdraw boolean, max_instant_limit numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  if p_limit is null or p_limit < 0 then
    raise exception 'invalid limit %', p_limit using errcode = '22023';
  end if;

  insert into public.system_settings (key, value, updated_at)
  values ('withdraw_config',
          jsonb_build_object('auto_withdraw', coalesce(p_enabled, false),
                             'max_instant_limit', p_limit),
          now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  return query select * from public._withdraw_config();
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. payout worker helpers (ton-payout-worker, service-role)
-- -----------------------------------------------------------------------------
create or replace function public.worker_claim_payout()
returns table (
  tx_id       uuid,
  user_id     uuid,
  net_amount  numeric(18, 9),
  dest_address text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.transactions
  where type = 'WITHDRAW' and status in ('AUTO_PENDING', 'APPROVED')
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.transactions set status = 'PROCESSING' where id = v_id;

  return query
    select t.id, t.user_id, t.net_amount, t.wallet_address
    from public.transactions t where t.id = v_id;
end;
$$;

create or replace function public.worker_complete_payout(p_tx_id uuid, p_hash text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.transactions
  set status = 'COMPLETED', payout_tx_hash = nullif(trim(p_hash), ''),
      tx_hash = coalesce(tx_hash, nullif(trim(p_hash), ''))
  where id = p_tx_id and status = 'PROCESSING';

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  select user_id, 'WITHDRAW', 'DEBIT', 0, 0, 'GRAM',
         jsonb_build_object('settled', true, 'tx_id', p_tx_id, 'payout_tx_hash', p_hash, 'worker', true)
  from public.transactions where id = p_tx_id;
end;
$$;

create or replace function public.worker_fail_payout(p_tx_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
begin
  select * into v_tx from public.transactions where id = p_tx_id and status = 'PROCESSING' for update;
  if not found then
    return;
  end if;

  update public.transactions set status = 'FAILED' where id = p_tx_id;

  insert into public.balances (user_id) values (v_tx.user_id) on conflict (user_id) do nothing;
  update public.balances set available_gram = available_gram + v_tx.amount
  where user_id = v_tx.user_id;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (v_tx.user_id, 'REFUND', 'CREDIT', v_tx.amount, 0, 'GRAM',
          jsonb_build_object('failed_payout', p_tx_id, 'reason', p_reason, 'worker', true));
  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (v_tx.user_id, 'REFUND', v_tx.amount, 0, v_tx.amount, 'COMPLETED');
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. admin_list_withdrawals — surface every non-terminal payout + its status
--    (drop first: adding the `status` column changes the TABLE return type)
-- -----------------------------------------------------------------------------
drop function if exists public.admin_list_withdrawals(uuid);
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
  requested_at  timestamptz,
  status        text
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
           t.wallet_address, t.created_at, t.status
    from public.transactions t
    join public.profiles p on p.id = t.user_id
    left join public.balances b on b.user_id = t.user_id
    where t.type = 'WITHDRAW'
      and t.status in ('PENDING', 'AUTO_PENDING', 'APPROVED', 'PROCESSING')
    order by t.created_at asc;
end;
$$;

-- -----------------------------------------------------------------------------
-- grants
-- -----------------------------------------------------------------------------
revoke all on function public.process_auto_deposit(uuid, numeric, text)   from public, anon, authenticated;
revoke all on function public.worker_claim_payout()                       from public, anon, authenticated;
revoke all on function public.worker_complete_payout(uuid, text)          from public, anon, authenticated;
revoke all on function public.worker_fail_payout(uuid, text)              from public, anon, authenticated;
revoke all on function public._withdraw_config()                          from public, anon;

revoke all on function public.admin_get_settings(uuid)                    from public, anon;
revoke all on function public.admin_toggle_auto_withdraw(uuid, boolean, numeric) from public, anon;
grant execute on function public.admin_get_settings(uuid)                 to authenticated;
grant execute on function public.admin_toggle_auto_withdraw(uuid, boolean, numeric) to authenticated;
