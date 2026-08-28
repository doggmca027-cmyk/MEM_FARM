-- =============================================================================
-- Meme Farm — remove the "Fragments / Shards" mechanic
--   * drop farm_slots.progress_fragments, character_templates.merge_cost_fragments
--   * claim_daily_streak: day-5 reward fragments -> +1 raid ticket
--   * execute_pvp_battle already returns no fragment rewards (client-side only) —
--     nothing to change there.
-- =============================================================================

alter table public.farm_slots          drop column if exists progress_fragments;
alter table public.character_templates drop column if exists merge_cost_fragments;

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

  -- 7-day ladder (matches src/data/quests.ts)
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
  end if;

  -- day 7 also grants a 24h income buff
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

revoke all on function public.claim_daily_streak(uuid) from public, anon;
grant execute on function public.claim_daily_streak(uuid) to authenticated;
