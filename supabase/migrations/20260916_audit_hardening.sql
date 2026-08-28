-- =============================================================================
-- Meme Farm — security/economy audit hardening
--   1. process_auto_deposit: hard idempotency via a UNIQUE index on the
--      deposit tx_hash + lock-before-check, closing the concurrent
--      double-credit race (two overlapping webhook runs, same tx_hash).
--   2. claim_farm_income: cap offline accrual at one 8h cycle so the server
--      never pays more than the UI shows (no unbounded idle earnings).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a. one DEPOSIT ledger row per on-chain tx_hash — enforced by the DB
-- -----------------------------------------------------------------------------
-- (defensive: drop any pre-existing dupes before the unique index)
delete from public.ledger_entries a
using public.ledger_entries b
where a.ctid < b.ctid
  and a.transaction_type = 'DEPOSIT' and b.transaction_type = 'DEPOSIT'
  and a.metadata ->> 'tx_hash' is not null
  and a.metadata ->> 'tx_hash' = b.metadata ->> 'tx_hash';

create unique index if not exists ledger_entries_deposit_txhash_uidx
  on public.ledger_entries ((metadata ->> 'tx_hash'))
  where transaction_type = 'DEPOSIT' and (metadata ->> 'tx_hash') is not null;

-- -----------------------------------------------------------------------------
-- 1b. process_auto_deposit — lock first, then the unique index is the guard
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
  v_lang    text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid deposit amount %', p_amount using errcode = '22023';
  end if;
  if coalesce(trim(p_tx_hash), '') = '' then
    raise exception 'tx_hash required' using errcode = '22023';
  end if;

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;

  -- serialize this user's deposits; the UNIQUE index below is the hard guard
  select available_gram into v_balance
  from public.balances where user_id = p_user_id for update;

  begin
    insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
    values (p_user_id, 'DEPOSIT', 'CREDIT', p_amount, 0, 'GRAM',
            jsonb_build_object('tx_hash', p_tx_hash, 'source', 'memo_auto'));
  exception when unique_violation then
    -- this on-chain tx was already credited
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

  credited := true;
  new_available_gram := v_balance;
  return next;
end;
$$;

revoke all on function public.process_auto_deposit(uuid, numeric, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. claim_farm_income — cap accrual at one 8h cycle
-- -----------------------------------------------------------------------------
create or replace function public.claim_farm_income(p_user_id uuid)
returns table (
  earned_gram        numeric(18, 9),
  new_available_gram numeric(18, 9),
  next_claim_at      timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state       public.farm_states%rowtype;
  v_income_day  numeric(18, 9);
  v_elapsed_sec numeric;
  v_cap_sec     constant numeric := 8 * 3600;   -- one claim cycle
  v_earned      numeric(18, 9);
  v_new_balance numeric(18, 9);
  v_next_claim  timestamptz;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_state from public.farm_states where user_id = p_user_id for update;
  if not found then
    raise exception 'farm state not found for user %', p_user_id using errcode = 'P0002';
  end if;
  if now() < v_state.next_claim_at then
    raise exception 'claim not ready until %', v_state.next_claim_at using errcode = 'P0001';
  end if;

  select coalesce(sum(current_income_day), 0) into v_income_day
  from public.user_characters
  where user_id = p_user_id and is_equipped = true;

  -- accrual is capped at one cycle — the UI never shows more than this
  v_elapsed_sec := least(
    greatest(extract(epoch from (now() - v_state.last_accrual_at)), 0),
    v_cap_sec
  );
  v_earned := round(v_income_day * v_state.emission_factor * v_elapsed_sec / 86400.0, 9);
  v_next_claim := now() + interval '8 hours';

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;

  update public.balances
  set available_gram = available_gram + v_earned
  where user_id = p_user_id
  returning available_gram into v_new_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'FARM_CLAIM', 'CREDIT', v_earned, 0, 'GRAM',
          jsonb_build_object('income_per_day', v_income_day,
                             'emission_factor', v_state.emission_factor,
                             'elapsed_seconds', round(v_elapsed_sec), 'capped', true));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'FARM_CLAIM', v_earned, 0, v_earned, 'COMPLETED');

  update public.farm_states
  set last_accrual_at   = now(),
      next_claim_at      = v_next_claim,
      is_claim_notified  = false
  where user_id = p_user_id;

  earned_gram        := v_earned;
  new_available_gram := v_new_balance;
  next_claim_at      := v_next_claim;
  return next;
end;
$$;

revoke all on function public.claim_farm_income(uuid) from public, anon;
grant execute on function public.claim_farm_income(uuid) to authenticated;
