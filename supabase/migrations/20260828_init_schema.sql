-- =============================================================================
-- Meme Farm — initial schema
--   * core game tables
--   * double-entry ledger + transactions
--   * SECURITY DEFINER RPCs for money-moving flows (claim / slot unlock)
--   * Row Level Security: users read only their own rows; balances & ledger
--     are never written directly by clients — only through the RPCs below.
-- =============================================================================

create extension if not exists "pgcrypto";           -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- 1. TABLES
-- -----------------------------------------------------------------------------

-- profiles ---------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  telegram_id    bigint unique,
  username       text,
  first_name     text,
  wallet_address text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- balances ------------------------------------------------------------------
create table if not exists public.balances (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  available_ton numeric(18, 9) not null default 0 check (available_ton >= 0),
  pending_ton   numeric(18, 9) not null default 0 check (pending_ton   >= 0),
  locked_ton    numeric(18, 9) not null default 0 check (locked_ton    >= 0),
  updated_at    timestamptz not null default now()
);

-- character_templates (reference data, slug ids) ------------------------------
create table if not exists public.character_templates (
  id                    text primary key,
  name                  text not null,
  meme_type             text not null check (meme_type in ('capybara', 'pepe', 'doge', 'gigachad')),
  rarity                text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  base_income_day       numeric(18, 9) not null default 0,
  base_power            integer not null default 0,
  max_level             integer not null default 10,
  merge_cost_fragments  integer not null default 0,
  image_url             text
);

-- farm_slots ----------------------------------------------------------------
create table if not exists public.farm_slots (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  tier               smallint not null check (tier in (1, 2, 3)),
  unlock_price_ton   numeric(18, 9) not null default 0,
  max_capacity       integer not null default 0,
  progress_fragments integer not null default 0,
  hat_item_id        uuid,
  created_at         timestamptz not null default now(),
  unique (user_id, tier)
);

-- user_characters ---------------------------------------------------------------
create table if not exists public.user_characters (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  template_id        text not null references public.character_templates (id),
  level              integer not null default 1 check (level >= 1),
  current_income_day numeric(18, 9) not null default 0,
  slot_id            uuid references public.farm_slots (id) on delete set null,
  is_equipped        boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists user_characters_user_idx     on public.user_characters (user_id);
create index if not exists user_characters_equipped_idx on public.user_characters (user_id) where is_equipped;

-- farm_states -----------------------------------------------------------------
create table if not exists public.farm_states (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  last_accrual_at timestamptz not null default now(),
  next_claim_at   timestamptz not null default now(),
  emission_factor numeric(4, 2) not null default 1.0 check (emission_factor >= 0)
);

-- ledger_entries (append-only, double-entry) ---------------------------------
create table if not exists public.ledger_entries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  transaction_type text not null check (transaction_type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE',
    'MERGE_FEE', 'SLOT_UNLOCK', 'REFERRAL_REWARD'
  )),
  direction        text not null check (direction in ('CREDIT', 'DEBIT')),
  amount           numeric(18, 9) not null check (amount >= 0),
  fee              numeric(18, 9) not null default 0 check (fee >= 0),
  asset            text not null default 'TON' check (asset in ('TON')),
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists ledger_entries_user_idx on public.ledger_entries (user_id, created_at desc);

-- transactions (user-facing history) ---------------------------------------------
create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  type           text not null check (type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE',
    'MERGE_FEE', 'SLOT_UNLOCK', 'REFERRAL_REWARD'
  )),
  amount         numeric(18, 9) not null,
  fee            numeric(18, 9) not null default 0,
  net_amount     numeric(18, 9) not null,
  wallet_address text,
  status         text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'FAILED')),
  tx_hash        text,
  created_at     timestamptz not null default now()
);
create index if not exists transactions_user_idx on public.transactions (user_id, created_at desc);

