-- =============================================================================
-- Meme Farm — fix admin_support_messages: "column reference sender is ambiguous"
-- The RETURNS TABLE column `sender` shadowed support_messages.sender in the
-- mark-as-read UPDATE. Qualify it.
-- =============================================================================

create or replace function public.admin_support_messages(p_admin_id uuid, p_user_id uuid)
returns table (
  id         uuid,
  sender     text,
  body       text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_admin(p_admin_id);
  update public.support_messages
  set read_by_admin = true
  where support_messages.user_id = p_user_id
    and support_messages.sender = 'USER'
    and support_messages.read_by_admin = false;
  update public.support_threads set unread_admin = 0 where support_threads.user_id = p_user_id;

  return query
  select m.id, m.sender, m.body, m.created_at
  from public.support_messages m
  where m.user_id = p_user_id
  order by m.created_at;
end;
$$;

revoke all on function public.admin_support_messages(uuid, uuid) from public, anon;
grant execute on function public.admin_support_messages(uuid, uuid) to authenticated;
