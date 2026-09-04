-- =============================================================================
-- Meme Farm — ad-reward settlement helpers.
--
-- Different networks echo back different things in their postback:
--   - Adsgram's reward-URL macro is ONLY `[userId]` (the Telegram id) — no
--     custom passthrough param — so it must settle by (telegram_id, network),
--     oldest PENDING row first (FIFO; a user only ever has one ad in flight
--     at a time from the UI, so this is exact in practice).
--   - Monetag (and most others) accept a custom `ymid` we set to our own
--     click_id, so they can settle by exact row id.
-- Both paths share one locked, idempotent settlement core.
-- =============================================================================

create or replace function public._settle_ad_view(p_id uuid, p_network_ref text)
returns table (credited boolean, new_available_gram numeric(18, 9))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_view    public.ad_views%rowtype;
  v_balance numeric(18, 9);
begin
  select * into v_view from public.ad_views where id = p_id and status = 'PENDING' for update;
  if not found then
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
  where id = p_id;

  insert into public.ledger_entries (user_id, transaction_type, direction, amount, fee, asset, metadata)
  values (v_view.user_id, 'AD_REWARD', 'CREDIT', v_view.reward_gram, 0, 'GRAM',
          jsonb_build_object('network', v_view.network, 'click_id', p_id, 'network_ref', p_network_ref));

  insert into public.transactions (user_id, type, amount, fee, net_amount, status)
  values (v_view.user_id, 'AD_REWARD', v_view.reward_gram, 0, v_view.reward_gram, 'COMPLETED');

  credited := true;
  new_available_gram := v_balance;
  return next;
end;
$$;
revoke all on function public._settle_ad_view(uuid, text) from public, anon, authenticated;

-- exact-row settle (networks that echo our click_id back, e.g. Monetag ymid)
create or replace function public.credit_ad_view(
  p_click_id    uuid,
  p_network     text,
  p_network_ref text default null
)
returns table (credited boolean, new_available_gram numeric(18, 9))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.ad_views
  where id = p_click_id and network = p_network and status = 'PENDING';

  if v_id is null then
    credited := false;
    new_available_gram := null;
    return next;
    return;
  end if;
  return query select * from public._settle_ad_view(v_id, p_network_ref);
end;
$$;
revoke all on function public.credit_ad_view(uuid, text, text) from public, anon, authenticated;

-- FIFO settle by telegram_id (networks that only echo the user id, e.g. Adsgram)
create or replace function public.credit_oldest_pending_ad_view(
  p_telegram_id bigint,
  p_network     text,
  p_network_ref text default null
)
returns table (credited boolean, new_available_gram numeric(18, 9))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_id  uuid;
begin
  select id into v_uid from public.profiles where telegram_id = p_telegram_id;
  if v_uid is null then
    credited := false;
    new_available_gram := null;
    return next;
    return;
  end if;

  select id into v_id
  from public.ad_views
  where user_id = v_uid and network = p_network and status = 'PENDING'
  order by created_at asc
  limit 1;

  if v_id is null then
    credited := false;
    new_available_gram := null;
    return next;
    return;
  end if;
  return query select * from public._settle_ad_view(v_id, p_network_ref);
end;
$$;
revoke all on function public.credit_oldest_pending_ad_view(bigint, text, text) from public, anon, authenticated;
