begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

select extensions.ok(
  position('admin.plans.manage' in (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid='public.platform_admin_capability_grant_versions'::regclass
      and conname='platform_admin_capability_code_check'
  ))>0,
  'Plan Profile management capability is registered for explicit Admin grants and denials'
);

select extensions.ok(
  position('admin.commercial_tax.manage' in (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid='public.platform_admin_capability_grant_versions'::regclass
      and conname='platform_admin_capability_code_check'
  ))>0,
  'Commercial tax management capability is registered for explicit Admin grants and denials'
);

select extensions.ok(
  position('admin.commercial_payment_methods.manage' in (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid='public.platform_admin_capability_grant_versions'::regclass
      and conname='platform_admin_capability_code_check'
  ))>0,
  'Commercial payment-method management capability is registered for explicit Admin grants and denials'
);

select * from extensions.finish();
rollback;
