begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(
  to_regprocedure('public.platform_admin_onboarding_commercial_report(uuid,integer)') is not null,
  'OA5B onboarding/commercial report exists'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.platform_admin_onboarding_commercial_report(uuid,integer)',
    'EXECUTE'
  ),
  'merchant clients cannot invoke the privileged OA5B report directly'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.platform_admin_onboarding_commercial_report(uuid,integer)',
    'EXECUTE'
  ),
  'verified server boundary can invoke the OA5B report'
);

select extensions.ok(
  position(
    'get_sellertray_onboarding_state_core'
    in lower(pg_get_functiondef(
      'public.platform_admin_onboarding_commercial_report(uuid,integer)'::regprocedure
    ))
  ) > 0,
  'OA5B composes the governed onboarding read authority'
);

select extensions.ok(
  position(
    'sellertray_master_agreement_acceptances'
    in lower(pg_get_functiondef(
      'public.platform_admin_onboarding_commercial_report(uuid,integer)'::regprocedure
    ))
  ) > 0,
  'OA5B reports current universal Master Agreement acceptance evidence'
);

select extensions.ok(
  position(
    'sellertray_commercial_setup_appointments'
    in lower(pg_get_functiondef(
      'public.platform_admin_onboarding_commercial_report(uuid,integer)'::regprocedure
    ))
  ) > 0
  and position(
    'sellertray_commercial_branch_setup_readiness'
    in lower(pg_get_functiondef(
      'public.platform_admin_onboarding_commercial_report(uuid,integer)'::regprocedure
    ))
  ) > 0,
  'OA5B reports governed Branch setup and readiness facts'
);

select extensions.ok(
  position(
    'platform_admin_audit'
    in lower(pg_get_functiondef(
      'public.platform_admin_onboarding_commercial_report(uuid,integer)'::regprocedure
    ))
  ) > 0,
  'OA5B includes recorded ProcessEdge intervention evidence'
);

select extensions.ok(
  position(
    'onboardingcommercial'
    in lower(pg_get_functiondef(
      'public.platform_admin_business_summary(uuid,integer)'::regprocedure
    ))
  ) > 0,
  'existing Business Dashboard server summary carries the OA5B report'
);

create temp table oa5b_fixture(
  admin_user_id uuid not null,
  tenant_id uuid not null
) on commit drop;

insert into oa5b_fixture(admin_user_id,tenant_id)
values (gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select
  admin_user_id,
  'oa5b-admin-'||substr(admin_user_id::text,1,8)||'@example.com',
  'authenticated',
  'authenticated',
  now(),
  now()
from oa5b_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin'
from oa5b_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select
  tenant_id,
  'OA5B Reporting Business',
  'oa5b-report-'||substr(tenant_id::text,1,8),
  'OA5B-'||substr(tenant_id::text,1,8),
  'trial'
from oa5b_fixture;

select extensions.ok(
  (
    public.platform_admin_onboarding_commercial_report(f.admin_user_id,100)
      ->'funnel'->>'totalBusinesses'
  )::integer >= 1,
  'OA5B funnel is server-derived for the merchant estate'
)
from oa5b_fixture f;

select extensions.ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.platform_admin_onboarding_commercial_report(f.admin_user_id,100)->'items'
    ) item
    where item->>'tenantId'=f.tenant_id::text
      and item->>'currentStage'='business_setup'
  ),
  'OA5B reports a Business with no active Branch at the governed business-setup stage'
)
from oa5b_fixture f;

select extensions.ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.platform_admin_onboarding_commercial_report(f.admin_user_id,100)->'items'
    ) item
    where item->>'tenantId'=f.tenant_id::text
      and item->'branches'='[]'::jsonb
  ),
  'OA5B Branch reporting is explicit even when a Business has no Branch yet'
)
from oa5b_fixture f;

select extensions.ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.platform_admin_onboarding_commercial_report(f.admin_user_id,100)->'items'
    ) item
    where item->>'tenantId'=f.tenant_id::text
      and (
        item ? 'acquisitionSource'
        or item ? 'sourceAttribution'
      )
  ),
  'OA5B does not invent acquisition/source attribution'
)
from oa5b_fixture f;

select * from extensions.finish();
rollback;
