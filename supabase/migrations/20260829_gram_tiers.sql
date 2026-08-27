-- =============================================================================
-- Meme Farm — GRAM currency + 6-tier weighted gacha
--   * TON  -> GRAM (column renames, asset check, defaults)
--   * character_templates gains tier / card_slot / drop_weight
--   * new tx type: TIER_ROLL
--   * tier_states table (per-user tier progress)
--   * roll_tier_character() RPC — weighted 1..100 roll, SECURITY DEFINER
--   * seed: 30 templates (6 tiers x 5 cards)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TON -> GRAM
-- -----------------------------------------------------------------------------

alter table public.balances rename column available_ton to available_gram;
alter table public.balances rename column pending_ton   to pending_gram;
alter table public.balances rename column locked_ton    to locked_gram;

alter table public.farm_slots rename column unlock_price_ton to unlock_price_gram;

-- asset: allow GRAM and make it the default
alter table public.ledger_entries drop constraint if exists ledger_entries_asset_check;
alter table public.ledger_entries
  add constraint ledger_entries_asset_check check (asset in ('TON', 'GRAM'));
alter table public.ledger_entries alter column asset set default 'GRAM';

-- -----------------------------------------------------------------------------
-- 2. new transaction type: TIER_ROLL
-- -----------------------------------------------------------------------------

alter table public.ledger_entries drop constraint if exists ledger_entries_transaction_type_check;
alter table public.ledger_entries
  add constraint ledger_entries_transaction_type_check check (transaction_type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE',
    'MERGE_FEE', 'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD'
  ));

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE',
    'MERGE_FEE', 'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD'
  ));

-- -----------------------------------------------------------------------------
-- 3. character_templates: gacha metadata + 5th rarity
-- -----------------------------------------------------------------------------

alter table public.character_templates add column if not exists tier        smallint;
alter table public.character_templates add column if not exists card_slot   smallint;
alter table public.character_templates add column if not exists drop_weight smallint;

alter table public.character_templates drop constraint if exists character_templates_rarity_check;
alter table public.character_templates
  add constraint character_templates_rarity_check
  check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary'));

alter table public.character_templates
  add constraint character_templates_tier_check check (tier is null or tier between 1 and 6);
alter table public.character_templates
  add constraint character_templates_card_slot_check check (card_slot is null or card_slot between 1 and 5);

-- drop the placeholder roster from the init migration
delete from public.character_templates
where id in ('capybara_pizzaboo', 'pepe_devilboo', 'doge_balloonboo', 'gigachad_prime');

-- -----------------------------------------------------------------------------
-- 4. tier_states — per-user tier progress
-- -----------------------------------------------------------------------------

create table if not exists public.tier_states (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  tier       smallint not null check (tier between 1 and 6),
  cost_gram  numeric(18, 9) not null,
  hat_item_id uuid,
  /** distinct card slots (1..5) the player has rolled at least once */
  discovered smallint[] not null default '{}',
  primary key (user_id, tier)
);

alter table public.tier_states enable row level security;

create policy "tier_states_select_own" on public.tier_states
  for select using (auth.uid() = user_id);

grant select on public.tier_states to authenticated;

-- provision the 6 tier rows for new users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, telegram_id, username, first_name)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'telegram_id', '')::bigint,
    new.raw_user_meta_data ->> 'username',
    new.raw_user_meta_data ->> 'first_name'
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

  return new;
end;
$$;

-- backfill tier_states for existing profiles
insert into public.tier_states (user_id, tier, cost_gram)
select p.id, t, power(2, t - 1)::numeric
from public.profiles p
cross join generate_series(1, 6) as t
on conflict (user_id, tier) do nothing;

-- -----------------------------------------------------------------------------
-- 5. RPCs — refresh for GRAM column names, add roll_tier_character
-- -----------------------------------------------------------------------------

drop function if exists public.unlock_farm_slot(uuid, int);

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

  v_elapsed_sec := greatest(extract(epoch from (now() - v_state.last_accrual_at)), 0);
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
                             'elapsed_seconds', round(v_elapsed_sec)));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'FARM_CLAIM', v_earned, 0, v_earned, 'COMPLETED');

  update public.farm_states
  set last_accrual_at = now(), next_claim_at = v_next_claim
  where user_id = p_user_id;

  earned_gram        := v_earned;
  new_available_gram := v_new_balance;
  next_claim_at      := v_next_claim;
  return next;
