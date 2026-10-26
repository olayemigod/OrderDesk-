begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

with definition as (
  select lower(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
  )) as body
)
select extensions.ok(
  position('min(b.id)' in body)=0
  and position('min(a.id)' in body)=0,
  'OA5C verifier does not use unsupported UUID min aggregates'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('e.appointment_id=v_appointment_id' in body)>0,
  'setup completion evidence is tied to the exact selected governed appointment'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('assert_sellertray_setup_completion_evidence(v_completion_evidence)' in body)>0,
  'OA5C verifier validates the structured OA4 setup completion evidence contract'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_readiness_ready_at=v_appointment_completed_at' in body)>0
  and position('''source'',''oa3_setup_appointment''' in body)>0
  and position('''appointmentid'',v_appointment_id' in body)>0
  and position('v_readiness_evidence=(' in body)>0,
  'Branch readiness must exactly derive from the governed completion command, time and evidence'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('ps.net_amountisnull' in body)>0
  and position('ps.tax_rate_percentisnull' in body)>0
  and position('ps.tax_amountisnull' in body)>0
  and position('v_price_tax_incomplete_count=0' in body)>0,
  'OA5C pricing gate requires complete governed tax snapshots on every line'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_subscription_plan_code=v_entitlement_plan_code' in body)>0
  and position('v_subscription_period_start=v_entitlement_effective_from' in body)>0
  and position('v_subscription_period_end=v_entitlement_effective_until' in body)>0,
  'legacy compatibility runtime must exactly match governed entitlement plan and period'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_subscription_status=''active''' in body)>0
  and position('orderdesk_subscription_can_write(p_tenant_id)' in body)>0,
  'compatibility runtime must be active and operationally writable in addition to exact plan/period parity'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('(v_gateway_payment_count+v_direct_payment_count)>0' in body)>0
  and position('externalprovenancestillmanual'',true' in body)>0,
  'recorded payment facts are required while external real-world provenance remains an explicit manual acceptance check'
)
from definition;

with definition as (
  select lower(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
  )) as body
)
select extensions.ok(
  position('insert into' in body)=0
  and position('update public.' in body)=0
  and position('delete from' in body)=0,
  'hardening keeps the OA5C verifier read-only'
)
from definition;

select * from extensions.finish();
rollback;
