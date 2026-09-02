-- =============================================================================
-- Meme Farm — per-card lifetime farming cap.
--
-- Each card can farm at most 2x its tier's roll cost over its entire life,
-- no matter how many times it is merged / levelled up. The cap follows the
-- tier the card was ROLLED from (roll cost = 2^(tier-1) GRAM):
--   T1 cap 2 · T2 cap 4 · T3 cap 8 · T4 cap 16 · T5 cap 32 · T6 cap 64
-- Once a card reaches its cap it contributes 0 to farm income.
-- =============================================================================

alter table public.user_characters
  add column if not exists lifetime_earned numeric(18, 9) not null default 0;

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
  v_elapsed_sec numeric;
  v_cap_sec     constant numeric := 8 * 3600;   -- one claim cycle
  v_earned      numeric(18, 9) := 0;
  v_new_balance numeric(18, 9);
  v_next_claim  timestamptz;
  r             record;
  v_card_earn   numeric(18, 9);
  v_remaining   numeric(18, 9);
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

  v_elapsed_sec := least(
    greatest(extract(epoch from (now() - v_state.last_accrual_at)), 0),
    v_cap_sec
  );
  v_next_claim := now() + interval '8 hours';

  -- per card: pay this cycle's share, but never past 2x the tier roll cost
  for r in
    select uc.id,
           uc.current_income_day,
           uc.lifetime_earned,
           2 * power(2::numeric, coalesce(ct.tier, 1) - 1) as earn_cap
    from public.user_characters uc
    join public.character_templates ct on ct.id = uc.template_id
    where uc.user_id = p_user_id and uc.is_equipped = true
    for update
  loop
    v_remaining := greatest(r.earn_cap - r.lifetime_earned, 0);
    if v_remaining <= 0 then
      continue;
    end if;
    v_card_earn := least(
      round(r.current_income_day * v_state.emission_factor * v_elapsed_sec / 86400.0, 9),
      v_remaining
    );
    if v_card_earn > 0 then
      update public.user_characters
      set lifetime_earned = lifetime_earned + v_card_earn
      where id = r.id;
      v_earned := v_earned + v_card_earn;
    end if;
  end loop;

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.balances
  set available_gram = available_gram + v_earned
  where user_id = p_user_id
  returning available_gram into v_new_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'FARM_CLAIM', 'CREDIT', v_earned, 0, 'GRAM',
          jsonb_build_object('emission_factor', v_state.emission_factor,
                             'elapsed_seconds', round(v_elapsed_sec),
                             'capped', true, 'per_card_cap', true));

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
