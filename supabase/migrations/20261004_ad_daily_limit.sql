-- =============================================================================
-- Meme Farm — daily cap: 20 ad views per network per UTC day.
--
-- Counts PENDING + CREDITED attempts for today (UTC) — an abandoned/expired
-- attempt still uses up one of the 20, matching how a real ad slot works.
-- REJECTED rows (stale postback-less attempts, aged out by
-- reject_stale_ad_views) don't count, so those don't burn the user's quota.
-- =============================================================================

create or replace function public.create_ad_view(p_network text)
returns table (click_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_count int;
  v_limit constant int := 20;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_network not in ('adsgram', 'monetag', 'gigapub', 'richads') then
    raise exception 'unknown network %', p_network using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.ad_views
  where user_id = v_uid
    and network = p_network
    and status in ('PENDING', 'CREDITED')
    and (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date;

  if v_count >= v_limit then
    raise exception 'daily ad limit reached for %', p_network using errcode = 'P0001';
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
