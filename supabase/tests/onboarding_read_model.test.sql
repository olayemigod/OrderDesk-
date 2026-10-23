begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_onboarding_state(uuid)','EXECUTE'),
  'authenticated Owner/Manager clients can call the governed onboarding wrapper'
);
select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_onboarding_state(uuid)','EXECUTE'),
  'anonymous clients cannot read merchant onboarding commercial state'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_onboarding_state_core(uuid)','EXECUTE'),
  'authenticated clients cannot bypass the merchant onboarding permission wrapper'
);
select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_onboarding_state_core(uuid)','EXECUTE'),
  'service role can execute the shared onboarding projection'
);
select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_onboarding_state_admin(uuid,uuid)','EXECUTE'),
  'service role can execute the ProcessEdge Admin onboarding wrapper'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_onboarding_state_admin(uuid,uuid)','EXECUTE'),
  'merchant clients cannot call the ProcessEdge Admin onboarding wrapper'
);
select extensions.ok(
  position(
    'if v_role is null or v_role not in' in
    lower(pg_get_functiondef('public.get_sellertray_onboarding_state(uuid)'::regprocedure))
  ) > 0,
  'merchant onboarding wrapper explicitly rejects missing membership instead of relying on NULL NOT IN semantics'
);
select extensions.ok(
  position(
    'if v_role is null or v_role not in' in
    lower(pg_get_functiondef('public.get_sellertray_onboarding_state_admin(uuid,uuid)'::regprocedure))
  ) > 0,
  'Admin onboarding wrapper explicitly rejects missing platform-admin identity'
);

create temporary table oa1_fixture(tenant_id uuid primary key) on commit drop;

with inserted as (
  insert into public.tenants(
    name,slug,merchant_code,currency,timezone,onboarding_status,
    subscription_status,whatsapp_connection_status
  ) values (
    'OA1 Read Model Test','oa1-read-model-test','OA1','NGN','Africa/Lagos',
    'catalogue','trial','not_connected'
  )
  returning id
)
insert into oa1_fixture(tenant_id)
select id from inserted;

-- Business creation already establishes the governed default active Branch and
-- trial subscription. The OA1 fixture must consume those existing authorities
-- rather than manufacture a second default Branch or a second runtime state.
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)->>'currentStage' from oa1_fixture),
  'commercial_order',
  'a prepared Business with no governed purchase is at the commercial-order stage'
);
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)#>>'{nextAction,surface}' from oa1_fixture),
  'merchant_web',
  'plan selection remains a Merchant Web responsibility'
);
select extensions.is(
  (select (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{branchPreparation,activeBranchCount}')::integer from oa1_fixture),
  1,
  'the onboarding projection derives the governed default active Branch from shared Branch authority'
);
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)->>'accessEnforcement' from oa1_fixture),
  'informational_only_until_oa4',
  'OA1 onboarding status is explicitly non-blocking until the governed activation cutover'
);
select extensions.is(
  (select (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{settlement,approvedAdjustmentAmount}')::numeric from oa1_fixture),
  0::numeric,
  'OA1 does not manufacture an onboarding discount before OA2 adjustment authority exists'
);
select extensions.is(
  (select (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{settlement,directPaymentAmount}')::numeric from oa1_fixture),
  0::numeric,
  'OA1 does not manufacture a direct payment before OA2 reconciliation authority exists'
);
select extensions.is(
  (select (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{legacyRuntime,compatibilityAccess}')::boolean from oa1_fixture),
  true,
  'OA1 exposes existing governed trial compatibility access without converting it into onboarding activation'
);

select * from extensions.finish();
rollback;
