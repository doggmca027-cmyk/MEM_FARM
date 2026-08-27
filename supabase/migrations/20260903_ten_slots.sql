-- =============================================================================
-- Meme Farm — 10 card slots per tier (2 cards per rarity grade)
--   * character_templates.card_slot check -> 1..10
--   * reseed 60 templates (t<tier>_c1..c10), matching src/data/tiers.ts
--   * roll_tier_character: weighted 1..1000 roll across 10 slots
--
-- Safe reseed: card ids t*_c1..c5 are re-pointed to the new pairing scheme.
-- Do this before any real user_characters exist (fresh project).
-- =============================================================================

alter table public.character_templates drop constraint if exists character_templates_card_slot_check;
alter table public.character_templates
  add constraint character_templates_card_slot_check check (card_slot is null or card_slot between 1 and 10);

-- -----------------------------------------------------------------------------
-- Reseed — 6 tiers x 10 slots. Numeric columns are derived from (tier, slot);
-- only the 60 display names are spelled out.
-- -----------------------------------------------------------------------------
with names(tier, slot, nm) as (
  values
    (1,1,'Capy-Baby'),(1,2,'Capy-Tot'),(1,3,'Doge-Noob'),(1,4,'Doge-Pup'),(1,5,'Pepe-Clown'),
    (1,6,'Pepe-Jester'),(1,7,'Chad-Ghost'),(1,8,'Chad-Wisp'),(1,9,'King-Boo'),(1,10,'Court-Boo'),
    (2,1,'Capy-Punk'),(2,2,'Capy-Rebel'),(2,3,'Doge-Rider'),(2,4,'Doge-Racer'),(2,5,'Pepe-Wizard'),
    (2,6,'Pepe-Mage'),(2,7,'Chad-Knight'),(2,8,'Chad-Squire'),(2,9,'Queen-Boo'),(2,10,'Duchess-Boo'),
    (3,1,'Capy-Ninja'),(3,2,'Capy-Shinobi'),(3,3,'Doge-Astro'),(3,4,'Doge-Rover'),(3,5,'Pepe-Samurai'),
    (3,6,'Pepe-Ronin'),(3,7,'Chad-Viking'),(3,8,'Chad-Berserk'),(3,9,'Lord-Boo'),(3,10,'Baron-Boo'),
    (4,1,'Capy-Cyber'),(4,2,'Capy-Mecha'),(4,3,'Doge-Pilot'),(4,4,'Doge-Ace'),(4,5,'Pepe-Demon'),
    (4,6,'Pepe-Imp'),(4,7,'Chad-Titan'),(4,8,'Chad-Golem'),(4,9,'Emperor-Boo'),(4,10,'Regent-Boo'),
    (5,1,'Capy-Cosmic'),(5,2,'Capy-Nebula'),(5,3,'Doge-Prime'),(5,4,'Doge-Vector'),(5,5,'Pepe-Oracle'),
    (5,6,'Pepe-Seer'),(5,7,'Chad-Colossus'),(5,8,'Chad-Leviathan'),(5,9,'Gigaboo'),(5,10,'Ultraboo'),
    (6,1,'Capy-Genesis'),(6,2,'Capy-Bang'),(6,3,'Doge-Nova'),(6,4,'Doge-Quasar'),(6,5,'Pepe-Seraph'),
    (6,6,'Pepe-Cherub'),(6,7,'Chad-Warlord'),(6,8,'Chad-Overlord'),(6,9,'Omega-Boo'),(6,10,'Alpha-Boo')
),
gen as (
  select
    t.tier, s.slot,
    case when s.slot in (1, 2) then 'common'
         when s.slot in (3, 4) then 'uncommon'
         when s.slot in (5, 6) then 'rare'
         when s.slot in (7, 8) then 'epic'
         else 'legendary' end                                            as rarity,
    case when s.slot in (1, 2) then 'capybara'
         when s.slot in (3, 4) then 'doge'
         when s.slot in (5, 6) then 'pepe'
         else 'gigachad' end                                             as meme_type,
    round(
      (case when s.slot in (1, 2) then 0.025
            when s.slot in (3, 4) then 0.035
            when s.slot in (5, 6) then 0.050
            when s.slot in (7, 8) then 0.075
            else 0.120 end) * power(2, t.tier - 1)::numeric, 9)          as base_income_day,
    (s.slot * 100 * t.tier)                                              as base_power,
    case when s.slot in (9, 10) then 12 else 10 end                      as max_level,
    case when s.slot in (9, 10) then 40 else 20 end                      as merge_cost_fragments,
    (array[300, 300, 125, 125, 45, 45, 20, 20, 10, 10])[s.slot]         as drop_weight
  from generate_series(1, 6) as t(tier)
  cross join generate_series(1, 10) as s(slot)
)
insert into public.character_templates
  (id, name, meme_type, rarity, base_income_day, base_power, max_level, merge_cost_fragments, drop_weight, tier, card_slot)
select
  format('t%s_c%s', g.tier, g.slot),
  n.nm, g.meme_type, g.rarity, g.base_income_day, g.base_power,
  g.max_level, g.merge_cost_fragments, g.drop_weight, g.tier, g.slot
from gen g
join names n on n.tier = g.tier and n.slot = g.slot
on conflict (id) do update set
  name                 = excluded.name,
  meme_type            = excluded.meme_type,
  rarity               = excluded.rarity,
  base_income_day      = excluded.base_income_day,
  base_power           = excluded.base_power,
  max_level            = excluded.max_level,
  merge_cost_fragments = excluded.merge_cost_fragments,
  drop_weight          = excluded.drop_weight,
  tier                 = excluded.tier,
  card_slot            = excluded.card_slot;

-- -----------------------------------------------------------------------------
-- roll_tier_character — 10-slot weighted roll (per-mille, sum = 1000)
--   1..300 s1 · 301..600 s2 · 601..725 s3 · 726..850 s4 · 851..895 s5
--   896..940 s6 · 941..960 s7 · 961..980 s8 · 981..990 s9 · 991..1000 s10
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

  v_roll := floor(random() * 1000)::int + 1;   -- 1..1000
  v_slot := case
              when v_roll <= 300 then 1
              when v_roll <= 600 then 2
              when v_roll <= 725 then 3
              when v_roll <= 850 then 4
              when v_roll <= 895 then 5
              when v_roll <= 940 then 6
              when v_roll <= 960 then 7
              when v_roll <= 980 then 8
              when v_roll <= 990 then 9
              else 10
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
