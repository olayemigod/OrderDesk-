begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

-- Synthetic fixture for verifier runtime/unit coverage only.
-- It deliberately lacks price/payment/agreement/setup/entitlement evidence and
-- therefore can never be OA5C acceptance evidence.
insert into auth.users (id,email,created_at,updated_at)
values (
  '00000000-0000-0000-0000-00000000c501'::uuid,
  'oa5c-runtime-test@example.invalid',
  now(),
  now()
);

insert into public.platform_admins (user_id,role)
values ('00000000-0000-0000-0000-00000000c501'::uuid,'admin');

-- Tenant provisioning creates the default active MAIN Branch. Reuse that
-- governed provisioning result instead of creating a duplicate fixture Branch.
insert into public.tenants (id,name,slug,merchant_code)
values (
  '00000000-0000-0000-0000-00000000c502'::uuid,
  'OA5C runtime verifier fixture',
  'oa5c-runtime-verifier-fixture',
  'Z5C'
);

insert into public.sellertray_commercial_orders (
  id,
  tenant_id,
  order_reference,
  currency,
  total_gross_amount,
  created_by_user_id
)
values (
  '00000000-0000-0000-0000-00000000c504'::uuid,
  '00000000-0000-0000-0000-00000000c502'::uuid,
  'OA5C-RUNTIME-NO-EVIDENCE',
  'NGN',
  1000,
  '00000000-0000-0000-0000-00000000c501'::uuid
);

select extensions.lives_ok(
  $$
    select public.platform_admin_verify_oa5c_real_merchant_proof(
      '00000000-0000-0000-0000-00000000c501'::uuid,
      '00000000-0000-0000-0000-00000000c502'::uuid,
      '00000000-0000-0000-0000-00000000c504'::uuid
    )
  $$,
  'OA5C verifier executes on a valid Business/order subject instead of failing on UUID aggregates or missing optional evidence'
);

with proof as (
  select public.platform_admin_verify_oa5c_real_merchant_proof(
    '00000000-0000-0000-0000-00000000c501'::uuid,
    '00000000-0000-0000-0000-00000000c502'::uuid,
    '00000000-0000-0000-0000-00000000c504'::uuid
  ) as payload
)
select extensions.ok(
  payload->>'proofVersion'='oa5c-v2'
  and coalesce((payload->>'automatedEvidencePassed')::boolean,false)=false
  and coalesce((payload->>'oa5cAccepted')::boolean,false)=false,
  'runtime verifier returns v2 fail-closed evidence and never self-accepts the synthetic fixture'
)
from proof;

with proof as (
  select public.platform_admin_verify_oa5c_real_merchant_proof(
    '00000000-0000-0000-0000-00000000c501'::uuid,
    '00000000-0000-0000-0000-00000000c502'::uuid,
    '00000000-0000-0000-0000-00000000c504'::uuid
  ) as payload
)
select extensions.ok(
  coalesce((payload#>>'{gates,singleActiveBranch,pass}')::boolean,false)=true
  and coalesce((payload#>>'{gates,governedPricingAndTax,pass}')::boolean,false)=false,
  'runtime proof reuses the provisioned active Branch but blocks absent governed pricing/tax evidence'
)
from proof;

with proof as (
  select public.platform_admin_verify_oa5c_real_merchant_proof(
    '00000000-0000-0000-0000-00000000c501'::uuid,
    '00000000-0000-0000-0000-00000000c502'::uuid,
    '00000000-0000-0000-0000-00000000c504'::uuid
  ) as payload
)
select extensions.ok(
  coalesce((payload#>>'{gates,governedSetupAndDerivedReadiness,pass}')::boolean,false)=false
  and coalesce((payload#>>'{gates,compatibilityRuntime,pass}')::boolean,false)=false,
  'runtime proof blocks absent setup/readiness and entitlement/runtime convergence without manufacturing those facts'
)
from proof;

select * from extensions.finish();
rollback;
