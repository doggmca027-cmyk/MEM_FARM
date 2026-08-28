-- =============================================================================
-- Meme Farm — final economy pass
--   * character_templates back to 30 rows (6 tiers x 5 cards)
--   * pvp_profiles.xp — pure, never-spent leaderboard metric
--   * study_upgrade_character: GRAM fee 0.05 * 1.5^(level-1), FOR UPDATE
--   * roll_tier_character: 5-slot weighted roll + +10 XP
--   * merge_user_characters: + XP on a successful craft
--   * claim_daily_streak: 'xp' ladder days credit pvp_profiles.xp
--   * execute_pvp_battle(p_reward_xp): xp = xp + p_reward_xp, no deductions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. character_templates -> 30 rows
-- -----------------------------------------------------------------------------
delete from public.character_templates;   -- safe: no user_characters reference them yet

alter table public.character_templates drop constraint if exists character_templates_card_slot_check;
alter table public.character_templates
  add constraint character_templates_card_slot_check check (card_slot is null or card_slot between 1 and 5);

with names(tier, slot, nm) as (
  values
    (1,1,'Capy-Baby'),(1,2,'Doge-Noob'),(1,3,'Pepe-Clown'),(1,4,'Chad-Ghost'),(1,5,'King-Boo'),
    (2,1,'Capy-Punk'),(2,2,'Doge-Rider'),(2,3,'Pepe-Wizard'),(2,4,'Chad-Knight'),(2,5,'Queen-Boo'),
    (3,1,'Capy-Ninja'),(3,2,'Doge-Astro'),(3,3,'Pepe-Samurai'),(3,4,'Chad-Viking'),(3,5,'Lord-Boo'),
    (4,1,'Capy-Cyber'),(4,2,'Doge-Pilot'),(4,3,'Pepe-Demon'),(4,4,'Chad-Titan'),(4,5,'Emperor-Boo'),
    (5,1,'Capy-Cosmic'),(5,2,'Doge-Prime'),(5,3,'Pepe-Oracle'),(5,4,'Chad-Colossus'),(5,5,'Gigaboo'),
    (6,1,'Capy-Genesis'),(6,2,'Doge-Nova'),(6,3,'Pepe-Seraph'),(6,4,'Chad-Warlord'),(6,5,'Omega-Boo')
),
gen as (
  select
    t.tier, s.slot,
    (array['common','uncommon','rare','epic','legendary'])[s.slot]           as rarity,
    (array['capybara','doge','pepe','gigachad','gigachad'])[s.slot]          as meme_type,
    round((array[0.025, 0.035, 0.050, 0.075, 0.120]::numeric[])[s.slot]
          * power(2, t.tier - 1)::numeric, 9)                                as base_income_day,
    (s.slot * 100 * t.tier)                                                  as base_power,
    case when s.slot = 5 then 12 else 10 end                                 as max_level,
    (array[60, 25, 9, 4, 2])[s.slot]                                         as drop_weight
  from generate_series(1, 6) as t(tier)
  cross join generate_series(1, 5) as s(slot)
)
insert into public.character_templates
  (id, name, meme_type, rarity, base_income_day, base_power, max_level, drop_weight, tier, card_slot)
select format('t%s_c%s', g.tier, g.slot), n.nm, g.meme_type, g.rarity,
       g.base_income_day, g.base_power, g.max_level, g.drop_weight, g.tier, g.slot
from gen g
join names n on n.tier = g.tier and n.slot = g.slot;

-- -----------------------------------------------------------------------------
-- 2. XP leaderboard column
-- -----------------------------------------------------------------------------
alter table public.pvp_profiles add column if not exists xp bigint not null default 0;

