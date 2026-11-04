begin;

-- Forward convergence for hosted databases that carried an explicit anon grant on
-- sellertray_tenant_is_retired(uuid) before the PR #176 retirement migration.
-- REVOKE FROM public does not remove a role-specific grant, so normalize the live
-- ACL explicitly while preserving the approved authenticated/service-role access.
revoke execute on function public.sellertray_tenant_is_retired(uuid)
  from public, anon;
grant execute on function public.sellertray_tenant_is_retired(uuid)
  to authenticated, service_role;

comment on function public.sellertray_tenant_is_retired(uuid) is
  'SellerTray Business-retirement state helper. Anonymous execution is denied; authenticated and service-role callers retain the approved compatibility access.';

commit;
