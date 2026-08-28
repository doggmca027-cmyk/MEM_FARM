-- =============================================================================
-- Meme Farm — financial engine: dedicated withdrawal_requests + locked_gram
-- hold, Memo auto-deposit with a notify event, hot-wallet payout worker.
-- Supersedes the withdrawal parts of 20260914 (system_settings kept as-is).
--
--   1. handle_new_user — re-asserted: fresh profile = available_gram 0,
--      locked_gram 0, NO user_characters, pvp_profiles.xp 0 (power is derived
--      from user_characters, so 0).
--   2. process_auto_deposit(p_user_id, p_amount, p_tx_hash) — FOR UPDATE hold,
--      credit available_gram, DEPOSIT ledger + transaction, enqueue a DEPOSIT
--      notification event for notify-dispatcher.
--   3. withdrawal_requests table (PENDING / AUTO_QUEUED / APPROVED / PROCESSING
--      / COMPLETED / FAILED / REJECTED) — real locked_gram escrow.
--   4. request_withdrawal — available -= amt, locked += amt; AUTO_QUEUED when
--      auto_withdraw and amount <= max_instant_limit, else PENDING.
--   5. admin_process_withdrawal — APPROVE -> APPROVED (worker) or COMPLETED
--      (hash given); REJECT -> REJECTED + locked -> available.
--   6. admin_toggle_auto_withdraw / admin_update_withdraw_config (alias).
--   7. worker_claim_payout / worker_complete_payout / worker_fail_payout —
--      operate on withdrawal_requests, settle locked_gram.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. handle_new_user — zero onboarding (re-asserted)
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, telegram_id, username, first_name, referral_code)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'telegram_id', '')::bigint,
    new.raw_user_meta_data ->> 'username',
    new.raw_user_meta_data ->> 'first_name',
    public.gen_referral_code()
  )
  on conflict (id) do nothing;

  -- strictly zero balance
  insert into public.balances (user_id, available_gram, locked_gram, pending_gram)
  values (new.id, 0, 0, 0)
  on conflict (user_id) do nothing;

  insert into public.farm_states (user_id, last_accrual_at, next_claim_at)
  values (new.id, now(), now())
  on conflict (user_id) do nothing;

  insert into public.tier_states (user_id, tier, cost_gram)
  select new.id, t, power(2, t - 1)::numeric
  from generate_series(1, 6) as t
  on conflict (user_id, tier) do nothing;

  -- xp 0; power is Σ user_characters.current_power (none yet -> 0)
  insert into public.pvp_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;

  -- NO user_characters seeded — the roster starts empty ([])
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. DEPOSIT notification event type + process_auto_deposit
-- -----------------------------------------------------------------------------
alter table public.event_queue drop constraint if exists event_queue_type_check;
alter table public.event_queue
  add constraint event_queue_type_check
  check (type in ('FARM_READY', 'PVP_ATTACK', 'REFERRAL_INCOME', 'DEPOSIT'));

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
  v_lang    text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid deposit amount %', p_amount using errcode = '22023';
  end if;
  if coalesce(trim(p_tx_hash), '') = '' then
    raise exception 'tx_hash required' using errcode = '22023';
  end if;

  -- idempotency: this on-chain tx already credited?
  if exists (
    select 1 from public.ledger_entries
    where transaction_type = 'DEPOSIT' and metadata ->> 'tx_hash' = p_tx_hash
  ) then
    select available_gram into v_balance from public.balances where user_id = p_user_id;
    credited := false;
    new_available_gram := coalesce(v_balance, 0);
    return next;
    return;
  end if;

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;

  -- lock the row, credit
  perform 1 from public.balances where user_id = p_user_id for update;
  update public.balances
  set available_gram = available_gram + p_amount, updated_at = now()
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'DEPOSIT', 'CREDIT', p_amount, 0, 'GRAM',
          jsonb_build_object('tx_hash', p_tx_hash, 'source', 'memo_auto'));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status, tx_hash)
  values (p_user_id, 'DEPOSIT', p_amount, 0, p_amount, 'COMPLETED', p_tx_hash);

  -- notify via notify-dispatcher (language from notif_prefs)
  select coalesce(notif_prefs ->> 'lang', 'uk') into v_lang
  from public.profiles where id = p_user_id;

  insert into public.event_queue (user_id, type, metadata)
  values (p_user_id, 'DEPOSIT',
          jsonb_build_object('amount', round(p_amount, 2), 'lang', v_lang));

  credited := true;
  new_available_gram := v_balance;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. withdrawal_requests