-- referrals -------------------------------------------------------------------
create table if not exists public.referrals (
  id              uuid primary key default gen_random_uuid(),
  referrer_id     uuid not null references public.profiles (id) on delete cascade,
  referee_id      uuid not null unique references public.profiles (id) on delete cascade,
  tier            smallint not null default 1 check (tier in (1, 2, 3)),
  total_earned_ton numeric(18, 9) not null default 0,
  created_at      timestamptz not null default now(),
  check (referrer_id <> referee_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

-- -----------------------------------------------------------------------------
-- 2. HOUSEKEEPING TRIGGERS
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists balances_set_updated_at on public.balances;
create trigger balances_set_updated_at
  before update on public.balances
  for each row execute function public.set_updated_at();

-- Provision a profile + empty balance + farm state whenever an auth user is created.
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 3. RPCs  (SECURITY DEFINER — the only writers of balances / ledger_entries)
-- -----------------------------------------------------------------------------

-- claim_farm_income ----------------------------------------------------------
create or replace function public.claim_farm_income(p_user_id uuid)
returns table (
  earned_ton         numeric(18, 9),
  new_available_ton  numeric(18, 9),
  next_claim_at      timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state        public.farm_states%rowtype;
  v_income_day   numeric(18, 9);
  v_elapsed_sec  numeric;
  v_earned       numeric(18, 9);
  v_new_balance  numeric(18, 9);
  v_next_claim   timestamptz;
begin
  -- caller may only act on their own account (service_role has auth.uid() = null)
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- lock the farm state row for the duration of the transaction
  select * into v_state
  from public.farm_states
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'farm state not found for user %', p_user_id using errcode = 'P0002';
  end if;

  if now() < v_state.next_claim_at then
    raise exception 'claim not ready until %', v_state.next_claim_at using errcode = 'P0001';
  end if;

  select coalesce(sum(current_income_day), 0) into v_income_day
  from public.user_characters
  where user_id = p_user_id
    and is_equipped = true;

  v_elapsed_sec := greatest(extract(epoch from (now() - v_state.last_accrual_at)), 0);
  v_earned := round(v_income_day * v_state.emission_factor * v_elapsed_sec / 86400.0, 9);
  v_next_claim := now() + interval '8 hours';

  -- make sure a balance row exists, then credit it
  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;

  update public.balances
  set available_ton = available_ton + v_earned
  where user_id = p_user_id
  returning available_ton into v_new_balance;

  -- double-entry: credit the user's TON wallet
  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (
    p_user_id, 'FARM_CLAIM', 'CREDIT', v_earned, 0, 'TON',
    jsonb_build_object(
      'income_per_day', v_income_day,
      'emission_factor', v_state.emission_factor,
      'elapsed_seconds', round(v_elapsed_sec)
    )
  );

  -- user-facing history row
  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'FARM_CLAIM', v_earned, 0, v_earned, 'COMPLETED');

  -- advance the accrual window
  update public.farm_states
  set last_accrual_at = now(),
      next_claim_at    = v_next_claim
  where user_id = p_user_id;

  earned_ton        := v_earned;
  new_available_ton := v_new_balance;
  next_claim_at     := v_next_claim;
  return next;
end;
$$;

-- unlock_farm_slot ---------------------------------------------------------------
create or replace function public.unlock_farm_slot(p_user_id uuid, p_tier int)
returns table (
  slot_id            uuid,
  new_available_ton  numeric(18, 9)
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_price       numeric(18, 9);
  v_capacity    integer;
  v_available   numeric(18, 9);
  v_slot_id     uuid;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_price := case p_tier
               when 1 then 2
               when 2 then 4
               when 3 then 8
               else null
             end;
  v_capacity := case p_tier when 1 then 3 when 2 then 5 when 3 then 8 else null end;

  if v_price is null then
    raise exception 'invalid tier %', p_tier using errcode = '22023';
  end if;

  if exists (select 1 from public.farm_slots where user_id = p_user_id and tier = p_tier) then
    raise exception 'tier % already unlocked', p_tier using errcode = 'P0001';
  end if;

  -- lock the balance row, then verify funds
  select available_ton into v_available
  from public.balances
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'balance not found for user %', p_user_id using errcode = 'P0002';
  end if;

  if v_available < v_price then
    raise exception 'insufficient funds: have %, need %', v_available, v_price using errcode = 'P0001';
  end if;

  update public.balances
  set available_ton = available_ton - v_price
  where user_id = p_user_id
  returning available_ton into v_available;

  insert into public.farm_slots (user_id, tier, unlock_price_ton, max_capacity, progress_fragments)
  values (p_user_id, p_tier, v_price, v_capacity, 0)
  returning id into v_slot_id;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'SLOT_UNLOCK', 'DEBIT', v_price, 0, 'TON',
          jsonb_build_object('tier', p_tier, 'slot_id', v_slot_id));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'SLOT_UNLOCK', v_price, 0, v_price, 'COMPLETED');

  slot_id           := v_slot_id;
  new_available_ton := v_available;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.balances            enable row level security;
alter table public.character_templates enable row level security;
alter table public.farm_slots          enable row level security;
alter table public.user_characters     enable row level security;
alter table public.farm_states         enable row level security;
alter table public.ledger_entries      enable row level security;
alter table public.transactions        enable row level security;
alter table public.referrals           enable row level security;

-- profiles: read + limited self-service write ---------------------------------
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- character_templates: reference data, readable by everyone ------------------
create policy "character_templates_select_all" on public.character_templates
  for select using (true);

-- read-only-own tables ------------------------------------------------------
create policy "balances_select_own" on public.balances
  for select using (auth.uid() = user_id);

create policy "farm_states_select_own" on public.farm_states
  for select using (auth.uid() = user_id);

create policy "farm_slots_select_own" on public.farm_slots
  for select using (auth.uid() = user_id);

create policy "user_characters_select_own" on public.user_characters
  for select using (auth.uid() = user_id);

create policy "ledger_entries_select_own" on public.ledger_entries
  for select using (auth.uid() = user_id);

create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);

