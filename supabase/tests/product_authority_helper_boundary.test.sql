begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

select extensions.ok(
  to_regprocedure('public.sellertray_user_can_manage_products(uuid,uuid)') is not null,
  'product management authority helper exists'
);
select extensions.ok(
  not has_function_privilege('anon','public.sellertray_user_can_manage_products(uuid,uuid)','EXECUTE'),
  'anonymous clients cannot execute the product authority helper'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.sellertray_user_can_manage_products(uuid,uuid)','EXECUTE'),
  'authenticated clients cannot evaluate arbitrary member product authority directly'
);
select extensions.ok(
  has_function_privilege('service_role','public.sellertray_user_can_manage_products(uuid,uuid)','EXECUTE'),
  'service role retains internal product authority evaluation'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.sellertray_user_has_capability(uuid,uuid,text)','EXECUTE'),
  'generic capability helper remains internal-only'
);

select * from extensions.finish();
rollback;