end;
$$;

revoke all on function public.claim_farm_income(uuid) from public, anon;
grant execute on function public.claim_farm_income(uuid) to authenticated;

-- ---- roll_tier_character -------------------------------------------------------
-- Weighted 1..100 roll:
--   1..60 -> slot 1 (Common)     61..85 -> slot 2 (Uncommon)
--   86..94 -> slot 3 (Rare)      95..98 -> slot 4 (Epic)
--   99..100 -> slot 5 (Legendary Jackpot)
create or replace function public.roll_tier_character(p_user_id uuid, p_tier int)
returns table (
  template_id      text,
  name             text,
  rarity           text,
  card_slot        int,
  income_day       numeric(18, 9),
  new_balance_gram numeric(18, 9)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cost    numeric(18, 9);
  v_balance numeric(18, 9);
  v_roll    int;
  v_slot    int;
  v_tpl     public.character_templates%rowtype;
  v_uc_id   uuid;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_tier < 1 or p_tier > 6 then
    raise exception 'invalid tier %', p_tier using errcode = '22023';
  end if;

  v_cost := power(2, p_tier - 1)::numeric;   -- 1,2,4,8,16,32

  select available_gram into v_balance
  from public.balances
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'balance not found for user %', p_user_id using errcode = 'P0002';
  end if;
  if v_balance < v_cost then
    raise exception 'insufficient funds: have %, need %', v_balance, v_cost using errcode = 'P0001';
  end if;

  v_roll := floor(random() * 100)::int + 1;               -- 1..100
  v_slot := case
              when v_roll <= 60 then 1
              when v_roll <= 85 then 2
              when v_roll <= 94 then 3
              when v_roll <= 98 then 4
              else 5
            end;

  select * into v_tpl
  from public.character_templates
  where tier = p_tier and card_slot = v_slot
  limit 1;

  if not found then
    raise exception 'no template for tier % slot %', p_tier, v_slot using errcode = 'P0002';
  end if;

  update public.balances
  set available_gram = available_gram - v_cost
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.user_characters (user_id, template_id, level, current_income_day, is_equipped)
  values (p_user_id, v_tpl.id, 1, v_tpl.base_income_day, true)
  returning id into v_uc_id;

  insert into public.tier_states (user_id, tier, cost_gram, discovered)
  values (p_user_id, p_tier, v_cost, array[v_slot]::smallint[])
  on conflict (user_id, tier) do update
    set discovered = case
      when v_slot = any (public.tier_states.discovered) then public.tier_states.discovered
      else array_append(public.tier_states.discovered, v_slot::smallint)
    end;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'TIER_ROLL', 'DEBIT', v_cost, 0, 'GRAM',
          jsonb_build_object('tier', p_tier, 'card_slot', v_slot,
                             'template_id', v_tpl.id, 'user_character_id', v_uc_id,
                             'roll', v_roll));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'TIER_ROLL', v_cost, 0, v_cost, 'COMPLETED');

  template_id      := v_tpl.id;
  name             := v_tpl.name;
  rarity           := v_tpl.rarity;
  card_slot        := v_slot;
  income_day       := v_tpl.base_income_day;
  new_balance_gram := v_balance;
  return next;
end;
$$;

