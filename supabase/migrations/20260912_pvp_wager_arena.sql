-- =============================================================================
-- Meme Farm — PvP wager arena (GRAM stakes, 10% treasury rake)
--   * stakes: 0.1 / 0.25 / 0.5 / 1 / 2 / 5 GRAM
--   * total_pot     = stake * 2
--   * fee_amount    = total_pot * 0.10   -> public.system_ledger (treasury)
--   * winner_payout = total_pot - fee_amount -> winner.available_gram
--   * no tickets / energy / daily limit — play as often as the balance allows
--   * pvp_lobbies + create_pvp_lobby / cancel_pvp_lobby / join_pvp_lobby
--   (execute_pvp_battle from 20260901/20260909 is left in place but superseded)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ledger / transaction type additions
-- -----------------------------------------------------------------------------
alter table public.ledger_entries drop constraint if exists ledger_entries_transaction_type_check;
alter table public.ledger_entries
  add constraint ledger_entries_transaction_type_check check (transaction_type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE',
    'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD',
    'REFUND', 'WAGER_STAKE', 'WAGER_PAYOUT'
  ));

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE',
    'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD',
    'REFUND', 'WAGER_STAKE', 'WAGER_PAYOUT'
  ));

-- -----------------------------------------------------------------------------
-- treasury sink for the rake
-- -----------------------------------------------------------------------------
create table if not exists public.system_ledger (
  id         uuid primary key default gen_random_uuid(),
  source     text not null,
  amount     numeric(18, 9) not null,
  asset      text not null default 'GRAM',
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.system_ledger enable row level security;
-- no policies: only SECURITY DEFINER functions / service_role may write/read

-- -----------------------------------------------------------------------------
-- lobbies
-- -----------------------------------------------------------------------------
create table if not exists public.pvp_lobbies (
  id             uuid primary key default gen_random_uuid(),
  creator_id     uuid not null references public.profiles (id) on delete cascade,
  opponent_id    uuid references public.profiles (id) on delete set null,
  stake          numeric(18, 9) not null check (stake > 0),
  status         text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'CANCELLED')),
  winner_id      uuid references public.profiles (id),
  pot            numeric(18, 9),
  fee_amount     numeric(18, 9),
  winner_payout  numeric(18, 9),
  creator_power  integer,
  opponent_power integer,
  roll           numeric,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index if not exists pvp_lobbies_open_idx on public.pvp_lobbies (status, created_at) where status = 'OPEN';

alter table public.pvp_lobbies enable row level security;
drop policy if exists "pvp_lobbies_select" on public.pvp_lobbies;
create policy "pvp_lobbies_select" on public.pvp_lobbies
  for select using (status = 'OPEN' or auth.uid() = creator_id or auth.uid() = opponent_id);
grant select on public.pvp_lobbies to authenticated;

-- -----------------------------------------------------------------------------
-- helpers
-- -----------------------------------------------------------------------------
create or replace function public._valid_stake(p_stake numeric)
returns boolean
language sql
immutable
as $$ select p_stake in (0.1, 0.25, 0.5, 1, 2, 5) $$;