-- -----------------------------------------------------------------------------
create table if not exists public.withdrawal_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  amount_gram      numeric(18, 9) not null check (amount_gram > 0),
  fee_gram         numeric(18, 9) not null default 0,
  net_gram         numeric(18, 9) not null,
  dest_ton_address text not null,
  status           text not null default 'PENDING' check (status in (
    'PENDING', 'AUTO_QUEUED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'
  )),
  tx_hash          text,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists withdrawal_requests_queue_idx
  on public.withdrawal_requests (status, created_at)
  where status in ('PENDING', 'AUTO_QUEUED', 'APPROVED', 'PROCESSING');

alter table public.withdrawal_requests enable row level security;
drop policy if exists "withdrawal_requests_select_own" on public.withdrawal_requests;
create policy "withdrawal_requests_select_own" on public.withdrawal_requests
  for select using (auth.uid() = user_id);
grant select on public.withdrawal_requests to authenticated;

-- backfill any non-terminal WITHDRAW rows from the transactions-based model
insert into public.withdrawal_requests
  (id, user_id, amount_gram, fee_gram, net_gram, dest_ton_address, status, tx_hash, created_at)
select t.id, t.user_id, t.amount, t.fee, t.net_amount,
       coalesce(t.wallet_address, ''),
       case t.status when 'AUTO_PENDING' then 'AUTO_QUEUED' else t.status end,
       t.tx_hash, t.created_at
from public.transactions t
where t.type = 'WITHDRAW'
  and t.status in ('PENDING', 'AUTO_PENDING', 'APPROVED', 'PROCESSING')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. request_withdrawal — locked_gram hold + withdrawal_requests row
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
  v_avail    numeric(18, 9);
  v_fee      numeric(18, 9);
  v_net      numeric(18, 9);
  v_last     timestamptz;
  v_id       uuid;
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

  select available_gram into v_avail
  from public.balances where user_id = p_user_id for update;
  if not found then
    raise exception 'balance not found for user %', p_user_id using errcode = 'P0002';
  end if;
  if v_avail < p_amount then
    raise exception 'insufficient funds: have %, need %', v_avail, p_amount using errcode = 'P0001';
  end if;

  select max(created_at) into v_last
  from public.withdrawal_requests
  where user_id = p_user_id and status <> 'REJECTED' and status <> 'FAILED';
  if v_last is not null and now() - v_last < v_cooldown then
    raise exception 'withdrawal cooldown active until %', v_last + v_cooldown using errcode = 'P0001';
  end if;

  v_fee := round(greatest(v_fee_min, p_amount * v_fee_pct), 9);
  v_net := round(p_amount - v_fee, 9);
  if v_net <= 0 then
    raise exception 'net amount must be positive' using errcode = 'P0001';
  end if;

  select auto_withdraw, max_instant_limit into v_auto, v_limit from public._withdraw_config();
  v_status := case when coalesce(v_auto, false) and p_amount <= coalesce(v_limit, 0)
                   then 'AUTO_QUEUED' else 'PENDING' end;

  -- hold: available -> locked
  update public.balances
  set available_gram = available_gram - p_amount,
      locked_gram    = locked_gram + p_amount,
      updated_at = now()
  where user_id = p_user_id
  returning available_gram into v_avail;

  insert into public.withdrawal_requests
    (user_id, amount_gram, fee_gram, net_gram, dest_ton_address, status)
  values (p_user_id, p_amount, v_fee, v_net, trim(p_address), v_status)
  returning id into v_id;

  tx_id              := v_id;
  fee                := v_fee;
  net_amount         := v_net;
  new_available_gram := v_avail;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. admin_process_withdrawal — on withdrawal_requests
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
  v_req    public.withdrawal_requests%rowtype;
  v_bal    numeric(18, 9);
  v_refund numeric(18, 9) := 0;
  v_hash   text := nullif(trim(p_tx_hash), '');