revoke all on function public.roll_tier_character(uuid, int) from public, anon;
grant execute on function public.roll_tier_character(uuid, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. SEED — 30 templates (tier x card_slot). base_income_day in GRAM/day.
--    slot: 1 Common(60) 2 Uncommon(25) 3 Rare(9) 4 Epic(4) 5 Legendary(2)
-- -----------------------------------------------------------------------------

insert into public.character_templates
  (id, name, meme_type, rarity, base_income_day, base_power, max_level, merge_cost_fragments, drop_weight, tier, card_slot)
values
  -- Tier 1 (1 GRAM)
  ('t1_c1', 'Capy-Baby',   'capybara', 'common',    0.025,  100, 10, 20, 60, 1, 1),
  ('t1_c2', 'Doge-Noob',   'doge',     'uncommon',  0.035,  180, 10, 20, 25, 1, 2),
  ('t1_c3', 'Pepe-Clown',  'pepe',     'rare',      0.050,  260, 10, 20,  9, 1, 3),
  ('t1_c4', 'Chad-Ghost',  'gigachad', 'epic',      0.075,  360, 10, 20,  4, 1, 4),
  ('t1_c5', 'King-Boo',    'gigachad', 'legendary', 0.120,  520, 12, 40,  2, 1, 5),
  -- Tier 2 (2 GRAM)
  ('t2_c1', 'Capy-Punk',   'capybara', 'common',    0.050,  200, 10, 20, 60, 2, 1),
  ('t2_c2', 'Doge-Rider',  'doge',     'uncommon',  0.070,  360, 10, 20, 25, 2, 2),
  ('t2_c3', 'Pepe-Wizard', 'pepe',     'rare',      0.100,  520, 10, 20,  9, 2, 3),
  ('t2_c4', 'Chad-Knight', 'gigachad', 'epic',      0.150,  720, 10, 20,  4, 2, 4),
  ('t2_c5', 'Queen-Boo',   'gigachad', 'legendary', 0.240, 1040, 12, 40,  2, 2, 5),
  -- Tier 3 (4 GRAM)
  ('t3_c1', 'Capy-Ninja',    'capybara', 'common',    0.100,  400, 10, 20, 60, 3, 1),
  ('t3_c2', 'Doge-Astro',    'doge',     'uncommon',  0.140,  720, 10, 20, 25, 3, 2),
  ('t3_c3', 'Pepe-Samurai',  'pepe',     'rare',      0.200, 1040, 10, 20,  9, 3, 3),
  ('t3_c4', 'Chad-Viking',   'gigachad', 'epic',      0.300, 1440, 10, 20,  4, 3, 4),
  ('t3_c5', 'Lord-Boo',      'gigachad', 'legendary', 0.480, 2080, 12, 40,  2, 3, 5),
  -- Tier 4 (8 GRAM)
  ('t4_c1', 'Capy-Cyber',    'capybara', 'common',    0.200,  800, 10, 20, 60, 4, 1),
  ('t4_c2', 'Doge-Pilot',    'doge',     'uncommon',  0.280, 1440, 10, 20, 25, 4, 2),
  ('t4_c3', 'Pepe-Demon',    'pepe',     'rare',      0.400, 2080, 10, 20,  9, 4, 3),
  ('t4_c4', 'Chad-Titan',    'gigachad', 'epic',      0.600, 2880, 10, 20,  4, 4, 4),
  ('t4_c5', 'Emperor-Boo',   'gigachad', 'legendary', 0.960, 4160, 12, 40,  2, 4, 5),
  -- Tier 5 (16 GRAM)
  ('t5_c1', 'Capy-Cosmic',   'capybara', 'common',    0.400, 1600, 10, 20, 60, 5, 1),
  ('t5_c2', 'Doge-Prime',    'doge',     'uncommon',  0.560, 2880, 10, 20, 25, 5, 2),
  ('t5_c3', 'Pepe-Oracle',   'pepe',     'rare',      0.800, 4160, 10, 20,  9, 5, 3),
  ('t5_c4', 'Chad-Colossus', 'gigachad', 'epic',      1.200, 5760, 10, 20,  4, 5, 4),
  ('t5_c5', 'Gigaboo',       'gigachad', 'legendary', 1.920, 8320, 12, 40,  2, 5, 5),
  -- Tier 6 (32 GRAM)
  ('t6_c1', 'Capy-Genesis',  'capybara', 'common',    0.800,  3200, 10, 20, 60, 6, 1),
  ('t6_c2', 'Doge-Nova',     'doge',     'uncommon',  1.120,  5760, 10, 20, 25, 6, 2),
  ('t6_c3', 'Pepe-Seraph',   'pepe',     'rare',      1.600,  8320, 10, 20,  9, 6, 3),
  ('t6_c4', 'Chad-Warlord',  'gigachad', 'epic',      2.400, 11520, 10, 20,  4, 6, 4),
  ('t6_c5', 'Omega-Boo',     'gigachad', 'legendary', 3.840, 16640, 12, 40,  2, 6, 5)
on conflict (id) do update set
  name            = excluded.name,
  meme_type       = excluded.meme_type,
  rarity          = excluded.rarity,
  base_income_day = excluded.base_income_day,
  base_power      = excluded.base_power,
  drop_weight     = excluded.drop_weight,
  tier            = excluded.tier,
  card_slot       = excluded.card_slot;
