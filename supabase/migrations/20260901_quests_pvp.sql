-- =============================================================================
-- Meme Farm — Daily quests / streak + PvP raids
--   * user_quests  — per-UTC-day quest progress
--   * pvp_profiles — rating, raid tickets (time-refilled), streak, daily buff
--   * claim_daily_streak()  — advance/reset the 7-day ladder, grant the reward
--   * execute_pvp_battle()  — spend a ticket, resolve a weighted coin-flip
--   New ledger/tx types: STREAK_REWARD, QUEST_REWARD
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ledger / transaction type additions
-- -----------------------------------------------------------------------------
alter table public.ledger_entries drop constraint if exists ledger_entries_transaction_type_check;
alter table public.ledger_entries
  add constraint ledger_entries_transaction_type_check check (transaction_type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE',
    'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD'
  ));

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE',
    'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD'
  ));

-- -----------------------------------------------------------------------------
-- tables
-- -----------------------------------------------------------------------------
create table if not exists public.user_quests (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  quest_id  text not null,
  day       date not null default (now() at time zone 'utc')::date,
  progress  integer not null default 0,
  goal      integer not null,
  claimed   boolean not null default false,
  primary key (user_id, quest_id, day)
);
alter table public.user_quests enable row level security;
create policy "user_quests_select_own" on public.user_quests
  for select using (auth.uid() = user_id);
grant select on public.user_quests to authenticated;

create table if not exists public.pvp_profiles (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  rating            integer not null default 1000,
  tickets           integer not null default 5,
  max_tickets       integer not null default 5,
  last_ticket_refill timestamptz not null default now(),
  streak_day        integer not null default 0,
  last_check_in     date,
  daily_buff_until  timestamptz,
  updated_at        timestamptz not null default now()
);
alter table public.pvp_profiles enable row level security;
create policy "pvp_profiles_select_own" on public.pvp_profiles
  for select using (auth.uid() = user_id);
grant select on public.pvp_profiles to authenticated;

-- provision pvp_profiles for new users
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

  insert into public.pvp_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

insert into public.pvp_profiles (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

-- -----------------------------------------------------------------------------
-- claim_daily_streak
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

  -- 7-day ladder (matches src/data/quests.ts)
  select k, a into v_kind, v_amount from (values
    (1, 'xp'::text,        150::numeric),
    (2, 'gram',            0.05),
    (3, 'tickets',         2),
    (4, 'xp',              300),
    (5, 'fragments',       3),
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

-- -----------------------------------------------------------------------------
-- execute_pvp_battle
-- -----------------------------------------------------------------------------
create or replace function public.execute_pvp_battle(p_user_id uuid, p_opponent_power integer)
returns table (
  won          boolean,
  rating_delta integer,
  new_rating   integer,
  tickets_left integer,
  user_power   integer,
  win_chance   numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p        public.pvp_profiles%rowtype;
  v_refill   interval := interval '30 minutes';
  v_gained   integer;
  v_power    integer;
  v_chance   numeric;
  v_won      boolean;
  v_delta    integer;
  v_rating   integer;
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

  -- time-based ticket refill
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

  update public.pvp_profiles
  set tickets = v_p.tickets - 1,
      last_ticket_refill = v_p.last_ticket_refill,
      rating = v_rating,
      updated_at = now()
  where user_id = p_user_id;

  won          := v_won;
  rating_delta := v_delta;
  new_rating   := v_rating;
  tickets_left := v_p.tickets - 1;
  user_power   := v_power;
  win_chance   := round(v_chance, 4);
  return next;
end;
$$;

revoke all on function public.execute_pvp_battle(uuid, integer) from public, anon;
grant execute on function public.execute_pvp_battle(uuid, integer) to authenticated;