create policy "referrals_select_related" on public.referrals
  for select using (auth.uid() = referrer_id or auth.uid() = referee_id);

--
-- NOTE: no INSERT / UPDATE / DELETE policies are defined for balances,
-- ledger_entries, transactions, farm_states, farm_slots or user_characters.
-- With RLS enabled and no permissive write policy, every direct client write
-- is rejected. All mutations flow through the SECURITY DEFINER RPCs above
-- (which run as the table owner and bypass RLS).
--

-- -----------------------------------------------------------------------------
-- 5. GRANTS
-- -----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select on
  public.profiles, public.balances, public.character_templates,
  public.farm_slots, public.user_characters, public.farm_states,
  public.ledger_entries, public.transactions, public.referrals
to authenticated;

grant insert (id) , update (username, first_name, wallet_address, updated_at)
  on public.profiles to authenticated;

grant select on public.character_templates to anon;

-- RPCs: authenticated users only; never anon.
revoke all on function public.claim_farm_income(uuid)      from public, anon;
revoke all on function public.unlock_farm_slot(uuid, int)  from public, anon;
grant execute on function public.claim_farm_income(uuid)     to authenticated;
grant execute on function public.unlock_farm_slot(uuid, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. SEED — character templates
-- -----------------------------------------------------------------------------

insert into public.character_templates
  (id, name, meme_type, rarity, base_income_day, base_power, max_level, merge_cost_fragments, image_url)
values
  ('capybara_pizzaboo', 'Pizzaboo',   'capybara', 'epic',      0.08, 120, 10, 20, null),
  ('pepe_devilboo',     'Devilboo',   'pepe',     'rare',      0.05,  70, 10, 15, null),
  ('doge_balloonboo',   'Balloonboo', 'doge',     'rare',      0.06,  75, 10, 15, null),
  ('gigachad_prime',    'Gigachad',   'gigachad', 'legendary', 0.14, 260, 12, 40, null)
on conflict (id) do nothing;