-- -----------------------------------------------------------------------------
-- 3. study_upgrade_character — GRAM fee 0.05 * 1.5^(level-1)
-- -----------------------------------------------------------------------------
create or replace function public.study_upgrade_character(
  p_user_id            uuid,
  p_user_character_id  uuid
)
returns table (
  new_level          integer,
  new_income_day     numeric(18, 9),
  new_power          numeric(18, 9),
  new_available_gram numeric(18, 9)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uc      public.user_characters%rowtype;
  v_fee     numeric(18, 9);
  v_income  numeric(18, 9);
  v_power   numeric(18, 9);
  v_balance numeric(18, 9);
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_uc
  from public.user_characters
  where id = p_user_character_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'character not found' using errcode = 'P0002';
  end if;

  v_fee := round(0.05 * power(1.5, v_uc.level - 1), 9);

  select available_gram into v_balance
  from public.balances
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'balance not found' using errcode = 'P0002';
  end if;
  if v_balance < v_fee then
    raise exception 'insufficient funds: have %, need %', v_balance, v_fee using errcode = 'P0001';
  end if;

  v_income := round(v_uc.current_income_day * 2, 9);
  v_power  := round(coalesce(v_uc.current_power, 0) * 1.5, 9);

  update public.user_characters
  set level = level + 1, current_income_day = v_income, current_power = v_power
  where id = p_user_character_id;

  update public.balances
  set available_gram = available_gram - v_fee
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'STUDY_FEE', 'DEBIT', v_fee, 0, 'GRAM',
          jsonb_build_object('user_character_id', p_user_character_id, 'to_level', v_uc.level + 1));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'STUDY_FEE', v_fee, 0, v_fee, 'COMPLETED');

  new_level          := v_uc.level + 1;
  new_income_day     := v_income;
  new_power          := v_power;
  new_available_gram := v_balance;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. roll_tier_character — 5-slot weighted roll + bonus XP
--    1..60 s1 · 61..85 s2 · 86..94 s3 · 95..98 s4 · 99..100 s5
-- -----------------------------------------------------------------------------
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

  v_cost := power(2, p_tier - 1)::numeric;

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

  v_roll := floor(random() * 100)::int + 1;
  v_slot := case
              when v_roll <= 60 then 1
              when v_roll <= 85 then 2
              when v_roll <= 94 then 3
              when v_roll <= 98 then 4
              else 5
            end;

  select * into v_tpl from public.character_templates
  where tier = p_tier and card_slot = v_slot limit 1;
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
                             'template_id', v_tpl.id, 'user_character_id', v_uc_id, 'roll', v_roll));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'TIER_ROLL', v_cost, 0, v_cost, 'COMPLETED');

  -- leaderboard XP (never spent)
  update public.pvp_profiles set xp = xp + 10 where user_id = p_user_id;

  template_id      := v_tpl.id;
  name             := v_tpl.name;
  rarity           := v_tpl.rarity;
  card_slot        := v_slot;
  income_day       := v_tpl.base_income_day;
  new_balance_gram := v_balance;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. merge_user_characters — grant XP on a successful craft
