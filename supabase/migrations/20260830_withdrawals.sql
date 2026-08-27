-- =============================================================================
-- Meme Farm — request_withdrawal RPC
--   Validates minimum / balance / 24h cooldown, applies the platform fee
--   (max(0.01, amount * 2%)), locks the amount from the balance and records
--   a PENDING WITHDRAW in the ledger + transactions. SECURITY DEFINER.
-- =============================================================================

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
  from public.balances
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'balance not found for user %', p_user_id using errcode = 'P0002';
  end if;
  if v_balance < p_amount then
    raise exception 'insufficient funds: have %, need %', v_balance, p_amount using errcode = 'P0001';
  end if;

  -- one withdrawal per 24h
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

  update public.balances
  set available_gram = available_gram - p_amount
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'WITHDRAW', 'DEBIT', p_amount, v_fee, 'GRAM',
          jsonb_build_object('address', p_address, 'net_amount', v_net));

  insert into public.transactions (user_id, type, amount, fee, net_amount, wallet_address, status)
  values (p_user_id, 'WITHDRAW', p_amount, v_fee, v_net, p_address, 'PENDING')
  returning id into v_tx_id;

  tx_id              := v_tx_id;
  fee                := v_fee;
  net_amount         := v_net;
  new_available_gram := v_balance;
  return next;
end;
$$;

revoke all on function public.request_withdrawal(uuid, numeric, text) from public, anon;
grant execute on function public.request_withdrawal(uuid, numeric, text) to authenticated;
