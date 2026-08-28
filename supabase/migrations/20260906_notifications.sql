-- =============================================================================
-- Meme Farm — push notifications (Telegram Bot API)
--   * notification_logs, event_queue
--   * farm_states.is_claim_notified  (reset on claim)
--   * profiles.notif_prefs           (per-user toggles)
--   * process_referral_commission / execute_pvp_battle enqueue events
--   Delivery is done by the `notify-dispatcher` Edge Function (cron + event).
-- =============================================================================

alter table public.farm_states
  add column if not exists is_claim_notified boolean not null default false;

alter table public.profiles
  add column if not exists notif_prefs jsonb not null
  default '{"farm_ready": true, "pvp_attack": true, "referral_income": true}'::jsonb;

grant update (notif_prefs) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- notification_logs — delivery audit
-- -----------------------------------------------------------------------------
create table if not exists public.notification_logs (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type    text not null check (type in ('FARM_READY', 'PVP_ATTACK', 'REFERRAL_INCOME')),
  sent_at timestamptz not null default now(),
  status  text not null default 'SENT' check (status in ('SENT', 'FAILED'))
);
alter table public.notification_logs enable row level security;
create policy "notification_logs_select_own" on public.notification_logs
  for select using (auth.uid() = user_id);
grant select on public.notification_logs to authenticated;
create index if not exists notification_logs_user_idx
  on public.notification_logs (user_id, sent_at desc);

-- -----------------------------------------------------------------------------
-- event_queue — trigger-driven notifications, drained by the dispatcher
--   (no RLS policies: only SECURITY DEFINER RPCs enqueue, service_role drains)
-- -----------------------------------------------------------------------------
create table if not exists public.event_queue (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  type         text not null check (type in ('FARM_READY', 'PVP_ATTACK', 'REFERRAL_INCOME')),
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.event_queue enable row level security;
create index if not exists event_queue_unprocessed_idx
  on public.event_queue (created_at) where processed_at is null;

-- -----------------------------------------------------------------------------
-- claim_farm_income — also clears the "farm ready" notification flag
-- -----------------------------------------------------------------------------
create or replace function public.claim_farm_income(p_user_id uuid)
returns table (
  earned_gram        numeric(18, 9),
  new_available_gram numeric(18, 9),
  next_claim_at      timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state       public.farm_states%rowtype;
  v_income_day  numeric(18, 9);
  v_elapsed_sec numeric;
  v_earned      numeric(18, 9);
  v_new_balance numeric(18, 9);
  v_next_claim  timestamptz;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_state from public.farm_states where user_id = p_user_id for update;
  if not found then
    raise exception 'farm state not found for user %', p_user_id using errcode = 'P0002';
  end if;

  if now() < v_state.next_claim_at then
    raise exception 'claim not ready until %', v_state.next_claim_at using errcode = 'P0001';
  end if;

  select coalesce(sum(current_income_day), 0) into v_income_day
  from public.user_characters
  where user_id = p_user_id and is_equipped = true;

  v_elapsed_sec := greatest(extract(epoch from (now() - v_state.last_accrual_at)), 0);
  v_earned := round(v_income_day * v_state.emission_factor * v_elapsed_sec / 86400.0, 9);
  v_next_claim := now() + interval '8 hours';

  insert into public.balances (user_id) values (p_user_id) on conflict (user_id) do nothing;

  update public.balances
  set available_gram = available_gram + v_earned
  where user_id = p_user_id
  returning available_gram into v_new_balance;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (p_user_id, 'FARM_CLAIM', 'CREDIT', v_earned, 0, 'GRAM',
          jsonb_build_object('income_per_day', v_income_day,
                             'emission_factor', v_state.emission_factor,
                             'elapsed_seconds', round(v_elapsed_sec)));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (p_user_id, 'FARM_CLAIM', v_earned, 0, v_earned, 'COMPLETED');

  update public.farm_states
  set last_accrual_at   = now(),
      next_claim_at     = v_next_claim,
      is_claim_notified = false
  where user_id = p_user_id;

  earned_gram        := v_earned;
  new_available_gram := v_new_balance;
  next_claim_at      := v_next_claim;
  return next;
end;
$$;

revoke all on function public.claim_farm_income(uuid) from public, anon;
grant execute on function public.claim_farm_income(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- process_referral_commission — enqueue a REFERRAL_INCOME event per credited tier
-- -----------------------------------------------------------------------------
create or replace function public.process_referral_commission(p_user_id uuid, p_fee_amount numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rates constant numeric[] := array[0.05, 0.02, 0.01];
  v_child uuid := p_user_id;
  v_parent uuid;
  v_amt numeric(18, 9);
begin
  if p_fee_amount <= 0 then
    return;
  end if;

  for i in 1..3 loop
    select referrer_id into v_parent from public.referrals where referee_id = v_child;
    exit when v_parent is null;

    v_amt := round(p_fee_amount * v_rates[i], 9);
    if v_amt > 0 then
      update public.referrals
      set unclaimed_gram    = unclaimed_gram + v_amt,
          total_earned_gram = total_earned_gram + v_amt
      where referee_id = v_child;

      insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
      values (v_parent, 'REFERRAL_REWARD', 'CREDIT', v_amt, 0, 'GRAM',
              jsonb_build_object('level', i, 'source_user', p_user_id, 'accrued', true));

      insert into public.event_queue (user_id, type, metadata)
      values (v_parent, 'REFERRAL_INCOME',
              jsonb_build_object('level', i, 'amount', v_amt, 'source_user', p_user_id));
    end if;

    v_child := v_parent;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- execute_pvp_battle — optional real opponent id; notify the loser
-- -----------------------------------------------------------------------------
drop function if exists public.execute_pvp_battle(uuid, integer);

create or replace function public.execute_pvp_battle(
  p_user_id        uuid,
  p_opponent_power integer,
  p_opponent_id    uuid default null
)
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
  v_p      public.pvp_profiles%rowtype;
  v_refill interval := interval '30 minutes';
  v_gained integer;
  v_power  integer;
  v_chance numeric;
  v_won    boolean;
  v_delta  integer;
  v_rating integer;
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

  -- notify the beaten opponent (real-player PvP only)
  if v_won and p_opponent_id is not null then
    insert into public.event_queue (user_id, type, metadata)
    values (p_opponent_id, 'PVP_ATTACK',
            jsonb_build_object('attacker', p_user_id, 'rating_delta', v_delta));
  end if;

  won          := v_won;
  rating_delta := v_delta;
  new_rating   := v_rating;
  tickets_left := v_p.tickets - 1;
  user_power   := v_power;
  win_chance   := round(v_chance, 4);
  return next;
end;
$$;

revoke all on function public.execute_pvp_battle(uuid, integer, uuid) from public, anon;
grant execute on function public.execute_pvp_battle(uuid, integer, uuid) to authenticated;
