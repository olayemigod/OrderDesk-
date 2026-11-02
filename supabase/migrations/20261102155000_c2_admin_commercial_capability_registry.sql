begin;

-- Register the semantic Commercial V2 management capabilities used by the new
-- server commands. This keeps explicit grants/denials authoritative instead of
-- falling back permanently to the coarse Platform Admin persona.
alter table public.platform_admin_capability_grant_versions
  drop constraint if exists platform_admin_capability_code_check;

alter table public.platform_admin_capability_grant_versions
  add constraint platform_admin_capability_code_check check (
    capability_code in (
      'admin.pricing.manage',
      'admin.plans.manage',
      'admin.commercial_tax.manage',
      'admin.commercial_payment_methods.manage',
      'admin.payments.reconcile',
      'admin.installments.manage',
      'admin.branch_setup.manage',
      'admin.agreements.publish',
      'admin.merchants.read',
      'admin.merchants.retire',
      'admin.merchants.act',
      'admin.payments.read',
      'admin.payments.act',
      'admin.audit.read',
      'admin.audit.export'
    )
  );

comment on constraint platform_admin_capability_code_check
  on public.platform_admin_capability_grant_versions is
  'Registered ProcessEdge Admin capability codes, including Commercial V2 Plan Profile, commercial tax and commercial payment-method management.';

commit;