-- -----------------------------------------------------------------------------
-- create_pvp_lobby — escrow the creator's stake, open a lobby
-- -----------------------------------------------------------------------------
create or replace function public.create_pvp_lobby(p_user_id uuid, p_stake numeric)
returns table (lobby_id uuid, stake numeric(18, 9), status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric(18, 9);
  v_id      uuid;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public._valid_stake(p_stake) then
    raise exception 'invalid stake %', p_stake using errcode = '22023';
  end if;

  select available_gram into v_balance
  from public.balances where user_id = p_user_id for update;
  if not found then
    raise exception 'balance not found' using errcode = 'P0002';
  end if;
  if v_balance < p_stake then
    raise exception 'insufficient funds: have %, need %', v_balance, p_stake using errcode = 'P0001';
  end if;

  update public.balances set available_gram = available_gram - p_stake
  where user_id = p_user_id;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'WAGER_STAKE', 'DEBIT', p_stake, 0, 'GRAM', jsonb_build_object('role', 'creator'));
  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'WAGER_STAKE', p_stake, 0, p_stake, 'COMPLETED');

  insert into public.pvp_lobbies (creator_id, stake) values (p_user_id, p_stake)
  returning id into v_id;

  lobby_id := v_id;
  stake    := p_stake;
  status   := 'OPEN';
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- cancel_pvp_lobby — refund the creator if still unmatched
-- -----------------------------------------------------------------------------
create or replace function public.cancel_pvp_lobby(p_user_id uuid, p_lobby_id uuid)
returns table (new_available_gram numeric(18, 9))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lobby   public.pvp_lobbies%rowtype;
  v_balance numeric(18, 9);
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_lobby from public.pvp_lobbies where id = p_lobby_id for update;
  if not found then
    raise exception 'lobby not found' using errcode = 'P0002';
  end if;
  if v_lobby.creator_id <> p_user_id then
    raise exception 'not your lobby' using errcode = '42501';
  end if;
  if v_lobby.status <> 'OPEN' then
    raise exception 'lobby is not open' using errcode = 'P0001';
  end if;

  update public.balances set available_gram = available_gram + v_lobby.stake
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'REFUND', 'CREDIT', v_lobby.stake, 0, 'GRAM',
          jsonb_build_object('reason', 'lobby_cancelled', 'lobby_id', p_lobby_id));
  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'REFUND', v_lobby.stake, 0, v_lobby.stake, 'COMPLETED');

  update public.pvp_lobbies set status = 'CANCELLED', resolved_at = now()
  where id = p_lobby_id;

  new_available_gram := v_balance;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- join_pvp_lobby — escrow the joiner's stake, resolve, pay out, rake, XP
