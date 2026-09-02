-- =============================================================================
-- Meme Farm — record the withdrawal fee in system_ledger on completion.
--
-- Until now the 2% (min 0.01) withdrawal fee left the user's balance but was
-- never booked to the treasury ledger (unlike the PvP rake). Add a
-- 'WITHDRAW_FEE' system_ledger row wherever a withdrawal settles COMPLETED.
-- Function bodies are otherwise identical to 20260915.
-- =============================================================================

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
end;
$$;

revoke all on function public.admin_process_withdrawal(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_process_withdrawal(uuid, uuid, text, text) to authenticated;
revoke all on function public.worker_complete_payout(uuid, text) from public, anon, authenticated;
