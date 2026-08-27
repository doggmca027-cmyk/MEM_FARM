-- =============================================================================
-- Meme Farm — Risk/Reward merge outcomes
--   merge_user_characters now rolls 1..100:
--     1..30   FAIL     — material burns, survivor stays at level N
--     31..85  SUCCESS  — survivor -> N+1
--     86..95  CRIT     — survivor -> N+2
--     96..99  CRIT     — survivor -> N+3
--     100     CRIT     — survivor -> N+4   (jackpot)
--   Level is clamped at 10. The material row always burns; MERGE_FEE is charged
--   on every attempt (FAIL included).
-- =============================================================================

-- return type gains status / delta / roll -> must drop the old signature first
drop function if exists public.merge_user_characters(uuid, text, int);

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
  v_tier        smallint;
  v_base        numeric(18, 9);
  v_fee         numeric(18, 9);
  v_balance     numeric(18, 9);
  v_ids         uuid[];
  v_survivor    uuid;
  v_material    uuid;
  v_src_power   numeric(18, 9);
  v_roll        int;
  v_status      text;
  v_bucket      int;
  v_new_level   int;
  v_delta       int;
  v_income      numeric(18, 9);
  v_power       numeric(18, 9);
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select tier, base_income_day into v_tier, v_base
  from public.character_templates
  where id = p_template_id;

  if not found then
    raise exception 'template % not found', p_template_id using errcode = 'P0002';
  end if;

  -- lock the two oldest matching duplicates: [1] survives, [2] is the material
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
  from public.balances
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'balance not found' using errcode = 'P0002';
  end if;
  if v_balance < v_fee then
    raise exception 'insufficient funds: have %, need %', v_balance, v_fee using errcode = 'P0001';
  end if;

  select coalesce(current_power, 0) into v_src_power
  from public.user_characters where id = v_survivor;

  -- roll the outcome
  v_roll := floor(random() * 100)::int + 1;   -- 1..100
  v_status := case
                when v_roll <= 30 then 'FAIL'
                when v_roll <= 85 then 'SUCCESS'
                else 'CRIT'
              end;
  v_bucket := case
                when v_roll <= 30 then 0
                when v_roll <= 85 then 1
                when v_roll <= 95 then 2
                when v_roll <= 99 then 3
                else 4
              end;

  -- the material row always burns
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
    set level = v_new_level,
        current_income_day = v_income,
        current_power = v_power
    where id = v_survivor;
  end if;

  v_delta := v_new_level - p_level;

  update public.balances
  set available_gram = available_gram - v_fee
  where user_id = p_user_id
  returning available_gram into v_balance;

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

revoke all on function public.merge_user_characters(uuid, text, int) from public, anon;
grant execute on function public.merge_user_characters(uuid, text, int) to authenticated;
