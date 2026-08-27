-- =============================================================================
-- Meme Farm — card progression: Study (level-up) + Merge (combine duplicates)
--   * user_characters.current_power column (+ backfill)
--   * study_upgrade_character()  — GRAM fee, income x2, power x1.5, STUDY_FEE ledger
--   * merge_user_characters()    — 2 same-template/level cards -> 1 at level+1,
--                                  income = base * 1.75^(level-1), MERGE_FEE ledger
--   Both SECURITY DEFINER with row-level locks.
-- =============================================================================

alter table public.user_characters
  add column if not exists current_power numeric(18, 9);

update public.user_characters uc
set current_power = ct.base_power
from public.character_templates ct
where uc.template_id = ct.id
  and uc.current_power is null;

-- -----------------------------------------------------------------------------
-- study_upgrade_character
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

  -- study fee scales with current level
  v_fee := round(0.10 * power(1.6, v_uc.level - 1), 9);

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
  set level = level + 1,
      current_income_day = v_income,
      current_power = v_power
  where id = p_user_character_id;

  update public.balances
  set available_gram = available_gram - v_fee
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'STUDY_FEE', 'DEBIT', v_fee, 0, 'GRAM',
          jsonb_build_object('user_character_id', p_user_character_id,
                             'to_level', v_uc.level + 1));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'STUDY_FEE', v_fee, 0, v_fee, 'COMPLETED');

  new_level          := v_uc.level + 1;
  new_income_day     := v_income;
  new_power          := v_power;
  new_available_gram := v_balance;
  return next;
end;
$$;

revoke all on function public.study_upgrade_character(uuid, uuid) from public, anon;
grant execute on function public.study_upgrade_character(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- merge_user_characters
-- -----------------------------------------------------------------------------
create or replace function public.merge_user_characters(
  p_user_id     uuid,
  p_template_id text,
  p_level       int
)
returns table (
  merged_id          uuid,
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
  v_tier      smallint;
  v_base      numeric(18, 9);
  v_fee       numeric(18, 9);
  v_balance   numeric(18, 9);
  v_ids       uuid[];
  v_src_power numeric(18, 9);
  v_income    numeric(18, 9);
  v_power     numeric(18, 9);
  v_new_id    uuid;
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

  -- lock the two oldest matching duplicates
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

  select coalesce(max(current_power), 0) into v_src_power
  from public.user_characters
  where id = any (v_ids);

  v_income := round(v_base * power(1.75, p_level), 9);   -- base * 1.75^((level+1)-1)
  v_power  := round(v_src_power * 1.75, 9);

  delete from public.user_characters where id = any (v_ids);

  insert into public.user_characters
    (user_id, template_id, level, current_income_day, current_power, is_equipped)
  values
    (p_user_id, p_template_id, p_level + 1, v_income, v_power, true)
  returning id into v_new_id;

  update public.balances
  set available_gram = available_gram - v_fee
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'MERGE_FEE', 'DEBIT', v_fee, 0, 'GRAM',
          jsonb_build_object('template_id', p_template_id, 'from_level', p_level,
                             'to_level', p_level + 1, 'consumed', v_ids, 'merged_id', v_new_id));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'MERGE_FEE', v_fee, 0, v_fee, 'COMPLETED');

  merged_id          := v_new_id;
  new_level          := p_level + 1;
  new_income_day     := v_income;
  new_power          := v_power;
  new_available_gram := v_balance;
  return next;
end;
$$;

revoke all on function public.merge_user_characters(uuid, text, int) from public, anon;
grant execute on function public.merge_user_characters(uuid, text, int) to authenticated;
