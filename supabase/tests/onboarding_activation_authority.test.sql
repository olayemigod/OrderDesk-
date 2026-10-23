begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tenants'
      and column_name='commercial_activation_required'
      and is_nullable='NO'
  ),
  'commercial activation rollout policy is required on tenants'
);
select extensions.ok(
  (select column_default like '%true%' from information_schema.columns
   where table_schema='public' and table_name='tenants' and column_name='commercial_activation_required'),
  'new businesses require governed commercial activation by default'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_onboarding_state(uuid)','EXECUTE'),
  'authenticated merchants can read their governed onboarding projection'
);
select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_onboarding_state(uuid)','EXECUTE'),
  'anonymous callers cannot read merchant onboarding projection'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.derive_sellertray_onboarding_state(uuid)','EXECUTE'),
  'authenticated callers cannot bypass onboarding authorization through private derivation'
);
select extensions.ok(
  not has_function_privilege('service_role','public.derive_sellertray_onboarding_state(uuid)','EXECUTE'),
  'service role cannot call private derivation directly'
);
select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_onboarding_state_for_actor(uuid,uuid)','EXECUTE'),
  'trusted services use the actor-checked onboarding wrapper'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_onboarding_state_for_actor(uuid,uuid)','EXECUTE'),
  'merchant clients cannot impersonate another onboarding actor'
);
select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_onboarding_state_admin(uuid,uuid)','EXECUTE'),
  'Admin service can read the platform-authorized onboarding projection'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_onboarding_state_admin(uuid,uuid)','EXECUTE'),
  'merchant clients cannot call the Admin onboarding projection'
);
select extensions.ok(
  (select prosecdef from pg_proc where oid='public.get_sellertray_onboarding_state(uuid)'::regprocedure),
  'merchant onboarding wrapper enforces membership inside a security-definer boundary'
);
select extensions.ok(
  (select prosecdef from pg_proc where oid='public.get_sellertray_onboarding_state_admin(uuid,uuid)'::regprocedure),
  'Admin onboarding wrapper enforces platform role inside a security-definer boundary'
);

select * from extensions.finish();
rollback;