-- -----------------------------------------------------------------------------
create or replace function public.merge_user_characters(
  p_user_id     uuid,
  p_template_id text,
  p_level       int
)
returns table (
  status             text,
  delta              integer,
  roll               integer,
  merged_id          uuid,
  new_level          integer,
  new_income_day     numeric(18, 9),
  new_power          numeric(18, 9),
  fee                numeric(18, 9),
  new_available_gram numeric(18, 9)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap constant int := 10;
  v_tier      smallint;
  v_base      numeric(18, 9);
  v_fee       numeric(18, 9);
  v_balance   numeric(18, 9);
  v_ids       uuid[];
  v_survivor  uuid;
  v_material  uuid;
  v_src_power numeric(18, 9);
  v_roll      int;
  v_status    text;
  v_bucket    int;
  v_new_level int;
  v_delta     int;
  v_income    numeric(18, 9);
  v_power     numeric(18, 9);
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select tier, base_income_day into v_tier, v_base
  from public.character_templates where id = p_template_id;
  if not found then
    raise exception 'template % not found', p_template_id using errcode = 'P0002';
  end if;

  select array_agg(id order by created_at) into v_ids
  from (
    select id, created_at
    from public.user_characters
    where user_id = p_user_id and template_id = p_template_id and level = p_level
    order by created_at
    limit 2
    for update
  ) s;

  if coalesce(array_length(v_ids, 1), 0) < 2 then
    raise exception 'need 2 duplicates of % at level %', p_template_id, p_level using errcode = 'P0001';
  end if;

  v_survivor := v_ids[1];
  v_material := v_ids[2];
  v_fee := round(0.02 * power(2, coalesce(v_tier, 1) - 1), 9);

  select available_gram into v_balance
  from public.balances where user_id = p_user_id for update;
  if not found then
    raise exception 'balance not found' using errcode = 'P0002';
  end if;
  if v_balance < v_fee then
    raise exception 'insufficient funds: have %, need %', v_balance, v_fee using errcode = 'P0001';
  end if;

  select coalesce(current_power, 0) into v_src_power
  from public.user_characters where id = v_survivor;

  v_roll := floor(random() * 100)::int + 1;
  v_status := case when v_roll <= 30 then 'FAIL' when v_roll <= 85 then 'SUCCESS' else 'CRIT' end;
  v_bucket := case
                when v_roll <= 30 then 0
                when v_roll <= 85 then 1
                when v_roll <= 95 then 2
                when v_roll <= 99 then 3
                else 4
              end;

  delete from public.user_characters where id = v_material;

  if v_status = 'FAIL' then
    v_new_level := p_level;
    select current_income_day, coalesce(current_power, 0)
      into v_income, v_power
    from public.user_characters where id = v_survivor;
  else
    v_new_level := least(v_cap, p_level + v_bucket);
    v_income := round(v_base * power(1.75, v_new_level - 1), 9);
    v_power  := round(v_src_power * power(1.75, v_new_level - p_level), 9);
    update public.user_characters
    set level = v_new_level, current_income_day = v_income, current_power = v_power
    where id = v_survivor;
  end if;

  v_delta := v_new_level - p_level;

  update public.balances
  set available_gram = available_gram - v_fee
  where user_id = p_user_id
  returning available_gram into v_balance;

  -- leaderboard XP on a successful craft
  if v_status <> 'FAIL' then
    update public.pvp_profiles set xp = xp + 30 + v_delta * 15 where user_id = p_user_id;
  end if;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'MERGE_FEE', 'DEBIT', v_fee, 0, 'GRAM',
          jsonb_build_object('template_id', p_template_id, 'status', v_status,
                             'roll', v_roll, 'delta', v_delta,
                             'from_level', p_level, 'to_level', v_new_level,
                             'burned', v_material, 'survivor', v_survivor));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'MERGE_FEE', v_fee, 0, v_fee, 'COMPLETED');

  status             := v_status;
  delta              := v_delta;
  roll               := v_roll;
  merged_id          := v_survivor;
  new_level          := v_new_level;
  new_income_day     := v_income;
  new_power          := v_power;
  fee                := v_fee;
  new_available_gram := v_balance;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. claim_daily_streak — 'xp' ladder days credit pvp_profiles.xp
