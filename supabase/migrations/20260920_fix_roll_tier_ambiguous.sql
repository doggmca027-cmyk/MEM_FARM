-- =============================================================================
-- Meme Farm — fix roll_tier_character: "column reference card_slot is ambiguous"
--
-- The RETURNS TABLE column `card_slot` shadowed character_templates.card_slot
-- inside the template lookup's WHERE clause, so every live tier roll raised
-- 42702 and the client (which swallows the error) simply did nothing.
-- Fix: alias the table and qualify every column in that query. Function body
-- is otherwise identical to 20260911.
-- =============================================================================

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

  -- alias + fully-qualified columns: `card_slot` here is the table column,
  -- never the RETURNS TABLE output parameter of the same name.
  select ct.* into v_tpl
  from public.character_templates ct
  where ct.tier = p_tier and ct.card_slot = v_slot
  limit 1;
  if not found then
    raise exception 'no template for tier % slot %', p_tier, v_slot using errcode = 'P0002';
  end if;

  update public.balances
  set available_gram = available_gram - v_cost
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.user_characters
    (user_id, template_id, level, study_level, current_income_day, current_power, is_equipped)
  values
    (p_user_id, v_tpl.id, 1, 0, v_tpl.base_income_day, v_tpl.base_power, true)
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

revoke all on function public.roll_tier_character(uuid, int) from public, anon;
grant execute on function public.roll_tier_character(uuid, int) to authenticated;
