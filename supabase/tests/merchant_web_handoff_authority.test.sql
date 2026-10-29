begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select extensions.ok(
  to_regclass('public.sellertray_merchant_web_handoffs') is not null,
  'merchant web handoff evidence table exists'
);

select extensions.ok(
  coalesce((select c.relrowsecurity from pg_class c where c.oid = 'public.sellertray_merchant_web_handoffs'::regclass), false),
  'merchant web handoff evidence has RLS enabled'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.sellertray_merchant_web_handoffs', 'SELECT'),
  'anon cannot read handoff evidence'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.sellertray_merchant_web_handoffs', 'SELECT'),
  'authenticated clients cannot read handoff evidence directly'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.sellertray_merchant_web_handoffs', 'INSERT'),
  'authenticated clients cannot manufacture handoff evidence directly'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.sellertray_merchant_web_handoffs', 'SELECT') and
  has_table_privilege('service_role', 'public.sellertray_merchant_web_handoffs', 'INSERT') and
  has_table_privilege('service_role', 'public.sellertray_merchant_web_handoffs', 'UPDATE') and
  has_table_privilege('service_role', 'public.sellertray_merchant_web_handoffs', 'DELETE'),
  'only the governed service boundary can manage handoff evidence'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_merchant_web_handoff_target(uuid)') is not null,
  'merchant web handoff target RPC exists'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_sellertray_merchant_web_handoff_target(uuid)', 'EXECUTE'),
  'authenticated Owner/Manager clients can request a governed handoff target'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.get_sellertray_merchant_web_handoff_target(uuid)', 'EXECUTE'),
  'anon cannot request a merchant web handoff target'
);

select extensions.like(
  pg_get_functiondef('public.get_sellertray_onboarding_state(uuid)'::regprocedure),
  '%review_setup_appointments%',
  'merchant onboarding wrapper routes incomplete setup appointment management to Merchant Web'
);
select extensions.like(
  pg_get_functiondef('public.get_sellertray_merchant_web_handoff_target(uuid)'::regprocedure),
  '%review_master_agreement%agreements%pay_outstanding%sellertray_billing%review_setup_appointments%setup%',
  'handoff target RPC maps governed lifecycle actions to exact Merchant Web surfaces'
);

select * from extensions.finish();
rollback;