-- -----------------------------------------------------------------------------
create or replace function public.claim_daily_streak(p_user_id uuid)
returns table (
  streak_day         integer,
  reward_kind        text,
  reward_amount      numeric(18, 9),
  new_available_gram numeric(18, 9)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p       public.pvp_profiles%rowtype;
  v_today   date := (now() at time zone 'utc')::date;
  v_gap     integer;
  v_prev    integer;
  v_day     integer;
  v_kind    text;
  v_amount  numeric(18, 9);
  v_balance numeric(18, 9);
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_p from public.pvp_profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'pvp profile not found' using errcode = 'P0002';
  end if;
  if v_p.last_check_in = v_today then
    raise exception 'already checked in today' using errcode = 'P0001';
  end if;

  v_gap  := case when v_p.last_check_in is null then 999 else v_today - v_p.last_check_in end;
  v_prev := case when v_gap = 1 then v_p.streak_day else 0 end;
  v_day  := case when v_prev >= 7 then 1 else v_prev + 1 end;

  select k, a into v_kind, v_amount from (values
    (1, 'xp'::text,        150::numeric),
    (2, 'gram',            0.05),
    (3, 'tickets',         2),
    (4, 'xp',              300),
    (5, 'tickets',         1),
    (6, 'gram',            0.12),
    (7, 'case',            1)
  ) as ladder(d, k, a) where d = v_day;

  select available_gram into v_balance from public.balances where user_id = p_user_id for update;

  if v_kind = 'gram' then
    update public.balances set available_gram = available_gram + v_amount
    where user_id = p_user_id returning available_gram into v_balance;

    insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
    values (p_user_id, 'STREAK_REWARD', 'CREDIT', v_amount, 0, 'GRAM',
            jsonb_build_object('streak_day', v_day));
    insert into public.transactions (user_id, type, amount, fee, net_amount, status)
    values (p_user_id, 'STREAK_REWARD', v_amount, 0, v_amount, 'COMPLETED');

  elsif v_kind = 'tickets' then
    update public.pvp_profiles
    set tickets = least(max_tickets, tickets + v_amount::int)
    where user_id = p_user_id;

  elsif v_kind = 'xp' then
    update public.pvp_profiles set xp = xp + v_amount::bigint where user_id = p_user_id;
  end if;

  update public.pvp_profiles
  set streak_day = v_day,
      last_check_in = v_today,
      daily_buff_until = case when v_day = 7 then now() + interval '24 hours' else daily_buff_until end,
      updated_at = now()
  where user_id = p_user_id;

  streak_day         := v_day;
  reward_kind        := v_kind;
  reward_amount      := v_amount;
  new_available_gram := v_balance;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. execute_pvp_battle(p_reward_xp) — increment-only XP, no deductions
-- -----------------------------------------------------------------------------
drop function if exists public.execute_pvp_battle(uuid, integer, uuid);

create or replace function public.execute_pvp_battle(
  p_user_id        uuid,
  p_opponent_power integer,
  p_opponent_id    uuid default null,
  p_reward_xp      integer default 0
)
returns table (
  won          boolean,
  rating_delta integer,
  new_rating   integer,
  tickets_left integer,
  user_power   integer,
  win_chance   numeric,
  xp_total     bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p      public.pvp_profiles%rowtype;
  v_refill interval := interval '30 minutes';
  v_gained integer;
  v_power  integer;
  v_chance numeric;
  v_won    boolean;
  v_delta  integer;
  v_rating integer;
  v_xp     bigint;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_opponent_power <= 0 then
    raise exception 'invalid opponent power' using errcode = '22023';
  end if;

  select * into v_p from public.pvp_profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'pvp profile not found' using errcode = 'P0002';
  end if;

  if v_p.tickets < v_p.max_tickets then
    v_gained := floor(extract(epoch from (now() - v_p.last_ticket_refill)) / extract(epoch from v_refill));
    if v_gained > 0 then
      v_p.tickets := least(v_p.max_tickets, v_p.tickets + v_gained);
      v_p.last_ticket_refill := v_p.last_ticket_refill + (v_gained * v_refill);
    end if;
  else
    v_p.last_ticket_refill := now();
  end if;

  if v_p.tickets <= 0 then
    raise exception 'no raid tickets' using errcode = 'P0001';
  end if;

  select coalesce(sum(coalesce(current_power, 0)), 0)::int into v_power
  from public.user_characters where user_id = p_user_id;

  v_chance := v_power::numeric / nullif(v_power + p_opponent_power, 0);
  v_won    := random() < v_chance;
  v_delta  := case when v_won
                   then greatest(8, round(30 * (1 - v_chance))::int + 12)
                   else -greatest(6, round(18 * v_chance)::int) end;
  v_rating := greatest(0, v_p.rating + v_delta);
  v_xp     := v_p.xp + greatest(0, p_reward_xp);

  update public.pvp_profiles
  set tickets = v_p.tickets - 1,
      last_ticket_refill = v_p.last_ticket_refill,
      rating = v_rating,
      xp = v_xp,               -- increment only, never spent
      updated_at = now()
  where user_id = p_user_id;

  if v_won and p_opponent_id is not null then
    insert into public.event_queue (user_id, type, metadata)
    values (p_opponent_id, 'PVP_ATTACK',
            jsonb_build_object('attacker', p_user_id, 'rating_delta', v_delta));
  end if;

  won          := v_won;
  rating_delta := v_delta;
  new_rating   := v_rating;
  tickets_left := v_p.tickets - 1;
  user_power   := v_power;
  win_chance   := round(v_chance, 4);
  xp_total     := v_xp;
  return next;
end;
$$;

revoke all on function public.execute_pvp_battle(uuid, integer, uuid, integer) from public, anon;
grant execute on function public.execute_pvp_battle(uuid, integer, uuid, integer) to authenticated;
