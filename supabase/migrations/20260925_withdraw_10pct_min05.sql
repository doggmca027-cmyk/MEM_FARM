-- =============================================================================
-- Meme Farm — withdrawal economics: 10% fee, minimum 0.50 GRAM.
-- (was 2% / 0.30). Body otherwise identical to 20260915.
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
  v_min      constant numeric  := 0.50;
  v_fee_min  constant numeric  := 0.01;
  v_fee_pct  constant numeric  := 0.10;
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

revoke all on function public.request_withdrawal(uuid, numeric, text) from public, anon;
grant execute on function public.request_withdrawal(uuid, numeric, text) to authenticated;
