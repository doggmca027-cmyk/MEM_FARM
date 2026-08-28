-- =============================================================================
-- Meme Farm — PvP real-players-only leaderboard + streak ladder sync
--   1. claim_daily_streak: ladder rewritten to match the client STREAK_DAYS
--      (no more vestigial 'tickets'; day 2 <-> day 5 gram rewards swapped).
--   2. pvp_leaderboard(): real top players from pvp_profiles (no bot rows).
--   3. Ensure the configured operator (telegram_id 6288342755) is an admin —
--      ADMIN_TELEGRAM_IDS stays the ongoing source of truth (telegram-auth).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. claim_daily_streak — ladder in sync with data/quests.ts
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
    (1, 'xp'::text, 150::numeric),
    (2, 'gram',     0.03),
    (3, 'xp',       220),
    (4, 'xp',       300),
    (5, 'gram',     0.05),
    (6, 'gram',     0.12),
    (7, 'case',     1)
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
  elsif v_kind = 'xp' then
    update public.pvp_profiles set xp = xp + v_amount::bigint where user_id = p_user_id;
  end if;
  -- 'case' is granted client-side (mock) / no-op server-side for now

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
-- 2. pvp_leaderboard — real players only
-- -----------------------------------------------------------------------------
create or replace function public.pvp_leaderboard(p_limit int default 20)
returns table (
  handle    text,
  rating    integer,
  xp        bigint,
  power     integer,
  meme_type text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(nullif(pr.username, ''), 'Player ' || right(pp.user_id::text, 4)) as handle,
    pp.rating,
    pp.xp,
    coalesce((
      select sum(coalesce(uc.current_power, 0))::int
      from public.user_characters uc where uc.user_id = pp.user_id
    ), 0) as power,
    coalesce((
      select ct.meme_type
      from public.user_characters uc
      join public.character_templates ct on ct.id = uc.template_id
      where uc.user_id = pp.user_id
      order by coalesce(uc.current_power, 0) desc
      limit 1
    ), 'gigachad') as meme_type
  from public.pvp_profiles pp
  join public.profiles pr on pr.id = pp.user_id
  where pr.is_banned = false
  order by pp.xp desc, pp.rating desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.pvp_leaderboard(int) from public, anon;
grant execute on function public.pvp_leaderboard(int) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. operator admin flag (ADMIN_TELEGRAM_IDS remains the source of truth)
-- -----------------------------------------------------------------------------
update public.profiles set is_admin = true where telegram_id = 6288342755;
