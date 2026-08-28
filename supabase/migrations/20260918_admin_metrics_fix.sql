-- Meme Farm — fix admin_metrics.
--
-- 1. "column reference \"emission_factor\" is ambiguous" — the RETURNS TABLE
--    column shadowed farm_states.emission_factor inside the sub-select. Every
--    source table is now aliased and every column qualified.
-- 2. Pending figures now read the live queue (`withdrawal_requests`, since
--    20260915) instead of the legacy `transactions … status = 'PENDING'` rows.

create or replace function public.admin_metrics(p_admin_id uuid)
returns table (
  total_balances  numeric,
  withdrawn_24h   numeric,
  withdrawn_7d    numeric,
  pending_count   integer,
  pending_sum     numeric,
  user_count      integer,
  emission_factor numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  return query select
    coalesce((select sum(b.available_gram) from public.balances b), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.type = 'WITHDRAW' and t.status = 'COMPLETED'
                and t.created_at > now() - interval '24 hours'), 0),
    coalesce((select sum(t.amount) from public.transactions t
              where t.type = 'WITHDRAW' and t.status = 'COMPLETED'
                and t.created_at > now() - interval '7 days'), 0),
    coalesce((select count(*) from public.withdrawal_requests w
              where w.status in ('PENDING', 'AUTO_QUEUED', 'APPROVED', 'PROCESSING')), 0)::int,
    coalesce((select sum(w.amount_gram) from public.withdrawal_requests w
              where w.status in ('PENDING', 'AUTO_QUEUED', 'APPROVED', 'PROCESSING')), 0),
    coalesce((select count(*) from public.profiles p), 0)::int,
    coalesce((select fs.emission_factor from public.farm_states fs
              order by fs.user_id limit 1), 1.0);
end;
$$;

revoke all on function public.admin_metrics(uuid) from public, anon;
grant execute on function public.admin_metrics(uuid) to authenticated;
