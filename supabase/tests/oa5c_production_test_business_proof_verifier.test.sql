begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

select extensions.has_function(
  'public',
  'platform_admin_verify_oa5c_production_test_business_proof',
  array['uuid','uuid','uuid'],
  'OA5C exposes the canonical production-test Business verifier'
);

with definition as (
  select lower(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  )) as body
)
select extensions.ok(
  position('platform_admin_verify_oa5c_real_merchant_proof' in body)>0,
  'v3 composes the already-governed v2 lifecycle gates instead of duplicating their business truth'
)
from definition;

with definition as (
  select lower(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  )) as body
)
select extensions.ok(
  position('sellertray_commercial_order_forms' in body)>0
  and position('sellertray_agreement_packages' in body)>0
  and position('sellertray_order_form_confirmations' in body)>0,
  'v3 adds exact Order Form, Agreement Package and merchant confirmation proof'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('replacement.supersedes_order_form_id=f.id' in body)>0
  and position('v_order_form_count=1' in body)>0
  and position('f.commercial_order_id=p_commercial_order_id' in body)>0,
  'OA5C requires exactly one current unsuperseded Order Form for the exact commercial order'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_template.publication_scope=''production''' in body)>0
  and position('v_template.production_authorized_at<=v_order_form.issued_at' in body)>0
  and position('v_template.version_code=v_order_form.template_version_code' in body)>0
  and position('v_template.content_sha256=v_order_form.template_content_sha256' in body)>0,
  'OA5C requires exact immutable production-authorized Order Form template provenance'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_order_form_okandv_order_form_template_authorizedandv_manifest_ok' in body)>0
  and position('orderformtemplateproductionauthorized' in body)>0,
  'production template provenance is mandatory for the Agreement Package gate and automated evidence'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_package.master_content_sha256=v_current_master_hash' in body)>0
  and position('v_package.order_form_content_sha256=v_order_form.content_sha256' in body)>0
  and position('v_package.order_form_commercial_snapshot_sha256=v_order_form.commercial_snapshot_sha256' in body)>0
  and position('extensions.digest(convert_to(v_package.manifest::text,''utf8''),''sha256'')' in body)>0,
  'Agreement Package hashes and deterministic manifest fingerprint must reconcile exactly'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_confirmation.confirmation_method=''merchant_web_authenticated''' in body)>0
  and position('authority_confirmed' in body)>0
  and position('acceptance_component' in body)>0
  and position('order_form_confirmation' in body)>0,
  'Order Form confirmation must be authenticated merchant action with explicit authority evidence'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('coalesce(v_confirmation.request_evidence->>''authority_confirmed'','''')=''true''' in body)>0
  and position('(v_confirmation.request_evidence->>''authority_confirmed'')::boolean' in body)=0,
  'malformed authority_confirmed evidence fails closed instead of throwing a boolean cast error'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('sellertray_commercial_order_forms' in body)>0
  and position('sellertray_agreement_packages' in body)>0
  and position('sellertray_order_form_confirmations' in body)>0
  and position('v_package_immutable_contracts_ok' in body)>0
  and position('pg_catalog.pg_get_triggerdef' in body)>0,
  'Order Form, Agreement Package and confirmation history must retain immutable update/delete trigger contracts'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('(v_core->>''automatedevidencepassed'')::booleanandv_agreement_package_ok' in body)>0,
  'Agreement Package integrity is a mandatory fail-closed addition to all v2 lifecycle gates'
)
from definition;

with definition as (
  select lower(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  )) as body
)
select extensions.ok(
  position('disposable_production_test_business' in body)>0
  and position('directdatabasepaymentinsertionforbidden' in replace(body,'_',''))>0
  and position('fabricatedlifecycleevidenceforbidden' in replace(body,'_',''))>0,
  'canonical policy names the disposable production-test Business model without relaxing evidence integrity'
)
from definition;

with definition as (
  select lower(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  )) as body
)
select extensions.ok(
  position('controlled real merchant' in body)=0
  and position('designated controlled real merchant' in body)=0,
  'obsolete real-merchant acceptance wording is absent from the active v3 verifier'
)
from definition;

with definition as (
  select lower(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  )) as body
)
select extensions.ok(
  position('insert into' in body)=0
  and position('update public.' in body)=0
  and position('delete from' in body)=0,
  'v3 remains a read-only verifier and cannot manufacture OA5C lifecycle evidence'
)
from definition;

select extensions.ok(
  lower(coalesce(obj_description(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure,
    'pg_proc'
  ),'')) like '%deprecated%compatibility%',
  'the v2 real-merchant-named verifier is explicitly marked deprecated compatibility tooling'
);

select * from extensions.finish();
rollback;
