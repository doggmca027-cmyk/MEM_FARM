-- =============================================================================
-- Meme Farm — fix admin_update_emission_factor: "UPDATE requires a WHERE clause"
--
-- `update public.farm_states set emission_factor = p_factor;` had no WHERE, so
-- Supabase's pg-safeupdate guard rejected it (SQLSTATE 21000) — the admin
-- "Emission Factor" buttons did nothing. Add an all-rows WHERE.
-- =============================================================================

create or replace function public.admin_update_emission_factor(p_admin_id uuid, p_factor numeric)
returns table (updated_rows integer, emission_factor numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  if p_factor <= 0 or p_factor > 2 then
    raise exception 'emission factor out of range (0, 2]' using errcode = '22023';
  end if;

  update public.farm_states set emission_factor = p_factor
  where user_id is not null;               -- all rows; satisfies pg-safeupdate
  get diagnostics updated_rows = row_count;

  -- new sign-ups pick up the new value
  execute format('alter table public.farm_states alter column emission_factor set default %L', p_factor);

  emission_factor := p_factor;
  return next;
end;
$$;

revoke all on function public.admin_update_emission_factor(uuid, numeric) from public, anon;
grant execute on function public.admin_update_emission_factor(uuid, numeric) to authenticated;
