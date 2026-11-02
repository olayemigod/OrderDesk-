begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

with verifier as (
  select lower(pg_get_functiondef(p.oid)) as definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='platform_admin_verify_oa5c_production_test_business_proof'
    and pg_get_function_identity_arguments(p.oid)='p_actor_user_id uuid, p_tenant_id uuid, p_commercial_order_id uuid'
)
select extensions.ok(
  position('and p.master_agreement_version_id=v_current_master_id' in definition)=0,
  'OA5C v3 does not force a historical Agreement Package onto the currently required Master version'
) from verifier;

with verifier as (
  select lower(pg_get_functiondef(p.oid)) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='platform_admin_verify_oa5c_production_test_business_proof'
)
select extensions.ok(
  position('where p.id=v_confirmation.agreement_package_id' in definition)>0
  and position('from public.sellertray_order_form_confirmations c' in definition)
      < position('where p.id=v_confirmation.agreement_package_id' in definition),
  'OA5C resolves the historical Agreement Package from the immutable Order Form confirmation rather than newest-package ordering'
) from verifier;

with verifier as (
  select lower(pg_get_functiondef(p.oid)) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='platform_admin_verify_oa5c_production_test_business_proof'
)
select extensions.ok(
  position('v_package.manifest#>>''{masteragreement,versionid}''=v_package.master_agreement_version_id::text' in definition)>0,
  'Agreement Package manifest is validated against its own immutable Master version'
) from verifier;

with verifier as (
  select lower(pg_get_functiondef(p.oid)) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='platform_admin_verify_oa5c_production_test_business_proof'
)
select extensions.ok(
  position('v_confirmation.request_evidence->>''master_agreement_version_id''=v_package.master_agreement_version_id::text' in definition)>0,
  'Order Form confirmation evidence remains bound to the package Master version actually reviewed'
) from verifier;

with verifier as (
  select lower(pg_get_functiondef(p.oid)) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='platform_admin_verify_oa5c_production_test_business_proof'
)
select extensions.ok(
  position('v_package_master_acceptance_ok' in definition)>0
  and position('and v_package_master_acceptance_ok' in definition)>0,
  'historical package proof requires a valid authenticated acceptance of that package Master version'
) from verifier;

with verifier as (
  select lower(pg_get_functiondef(p.oid)) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='platform_admin_verify_oa5c_production_test_business_proof'
)
select extensions.ok(
  position('confirmation_component' in definition)>0
  and position('acceptance_component' in definition)>0,
  'verifier preserves immutable legacy confirmation evidence while accepting the current confirmation-component contract'
) from verifier;

with verifier as (
  select lower(pg_get_functiondef(p.oid)) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='platform_admin_verify_oa5c_production_test_business_proof'
)
select extensions.ok(
  position('v_current_master_id := public.resolve_sellertray_master_agreement_version_id(now())' in definition)>0
  and position('platform_admin_verify_oa5c_real_merchant_proof' in definition)>0,
  'current Master state remains a separate base OA5C proof concern rather than historical package identity'
) from verifier;

select extensions.ok(
  not has_function_privilege('anon','public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)','EXECUTE'),
  'anonymous and merchant sessions cannot execute the platform OA5C production proof verifier directly'
);

select extensions.ok(
  has_function_privilege('service_role','public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)','EXECUTE'),
  'service-role verification retains the governed OA5C proof boundary'
);

select * from extensions.finish();
rollback;