begin
  perform public._assert_admin(p_admin_id);
  if p_action not in ('APPROVE', 'REJECT') then
    raise exception 'invalid action %', p_action using errcode = '22023';
  end if;

  select * into v_req from public.withdrawal_requests where id = p_tx_id for update;
  if not found or v_req.status not in ('PENDING', 'AUTO_QUEUED', 'APPROVED') then
    raise exception 'withdrawal % is not actionable', p_tx_id using errcode = 'P0001';
  end if;

  if p_action = 'APPROVE' then
    if v_hash is not null then
      -- manual settlement: release the hold now
      update public.balances
      set locked_gram = greatest(0, locked_gram - v_req.amount_gram), updated_at = now()
      where user_id = v_req.user_id;
      update public.withdrawal_requests
      set status = 'COMPLETED', tx_hash = v_hash, updated_at = now()
      where id = p_tx_id;
      insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
      values (v_req.user_id, 'WITHDRAW', 'DEBIT', v_req.amount_gram, v_req.fee_gram, 'GRAM',
              jsonb_build_object('request_id', p_tx_id, 'tx_hash', v_hash, 'admin', p_admin_id, 'manual', true));
      insert into public.transactions (user_id, type, amount, fee, net_amount, wallet_address, status, tx_hash)
      values (v_req.user_id, 'WITHDRAW', v_req.amount_gram, v_req.fee_gram, v_req.net_gram,
              v_req.dest_ton_address, 'COMPLETED', v_hash);
      status := 'COMPLETED';
    else
      update public.withdrawal_requests set status = 'APPROVED', updated_at = now() where id = p_tx_id;
      status := 'APPROVED';
    end if;
    select available_gram into v_bal from public.balances where user_id = v_req.user_id;
  else
    -- REJECT: locked -> available
    v_refund := v_req.amount_gram;
    update public.balances
    set locked_gram    = greatest(0, locked_gram - v_req.amount_gram),
        available_gram = available_gram + v_req.amount_gram,
        updated_at = now()
    where user_id = v_req.user_id
    returning available_gram into v_bal;
    update public.withdrawal_requests set status = 'REJECTED', updated_at = now() where id = p_tx_id;
    insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
    values (v_req.user_id, 'REFUND', 'CREDIT', v_refund, 0, 'GRAM',
            jsonb_build_object('rejected_withdrawal', p_tx_id, 'admin', p_admin_id));
    insert into public.transactions (user_id, type, amount, fee, net_amount, status)
    values (v_req.user_id, 'REFUND', v_refund, 0, v_refund, 'COMPLETED');
    status := 'REJECTED';
  end if;

  refunded := v_refund;
  new_balance_gram := coalesce(v_bal, 0);
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. withdraw config setter (+ spec-named alias)
-- -----------------------------------------------------------------------------
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
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return query select * from public._withdraw_config();
end;
$$;

create or replace function public.admin_update_withdraw_config(
  p_admin_id uuid,
  p_auto     boolean,
  p_limit    numeric
)
returns table (auto_withdraw boolean, max_instant_limit numeric)
language sql
security definer
set search_path = public, pg_temp
as $$ select * from public.admin_toggle_auto_withdraw(p_admin_id, p_auto, p_limit) $$;

