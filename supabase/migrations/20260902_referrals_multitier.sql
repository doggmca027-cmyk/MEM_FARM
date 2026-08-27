-- =============================================================================
-- Meme Farm — 3-tier referral program
--   * profiles.referral_code (unique 6-char, auto-generated on sign-up)
--   * referrals: total_earned_ton -> total_earned_gram, + unclaimed_gram
--   * bind_referrer()             — attach a new user to their L1 referrer
--   * process_referral_commission() — cascade 5% / 2% / 1% up the chain
--   * claim_referral_rewards()    — move accrued commission to the balance
-- =============================================================================

alter table public.referrals rename column total_earned_ton to total_earned_gram;
alter table public.referrals
  add column if not exists unclaimed_gram numeric(18, 9) not null default 0;

alter table public.profiles add column if not exists referral_code text;
create unique index if not exists profiles_referral_code_key
  on public.profiles (referral_code)
  where referral_code is not null;

-- -----------------------------------------------------------------------------
-- unique 6-char code generator (no ambiguous glyphs)
-- -----------------------------------------------------------------------------
create or replace function public.gen_referral_code()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code  text;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alpha, floor(random() * length(v_alpha))::int + 1, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- backfill existing profiles
update public.profiles
set referral_code = public.gen_referral_code()
where referral_code is null;

-- provision the code on sign-up (keeps the rest of handle_new_user intact)
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

  insert into public.balances (user_id) values (new.id) on conflict (user_id) do nothing;

  insert into public.farm_states (user_id, last_accrual_at, next_claim_at)
  values (new.id, now(), now())
  on conflict (user_id) do nothing;

  insert into public.tier_states (user_id, tier, cost_gram)
  select new.id, t, power(2, t - 1)::numeric
  from generate_series(1, 6) as t
  on conflict (user_id, tier) do nothing;

  insert into public.pvp_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- bind_referrer — call once, right after the user's first sign-in
-- -----------------------------------------------------------------------------
create or replace function public.bind_referrer(p_user_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l1 uuid;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if exists (select 1 from public.referrals where referee_id = p_user_id) then
    return false; -- already bound
  end if;

  select id into v_l1
  from public.profiles
  where referral_code = upper(trim(p_code)) and id <> p_user_id;

  if v_l1 is null then
    return false;
  end if;

  insert into public.referrals (referrer_id, referee_id, tier)
  values (v_l1, p_user_id, 1)
  on conflict (referee_id) do nothing;

  return true;
end;
$$;

revoke all on function public.bind_referrer(uuid, text) from public, anon;
grant execute on function public.bind_referrer(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- process_referral_commission — split a fee up the L1/L2/L3 chain
--   Only L1 edges are stored (one referrals row per referee); the L2/L3
--   ancestors are found by walking referee_id -> referrer_id.
-- -----------------------------------------------------------------------------
create or replace function public.process_referral_commission(p_user_id uuid, p_fee_amount numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rates constant numeric[] := array[0.05, 0.02, 0.01];
  v_child uuid := p_user_id;
  v_parent uuid;
  v_amt numeric(18, 9);
begin
  if p_fee_amount <= 0 then
    return;
  end if;

  for i in 1..3 loop
    select referrer_id into v_parent from public.referrals where referee_id = v_child;
    exit when v_parent is null;

    v_amt := round(p_fee_amount * v_rates[i], 9);
    if v_amt > 0 then
      update public.referrals
      set unclaimed_gram    = unclaimed_gram + v_amt,
          total_earned_gram = total_earned_gram + v_amt
      where referee_id = v_child;

      insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
      values (v_parent, 'REFERRAL_REWARD', 'CREDIT', v_amt, 0, 'GRAM',
              jsonb_build_object('level', i, 'source_user', p_user_id, 'accrued', true));
    end if;

    v_child := v_parent;
  end loop;
end;
$$;

revoke all on function public.process_referral_commission(uuid, numeric) from public, anon;
grant execute on function public.process_referral_commission(uuid, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- claim_referral_rewards — sweep unclaimed commission into the balance
-- -----------------------------------------------------------------------------
create or replace function public.claim_referral_rewards(p_user_id uuid)
returns table (
  tx_id              uuid,
  claimed_gram       numeric(18, 9),
  new_available_gram numeric(18, 9)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total   numeric(18, 9);
  v_balance numeric(18, 9);
  v_tx_id   uuid;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- lock this user's referral rows, then total the unclaimed pool
  perform 1 from public.referrals where referrer_id = p_user_id for update;
  select coalesce(sum(unclaimed_gram), 0) into v_total
  from public.referrals where referrer_id = p_user_id;

  if v_total <= 0 then
    raise exception 'nothing to claim' using errcode = 'P0001';
  end if;

  update public.referrals set unclaimed_gram = 0 where referrer_id = p_user_id;

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.balances
  set available_gram = available_gram + v_total
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'REFERRAL_REWARD', 'CREDIT', v_total, 0, 'GRAM',
          jsonb_build_object('claim', true));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'REFERRAL_REWARD', v_total, 0, v_total, 'COMPLETED')
  returning id into v_tx_id;

  tx_id              := v_tx_id;
  claimed_gram       := v_total;
  new_available_gram := v_balance;
  return next;
end;
$$;

revoke all on function public.claim_referral_rewards(uuid) from public, anon;
grant execute on function public.claim_referral_rewards(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Wiring: every fee-taking RPC should feed the referral chain, e.g. add
--   perform public.process_referral_commission(p_user_id, v_fee);
-- at the end of request_withdrawal / study_upgrade_character /
-- merge_user_characters / roll_tier_character (right after the fee is booked).
-- -----------------------------------------------------------------------------
