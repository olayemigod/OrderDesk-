begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

select extensions.ok(
  not has_function_privilege('anon','public.sellertray_tenant_is_retired(uuid)','EXECUTE'),
  'anonymous clients cannot execute the Business-retirement state helper'
);
select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_tenant_is_retired(uuid)','EXECUTE'),
  'authenticated compatibility callers retain retirement-state helper access'
);
select extensions.ok(
  has_function_privilege('service_role','public.sellertray_tenant_is_retired(uuid)','EXECUTE'),
  'service-role callers retain retirement-state helper access'
);

select * from extensions.finish();
rollback;
