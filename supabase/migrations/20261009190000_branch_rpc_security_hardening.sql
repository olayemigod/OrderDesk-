-- Keep the branch-list RPC callable by signed-in users without bypassing RLS.
-- Internal trigger helpers in the preceding migration remain SECURITY DEFINER
-- but have EXECUTE revoked from PUBLIC, anon and authenticated.

alter function public.get_sellertray_accessible_branches(uuid)
  security invoker;

revoke execute on function public.get_sellertray_accessible_branches(uuid)
  from public, anon;
grant execute on function public.get_sellertray_accessible_branches(uuid)
  to authenticated, service_role;