-- -----------------------------------------------------------------------------
create or replace function public.join_pvp_lobby(p_user_id uuid, p_lobby_id uuid)
returns table (
  you_won            boolean,
  stake              numeric(18, 9),
  pot                numeric(18, 9),
  fee_amount         numeric(18, 9),
  winner_payout      numeric(18, 9),
  joiner_power       integer,
  creator_power      integer,
  win_chance         numeric,
  rating_delta       integer,
  new_rating         integer,
  xp_total           bigint,
  new_available_gram numeric(18, 9)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lobby    public.pvp_lobbies%rowtype;
  v_stake    numeric(18, 9);
  v_pot      numeric(18, 9);
  v_fee      numeric(18, 9);
  v_payout   numeric(18, 9);
  v_balance  numeric(18, 9);
  v_cpow     integer;
  v_jpow     integer;
  v_chance   numeric;
  v_roll     numeric;
  v_joiner_wins boolean;
  v_winner   uuid;
  v_loser    uuid;
  v_jdelta   integer;
  v_jrating  integer;
  v_jxp      bigint;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_lobby from public.pvp_lobbies where id = p_lobby_id for update;
  if not found then
    raise exception 'lobby not found' using errcode = 'P0002';
  end if;
  if v_lobby.status <> 'OPEN' then
    raise exception 'lobby is not open' using errcode = 'P0001';
  end if;
  if v_lobby.creator_id = p_user_id then
    raise exception 'cannot join your own lobby' using errcode = 'P0001';
  end if;

  v_stake  := v_lobby.stake;
  v_pot    := round(v_stake * 2, 9);
  v_fee    := round(v_pot * 0.10, 9);
  v_payout := round(v_pot - v_fee, 9);

  -- escrow the joiner's stake
  select available_gram into v_balance
  from public.balances where user_id = p_user_id for update;
  if not found then
    raise exception 'balance not found' using errcode = 'P0002';
  end if;
  if v_balance < v_stake then
    raise exception 'insufficient funds: have %, need %', v_balance, v_stake using errcode = 'P0001';
  end if;

  update public.balances set available_gram = available_gram - v_stake
  where user_id = p_user_id
  returning available_gram into v_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'WAGER_STAKE', 'DEBIT', v_stake, 0, 'GRAM',
          jsonb_build_object('role', 'joiner', 'lobby_id', p_lobby_id));
  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'WAGER_STAKE', v_stake, 0, v_stake, 'COMPLETED');

  -- power sums
  select coalesce(sum(coalesce(current_power, 0)), 0)::int into v_cpow
  from public.user_characters where user_id = v_lobby.creator_id;
  select coalesce(sum(coalesce(current_power, 0)), 0)::int into v_jpow
  from public.user_characters where user_id = p_user_id;

  v_chance := coalesce(v_jpow::numeric / nullif(v_jpow + v_cpow, 0), 0.5);
  v_roll := random();
  v_joiner_wins := v_roll < v_chance;
  if v_joiner_wins then
    v_winner := p_user_id;
    v_loser  := v_lobby.creator_id;
  else
    v_winner := v_lobby.creator_id;
    v_loser  := p_user_id;
  end if;

  -- pay the winner
  update public.balances set available_gram = available_gram + v_payout
  where user_id = v_winner;
  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (v_winner, 'WAGER_PAYOUT', 'CREDIT', v_payout, 0, 'GRAM',
          jsonb_build_object('lobby_id', p_lobby_id, 'pot', v_pot, 'rake', v_fee));
  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (v_winner, 'WAGER_PAYOUT', v_payout, v_fee, v_payout, 'COMPLETED');

  -- rake -> treasury
  insert into public.system_ledger (source, amount, asset, metadata)
  values ('PVP_RAKE', v_fee, 'GRAM',
          jsonb_build_object('lobby_id', p_lobby_id, 'pot', v_pot,
                             'creator', v_lobby.creator_id, 'joiner', p_user_id, 'winner', v_winner));

  -- leaderboard XP for both fighters (never spent)
  insert into public.pvp_profiles (user_id) values (v_winner) on conflict (user_id) do nothing;
  insert into public.pvp_profiles (user_id) values (v_loser)  on conflict (user_id) do nothing;
  update public.pvp_profiles set xp = xp + 150 where user_id = v_winner;
  update public.pvp_profiles set xp = xp + 50  where user_id = v_loser;

  -- rating nudge
  update public.pvp_profiles set rating = greatest(0, rating + 20) where user_id = v_winner;
  update public.pvp_profiles set rating = greatest(0, rating - 12) where user_id = v_loser;

  v_jdelta := case when v_joiner_wins then 20 else -12 end;
  select rating, xp into v_jrating, v_jxp from public.pvp_profiles where user_id = p_user_id;

  update public.pvp_lobbies set
    status = 'RESOLVED',
    opponent_id = p_user_id,
    winner_id = v_winner,
    pot = v_pot,
    fee_amount = v_fee,
    winner_payout = v_payout,
    creator_power = v_cpow,
    opponent_power = v_jpow,
    roll = v_roll,
    resolved_at = now()
  where id = p_lobby_id;

  you_won            := v_joiner_wins;
  stake              := v_stake;
  pot                := v_pot;
  fee_amount         := v_fee;
  winner_payout      := v_payout;
  joiner_power       := v_jpow;
  creator_power      := v_cpow;
  win_chance         := round(v_chance, 4);
  rating_delta       := v_jdelta;
  new_rating         := coalesce(v_jrating, 0);
  xp_total           := coalesce(v_jxp, 0);
  new_available_gram := v_balance;
  return next;
end;
$$;

revoke all on function public.create_pvp_lobby(uuid, numeric) from public, anon;
revoke all on function public.cancel_pvp_lobby(uuid, uuid)    from public, anon;
revoke all on function public.join_pvp_lobby(uuid, uuid)      from public, anon;
grant execute on function public.create_pvp_lobby(uuid, numeric) to authenticated;
grant execute on function public.cancel_pvp_lobby(uuid, uuid)    to authenticated;
grant execute on function public.join_pvp_lobby(uuid, uuid)      to authenticated;
