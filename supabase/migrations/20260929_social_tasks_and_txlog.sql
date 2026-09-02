-- =============================================================================
-- Meme Farm — one-time channel-subscription tasks + public tx feed
--   1. social_task_claims + claim_social_task(): 0.05 GRAM once per task,
--      NO subscription check (client just opens the channel).
--   2. event_queue type TX_LOG — every completed DEPOSIT / WITHDRAW is queued
--      for the dispatcher to post (with tx hash) into the transactions channel.
-- =============================================================================

-- 1. SOCIAL TASKS -------------------------------------------------------
create table if not exists public.social_task_claims (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  task_id     text not null,
  reward_gram numeric(18, 9) not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, task_id)
);
alter table public.social_task_claims enable row level security;
drop policy if exists "social_task_claims_select_own" on public.social_task_claims;
create policy "social_task_claims_select_own" on public.social_task_claims
  for select using (auth.uid() = user_id);
grant select on public.social_task_claims to authenticated;

create or replace function public.claim_social_task(p_task_id text)
returns table (new_available_gram numeric(18, 9), reward_gram numeric(18, 9))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_reward numeric(18, 9);
  v_bal    numeric(18, 9);
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- server is the source of truth for which tasks exist and what they pay
  v_reward := case p_task_id
                when 'sub_meme_farm_trans'  then 0.05
                when 'sub_meme_farm_anonce' then 0.05
                else null
              end;
  if v_reward is null then
    raise exception 'unknown task %', p_task_id using errcode = '22023';
  end if;

  insert into public.social_task_claims (user_id, task_id, reward_gram)
  values (v_uid, p_task_id, v_reward)
  on conflict (user_id, task_id) do nothing;
  if not found then
    raise exception 'task already claimed' using errcode = 'P0001';
  end if;

  insert into public.balances (user_id) values (v_uid) on conflict (user_id) do nothing;
  select available_gram into v_bal from public.balances where user_id = v_uid for update;
  update public.balances
  set available_gram = available_gram + v_reward, updated_at = now()
  where user_id = v_uid
  returning available_gram into v_bal;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (v_uid, 'QUEST_REWARD', 'CREDIT', v_reward, 0, 'GRAM',
          jsonb_build_object('social_task', p_task_id));
  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (v_uid, 'QUEST_REWARD', v_reward, 0, v_reward, 'COMPLETED');

  new_available_gram := v_bal;
  reward_gram        := v_reward;
  return next;
end;
$$;
revoke all on function public.claim_social_task(text) from public, anon;
grant execute on function public.claim_social_task(text) to authenticated;

-- 2. TX_LOG event type ------------------------------------------------
alter table public.event_queue drop constraint if exists event_queue_type_check;
alter table public.event_queue
  add constraint event_queue_type_check
  check (type in ('FARM_READY', 'PVP_ATTACK', 'REFERRAL_INCOME', 'DEPOSIT',
                  'SUPPORT_REPLY', 'TX_LOG'));

-- 2a. process_auto_deposit — queue a TX_LOG on every credited deposit
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

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select available_gram into v_balance
  from public.balances where user_id = p_user_id for update;

  begin
    insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
    values (p_user_id, 'DEPOSIT', 'CREDIT', p_amount, 0, 'GRAM',
            jsonb_build_object('tx_hash', p_tx_hash, 'source', 'memo_auto'));
  exception when unique_violation then
    credited := false;
    new_available_gram := coalesce(v_balance, 0);
    return next;
    return;
  end;

  update public.balances
  set available_gram = available_gram + p_amount, updated_at = now()
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.transactions (user_id, type, amount, fee, net_amount, status, tx_hash)
  values (p_user_id, 'DEPOSIT', p_amount, 0, p_amount, 'COMPLETED', p_tx_hash);

  select coalesce(notif_prefs ->> 'lang', 'uk') into v_lang
  from public.profiles where id = p_user_id;

  insert into public.event_queue (user_id, type, metadata)
  values (p_user_id, 'DEPOSIT',
          jsonb_build_object('amount', round(p_amount, 2), 'lang', v_lang));

  insert into public.event_queue (user_id, type, metadata)
  values (p_user_id, 'TX_LOG',
          jsonb_build_object('kind', 'DEPOSIT', 'amount', round(p_amount, 4), 'tx_hash', p_tx_hash));

  credited := true;
  new_available_gram := v_balance;
  return next;
end;
$$;
revoke all on function public.process_auto_deposit(uuid, numeric, text) from public, anon, authenticated;

-- 2b. worker_complete_payout — queue a TX_LOG on a settled withdrawal
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

  update public.balances
  set locked_gram = greatest(0, locked_gram - v_req.amount_gram), updated_at = now()
  where user_id = v_req.user_id;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (v_req.user_id, 'WITHDRAW', 'DEBIT', v_req.amount_gram, v_req.fee_gram, 'GRAM',
          jsonb_build_object('request_id', p_tx_id, 'tx_hash', p_hash, 'worker', true));

  insert into public.transactions (user_id, type, amount, fee, net_amount, wallet_address, status, tx_hash)
  values (v_req.user_id, 'WITHDRAW', v_req.amount_gram, v_req.fee_gram, v_req.net_gram,
          v_req.dest_ton_address, 'COMPLETED', nullif(trim(p_hash), ''));

  if coalesce(v_req.fee_gram, 0) > 0 then
    insert into public.system_ledger (source, amount, asset, metadata)
    values ('WITHDRAW_FEE', v_req.fee_gram, 'GRAM',
            jsonb_build_object('request_id', p_tx_id, 'user_id', v_req.user_id, 'worker', true));
  end if;

  insert into public.event_queue (user_id, type, metadata)
  values (v_req.user_id, 'TX_LOG',
          jsonb_build_object('kind', 'WITHDRAW', 'amount', round(v_req.amount_gram, 4),
                             'net', round(v_req.net_gram, 4),
                             'tx_hash', nullif(trim(p_hash), '')));
end;
$$;
revoke all on function public.worker_complete_payout(uuid, text) from public, anon, authenticated;

-- 2c. admin_process_withdrawal — queue a TX_LOG on manual settlement
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
      if coalesce(v_req.fee_gram, 0) > 0 then
        insert into public.system_ledger (source, amount, asset, metadata)
        values ('WITHDRAW_FEE', v_req.fee_gram, 'GRAM',
                jsonb_build_object('request_id', p_tx_id, 'user_id', v_req.user_id, 'manual', true));
      end if;
      insert into public.event_queue (user_id, type, metadata)
      values (v_req.user_id, 'TX_LOG',
              jsonb_build_object('kind', 'WITHDRAW', 'amount', round(v_req.amount_gram, 4),
                                 'net', round(v_req.net_gram, 4), 'tx_hash', v_hash));
      status := 'COMPLETED';
    else
      update public.withdrawal_requests set status = 'APPROVED', updated_at = now() where id = p_tx_id;
      status := 'APPROVED';
    end if;
    select available_gram into v_bal from public.balances where user_id = v_req.user_id;
  else
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
revoke all on function public.admin_process_withdrawal(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_process_withdrawal(uuid, uuid, text, text) to authenticated;
