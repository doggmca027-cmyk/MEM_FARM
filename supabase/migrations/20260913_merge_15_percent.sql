-- =============================================================================
-- Meme Farm — merge odds re-tuned to 15% success / 85% burn
--   merge_user_characters roll (1..100):
--     v_roll <= 85  -> FAIL  (burn the material, charge mergeFee, status 'FAIL')
--     v_roll >  85  -> SUCCESS, sub-roll the level gain:
--                        +1 (80%) · +2 (14%) · +3 (5%) · +4 (1%)
--   Everything else (income = base*1.75^(lvl-1), power formula, XP on success)
--   is unchanged from 20260911.
-- =============================================================================

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
  v_tier       smallint;
  v_base       numeric(18, 9);
  v_base_pw    numeric(18, 9);
  v_fee        numeric(18, 9);
  v_balance    numeric(18, 9);
  v_ids        uuid[];
  v_survivor   uuid;
  v_material   uuid;
  v_study_lvl  int;
  v_roll       int;
  v_sub        int;
  v_status     text;
  v_delta      int;
  v_new_level  int;
  v_income     numeric(18, 9);
  v_power      numeric(18, 9);
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select tier, base_income_day, base_power into v_tier, v_base, v_base_pw
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

  select coalesce(study_level, 0) into v_study_lvl
  from public.user_characters where id = v_survivor;

  -- 15% success / 85% burn, then a sub-roll for the level gain
  v_roll := floor(random() * 100)::int + 1;
  if v_roll <= 85 then
    v_status := 'FAIL';
    v_delta  := 0;
  else
    v_sub := floor(random() * 100)::int + 1;
    v_delta := case
                 when v_sub <= 80 then 1
                 when v_sub <= 94 then 2
                 when v_sub <= 99 then 3
                 else 4
               end;
    v_status := case when v_delta = 1 then 'SUCCESS' else 'CRIT' end;
  end if;

  delete from public.user_characters where id = v_material;

  if v_status = 'FAIL' then
    v_new_level := p_level;
    select current_income_day, coalesce(current_power, 0)
      into v_income, v_power
    from public.user_characters where id = v_survivor;
  else
    v_new_level := least(v_cap, p_level + v_delta);
    v_income := round(v_base * power(1.75, v_new_level - 1), 9);
    v_power  := round(
      coalesce(v_base_pw, 0)
      * (1 + 0.35 * (v_new_level - 1) + 0.50 * v_study_lvl), 9);
    update public.user_characters
    set level = v_new_level, current_income_day = v_income, current_power = v_power
    where id = v_survivor;
  end if;

  v_delta := v_new_level - p_level;

  update public.balances
  set available_gram = available_gram - v_fee
  where user_id = p_user_id
  returning available_gram into v_balance;

  -- leaderboard XP on a successful craft (never spent)
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
