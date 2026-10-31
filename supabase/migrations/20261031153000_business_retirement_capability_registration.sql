alter table public.platform_admin_capability_grant_versions
  drop constraint if exists platform_admin_capability_code_check,
  add constraint platform_admin_capability_code_check
  check (capability_code = any (array[
    'admin.pricing.manage'::text,
    'admin.payments.reconcile'::text,
    'admin.installments.manage'::text,
    'admin.branch_setup.manage'::text,
    'admin.agreements.publish'::text,
    'admin.merchants.retire'::text
  ]));

comment on constraint platform_admin_capability_code_check
  on public.platform_admin_capability_grant_versions is
  'Allowlisted ProcessEdge Admin capabilities, including scoped Business retirement grant/deny authority.';
