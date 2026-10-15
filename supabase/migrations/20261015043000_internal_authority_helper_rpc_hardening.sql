begin;

-- These functions are internal authorization primitives. Governed SellerTray
-- commands and final RLS surfaces may call them from SECURITY DEFINER code, but
-- clients must not be able to probe another business/user's authority by
-- supplying arbitrary tenant, Branch or user identifiers over PostgREST RPC.
-- Reassert the intended execution boundary explicitly so later function
-- lifecycle changes cannot leave PostgreSQL's default PUBLIC EXECUTE in place.
revoke all on function public.sellertray_user_can_read_branch(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_read_branch(uuid,uuid,uuid)
  to service_role;

revoke all on function public.sellertray_user_can_operate_branch(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_operate_branch(uuid,uuid,uuid)
  to service_role;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text)
  to service_role;

commit;