-- -----------------------------------------------------------------------------
-- 7. admin_list_withdrawals — from withdrawal_requests
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
    select w.id, w.user_id, p.username, p.first_name, p.created_at,
           coalesce(b.available_gram, 0), w.amount_gram, w.fee_gram, w.net_gram,
           w.dest_ton_address, w.created_at, w.status
    from public.withdrawal_requests w
    join public.profiles p on p.id = w.user_id
    left join public.balances b on b.user_id = w.user_id
    where w.status in ('PENDING', 'AUTO_QUEUED', 'APPROVED', 'PROCESSING')
    order by w.created_at asc;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. payout worker helpers — on withdrawal_requests, settle locked_gram
-- -----------------------------------------------------------------------------
create or replace function public.worker_claim_payout()
returns table (
  tx_id        uuid,
  user_id      uuid,
  net_amount   numeric(18, 9),
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
  from public.withdrawal_requests
  where status in ('AUTO_QUEUED', 'APPROVED')
  order by created_at asc
  for update skip locked
  limit 1;
  if v_id is null then
    return;
  end if;

  update public.withdrawal_requests set status = 'PROCESSING', updated_at = now() where id = v_id;

  return query
    select w.id, w.user_id, w.net_gram, w.dest_ton_address
    from public.withdrawal_requests w where w.id = v_id;
end;
$$;

create or replace function public.worker_complete_payout(p_tx_id uuid, p_hash text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.withdrawal_requests%rowtype;
begin
  select * into v_req from public.withdrawal_requests where id = p_tx_id and status = 'PROCESSING' for update;
  if not found then
    return;
  end if;

  update public.withdrawal_requests
  set status = 'COMPLETED', tx_hash = nullif(trim(p_hash), ''), updated_at = now()
  where id = p_tx_id;

  -- burn the held amount
  update public.balances
  set locked_gram = greatest(0, locked_gram - v_req.amount_gram), updated_at = now()
  where user_id = v_req.user_id;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (v_req.user_id, 'WITHDRAW', 'DEBIT', v_req.amount_gram, v_req.fee_gram, 'GRAM',
          jsonb_build_object('request_id', p_tx_id, 'tx_hash', p_hash, 'worker', true));

  insert into public.transactions (user_id, type, amount, fee, net_amount, wallet_address, status, tx_hash)
  values (v_req.user_id, 'WITHDRAW', v_req.amount_gram, v_req.fee_gram, v_req.net_gram,
          v_req.dest_ton_address, 'COMPLETED', nullif(trim(p_hash), ''));
end;
$$;

create or replace function public.worker_fail_payout(p_tx_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.withdrawal_requests%rowtype;
begin
  select * into v_req from public.withdrawal_requests where id = p_tx_id and status = 'PROCESSING' for update;
  if not found then
    return;
  end if;

  update public.withdrawal_requests
  set status = 'FAILED', error = left(coalesce(p_reason, ''), 500), updated_at = now()
  where id = p_tx_id;

  -- return the held amount to the player
  update public.balances
  set locked_gram    = greatest(0, locked_gram - v_req.amount_gram),
      available_gram = available_gram + v_req.amount_gram,
      updated_at = now()
  where user_id = v_req.user_id;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (v_req.user_id, 'REFUND', 'CREDIT', v_req.amount_gram, 0, 'GRAM',
          jsonb_build_object('failed_payout', p_tx_id, 'reason', p_reason, 'worker', true));
  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (v_req.user_id, 'REFUND', v_req.amount_gram, 0, v_req.amount_gram, 'COMPLETED');
end;
$$;

-- -----------------------------------------------------------------------------
-- grants
-- -----------------------------------------------------------------------------
revoke all on function public.process_auto_deposit(uuid, numeric, text)   from public, anon, authenticated;
revoke all on function public.worker_claim_payout()                       from public, anon, authenticated;
revoke all on function public.worker_complete_payout(uuid, text)          from public, anon, authenticated;
revoke all on function public.worker_fail_payout(uuid, text)              from public, anon, authenticated;
revoke all on function public.admin_update_withdraw_config(uuid, boolean, numeric) from public, anon;
grant execute on function public.admin_update_withdraw_config(uuid, boolean, numeric) to authenticated;
