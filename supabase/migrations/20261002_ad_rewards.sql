-- =============================================================================
-- Meme Farm — rewarded video ads (Adsgram / Monetag / GigaPub / RichAds).
--
-- No daily cap — a user may watch as many ads as the network has fill for.
-- Reward is NEVER credited client-side: watching the ad only gets you a
-- PENDING row; the ad network's own server calls our postback endpoint
-- (one per network, added incrementally as each network's dashboard secret
-- is known) which alone can flip a row to CREDITED. If no postback arrives
-- (view didn't pass the network's own fraud check), nothing is ever paid.
--
--   create_ad_view(network)      — client, before calling the SDK: opens a
--                                   PENDING row, returns its id as the
--                                   click_id to pass into the SDK's params.
--   credit_ad_view(click_id, network, network_ref)
--                                 — SERVER ONLY (service_role from inside a
--                                   postback Edge Function). Idempotent:
--                                   only a PENDING row can be credited once.
-- =============================================================================

-- new ledger / transaction type -----------------------------------------------
alter table public.ledger_entries drop constraint if exists ledger_entries_transaction_type_check;
alter table public.ledger_entries
  add constraint ledger_entries_transaction_type_check check (transaction_type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE',
    'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD',
    'REFUND', 'WAGER_STAKE', 'WAGER_PAYOUT', 'AMBASSADOR_REWARD', 'AD_REWARD'
  ));

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check check (type in (
    'DEPOSIT', 'WITHDRAW', 'FARM_CLAIM', 'STUDY_FEE', 'MERGE_FEE',
    'SLOT_UNLOCK', 'TIER_ROLL', 'REFERRAL_REWARD', 'STREAK_REWARD', 'QUEST_REWARD',
    'REFUND', 'WAGER_STAKE', 'WAGER_PAYOUT', 'AMBASSADOR_REWARD', 'AD_REWARD'
  ));

-- -----------------------------------------------------------------------------
-- 1. ad_views
-- -----------------------------------------------------------------------------
create table if not exists public.ad_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  network     text not null check (network in ('adsgram', 'monetag', 'gigapub', 'richads')),
  status      text not null default 'PENDING' check (status in ('PENDING', 'CREDITED', 'REJECTED')),
  reward_gram numeric(18, 9) not null default 0.002,
  -- the network's own impression/click id, filled in from the postback once known
  network_ref text,
  created_at  timestamptz not null default now(),
  credited_at timestamptz
);
create index if not exists ad_views_user_idx on public.ad_views (user_id, created_at desc);
create index if not exists ad_views_pending_idx on public.ad_views (network, id) where status = 'PENDING';

alter table public.ad_views enable row level security;
drop policy if exists "ad_views_select_own" on public.ad_views;
create policy "ad_views_select_own" on public.ad_views
  for select using (auth.uid() = user_id);
-- no insert/update grant to clients — rows are created/settled only by the
-- SECURITY DEFINER RPCs below.
grant select on public.ad_views to authenticated;

-- -----------------------------------------------------------------------------
-- 2. create_ad_view — client calls this right before invoking the network SDK
-- -----------------------------------------------------------------------------
create or replace function public.create_ad_view(p_network text)
returns table (click_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_network not in ('adsgram', 'monetag', 'gigapub', 'richads') then
    raise exception 'unknown network %', p_network using errcode = '22023';
  end if;

  insert into public.ad_views (user_id, network)
  values (v_uid, p_network)
  returning id into v_id;

  click_id := v_id;
  return next;
end;
$$;
revoke all on function public.create_ad_view(text) from public, anon;
grant execute on function public.create_ad_view(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. credit_ad_view — SERVER ONLY. Called from a network's postback Edge
--    Function (service_role), never reachable from the client.
-- -----------------------------------------------------------------------------
create or replace function public.credit_ad_view(
  p_click_id   uuid,
  p_network    text,
  p_network_ref text default null
)
returns table (credited boolean, new_available_gram numeric(18, 9))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_view    public.ad_views%rowtype;
  v_balance numeric(18, 9);
begin
  select * into v_view
  from public.ad_views
  where id = p_click_id and network = p_network and status = 'PENDING'
  for update;

  if not found then
    -- unknown click_id, wrong network, or already settled -> no-op (idempotent)
    credited := false;
    new_available_gram := null;
    return next;
    return;
  end if;

  insert into public.balances (user_id) values (v_view.user_id) on conflict (user_id) do nothing;
  update public.balances
  set available_gram = available_gram + v_view.reward_gram, updated_at = now()
  where user_id = v_view.user_id
  returning available_gram into v_balance;

  update public.ad_views
  set status = 'CREDITED', network_ref = p_network_ref, credited_at = now()
  where id = p_click_id;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (v_view.user_id, 'AD_REWARD', 'CREDIT', v_view.reward_gram, 0, 'GRAM',
          jsonb_build_object('network', p_network, 'click_id', p_click_id, 'network_ref', p_network_ref));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (v_view.user_id, 'AD_REWARD', v_view.reward_gram, 0, v_view.reward_gram, 'COMPLETED');

  credited := true;
  new_available_gram := v_balance;
  return next;
end;
$$;
-- service_role (postback functions) only — never authenticated/anon.
revoke all on function public.credit_ad_view(uuid, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. reject_stale_ad_views — housekeeping: PENDING rows nobody ever confirmed
--    (postback never arrived) age out after 2 hours so a user's ad_views list
--    doesn't show a "pending" row forever. Safe to run from a cron; does not
--    touch money (a PENDING row was never paid).
-- -----------------------------------------------------------------------------
create or replace function public.reject_stale_ad_views()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with rejected as (
    update public.ad_views
    set status = 'REJECTED'
    where status = 'PENDING' and created_at < now() - interval '2 hours'
    returning 1
  )
  select count(*)::int from rejected;
$$;
revoke all on function public.reject_stale_ad_views() from public, anon, authenticated;
