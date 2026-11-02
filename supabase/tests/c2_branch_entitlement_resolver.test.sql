begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(25);

select extensions.ok(has_function_privilege('authenticated','public.resolve_sellertray_branch_entitlement(uuid,uuid,timestamptz)','EXECUTE'),'Authenticated surfaces can consume the shared governed Branch entitlement read model');
select extensions.ok(has_function_privilege('authenticated','public.sellertray_branch_plan_allows_feature(uuid,uuid,text,timestamptz)','EXECUTE'),'Feature entitlement wrapper is available through the shared Branch resolver');
select extensions.ok(has_function_privilege('authenticated','public.sellertray_branch_plan_allows_capability(uuid,uuid,text,timestamptz)','EXECUTE'),'Capability entitlement wrapper is available through the shared Branch resolver');
select extensions.ok(has_function_privilege('authenticated','public.get_sellertray_business_branch_subscription_summary(uuid,timestamptz)','EXECUTE'),'Business Branch-subscription summary is exposed as a governed read model');

create temp table c2_branch_resolver_fixture(
  tenant_id uuid not null,
  actor_user_id uuid not null,
  plan_a_id uuid not null,
  plan_a_version_id uuid not null,
  plan_b_id uuid not null,
  plan_b_version_id uuid not null,
  addon_definition_id uuid not null,
  addon_version_id uuid not null,
  branch_a_id uuid,
  branch_b_id uuid,
  branch_d_id uuid,
  subscription_a_id uuid,
  subscription_b_id uuid,
  a_oct15 jsonb,
  a_inactive jsonb,
  a_suspended jsonb,
  b_sep25 jsonb,
  b_oct05 jsonb,
  b_oct15 jsonb,
  b_oct17 jsonb,
  d_oct15 jsonb,
  summary_oct15 jsonb
) on commit drop;

insert into c2_branch_resolver_fixture(
  tenant_id,actor_user_id,plan_a_id,plan_a_version_id,plan_b_id,plan_b_version_id,addon_definition_id,addon_version_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_user_id,'c2-branch-resolver-'||substr(actor_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c2_branch_resolver_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C2 Branch Resolver Test','c2-branch-resolver-'||substr(tenant_id::text,1,8),'C2R','active'
from c2_branch_resolver_fixture;

insert into public.tenant_subscriptions(
  tenant_id,plan_code,status,current_period_start,current_period_end,cancel_at_period_end
)
select tenant_id,'business','active','2026-01-01T00:00:00Z','2026-12-31T00:00:00Z',false
from c2_branch_resolver_fixture
on conflict (tenant_id) do update set
  plan_code=excluded.plan_code,status=excluded.status,trial_started_at=null,trial_ends_at=null,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
  grace_ends_at=null,cancel_at_period_end=false;

update c2_branch_resolver_fixture f
set branch_a_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.is_default limit 1);

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'B','Branch B',false,true from c2_branch_resolver_fixture
union all
select tenant_id,'D','Legacy-only Branch D',false,true from c2_branch_resolver_fixture;

update c2_branch_resolver_fixture f
set branch_b_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.code='B'),
    branch_d_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.code='D');

insert into public.sellertray_plan_profiles(id,code,default_display_name,status,sort_order,created_by_user_id)
select plan_a_id,'c2_resolver_a','C2 Resolver A','active',911,actor_user_id from c2_branch_resolver_fixture
union all
select plan_b_id,'c2_resolver_b','C2 Resolver B','active',912,actor_user_id from c2_branch_resolver_fixture;

insert into public.sellertray_plan_profile_versions(
  id,plan_profile_id,version,status,display_name,description,merchant_summary,allowed_billing_cycles,change_reason,created_by_user_id
)
select plan_a_version_id,plan_a_id,1,'draft','C2 Resolver A v1','Plan A for shared Branch resolver tests.','Resolver Plan A.',array['monthly','yearly']::text[],'Prepare resolver Plan A',actor_user_id
from c2_branch_resolver_fixture
union all
select plan_b_version_id,plan_b_id,1,'draft','C2 Resolver B v1','Plan B for shared Branch resolver tests.','Resolver Plan B.',array['monthly','yearly']::text[],'Prepare resolver Plan B',actor_user_id
from c2_branch_resolver_fixture;

insert into public.sellertray_plan_profile_feature_grants(plan_profile_version_id,feature_code,enabled)
select plan_a_version_id,'catalogue',true from c2_branch_resolver_fixture
union all select plan_a_version_id,'whatsapp_commerce',true from c2_branch_resolver_fixture
union all select plan_b_version_id,'reports',true from c2_branch_resolver_fixture;

insert into public.sellertray_plan_profile_capability_grants(plan_profile_version_id,capability_code,enabled)
select plan_a_version_id,'sales.return',true from c2_branch_resolver_fixture
union all select plan_b_version_id,'reports.view',true from c2_branch_resolver_fixture;

insert into public.sellertray_plan_profile_limit_values(plan_profile_version_id,limit_code,limit_value,is_unlimited,enforcement_mode)
select plan_a_version_id,'device_count',2,false,'hard' from c2_branch_resolver_fixture
union all select plan_a_version_id,'staff_seats',null,true,'hard' from c2_branch_resolver_fixture;

update public.sellertray_plan_profile_versions v
set status='published',effective_from='2026-01-01T00:00:00Z',published_by_user_id=f.actor_user_id,
    published_at=now(),change_reason='Publish resolver test Plan Profile'
from c2_branch_resolver_fixture f
where v.id in (f.plan_a_version_id,f.plan_b_version_id);

insert into public.sellertray_addon_definitions(id,code,default_display_name,status,sort_order,created_by_user_id)
select addon_definition_id,'c2_resolver_addon','C2 Resolver Add-on','active',913,actor_user_id
from c2_branch_resolver_fixture;

insert into public.sellertray_addon_versions(
  id,addon_definition_id,version,status,display_name,description,allowed_billing_cycles,change_reason,created_by_user_id
)
select addon_version_id,addon_definition_id,1,'draft','C2 Resolver Add-on v1','Add-on for shared Branch resolver tests.',
       array['monthly','yearly','one_time']::text[],'Prepare resolver add-on',actor_user_id
from c2_branch_resolver_fixture;

insert into public.sellertray_addon_feature_grants(addon_version_id,feature_code,enabled)
select addon_version_id,'ai_insights',true from c2_branch_resolver_fixture;
insert into public.sellertray_addon_capability_grants(addon_version_id,capability_code,enabled)
select addon_version_id,'reports.view',true from c2_branch_resolver_fixture;
insert into public.sellertray_addon_limit_values(addon_version_id,limit_code,limit_delta,is_unlimited)
select addon_version_id,'device_count',3,false from c2_branch_resolver_fixture;

update public.sellertray_addon_versions a
set status='published',effective_from='2026-01-01T00:00:00Z',published_by_user_id=f.actor_user_id,
    published_at=now(),change_reason='Publish resolver test add-on'
from c2_branch_resolver_fixture f
where a.id=f.addon_version_id;

insert into public.sellertray_commercial_entitlement_override_versions(
  tenant_id,plan_profile_version_id,override_kind,feature_code,enabled,effective_from,change_reason,created_by_user_id
)
select tenant_id,plan_a_version_id,'feature','whatsapp_commerce',false,'2026-10-01T00:00:00Z','Disable WhatsApp for resolver Business',actor_user_id
from c2_branch_resolver_fixture;

insert into public.sellertray_commercial_entitlement_override_versions(
  tenant_id,plan_profile_version_id,override_kind,capability_code,enabled,effective_from,change_reason,created_by_user_id
)
select tenant_id,plan_a_version_id,'capability','sales.return',false,'2026-10-01T00:00:00Z','Disable returns for resolver Business',actor_user_id
from c2_branch_resolver_fixture;

insert into public.sellertray_commercial_entitlement_override_versions(
  tenant_id,plan_profile_version_id,override_kind,limit_code,limit_value,is_unlimited,effective_from,change_reason,created_by_user_id
)
select tenant_id,plan_a_version_id,'limit','device_count',10,false,'2026-10-01T00:00:00Z','Override device count for resolver Business',actor_user_id
from c2_branch_resolver_fixture;

select set_config('request.jwt.claim.role','service_role',true);

update c2_branch_resolver_fixture f
set subscription_a_id=public.register_sellertray_branch_subscription_term(
      f.tenant_id,f.branch_a_id,f.plan_a_version_id,'yearly','2026-03-15T00:00:00Z',
      null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','resolver_a'),
      gen_random_uuid(),'system',f.actor_user_id
    ),
    subscription_b_id=public.register_sellertray_branch_subscription_term(
      f.tenant_id,f.branch_b_id,f.plan_b_version_id,'monthly','2026-09-10T00:00:00Z',
      null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','resolver_b'),
      gen_random_uuid(),'system',f.actor_user_id
    );

do $$
begin
  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.subscription_a_id,'active','2026-03-15T00:00:00Z','2027-03-15T00:00:00Z','2027-03-15T00:00:00Z',
    gen_random_uuid(),'Activate resolver Branch A annual term','system',f.actor_user_id
  ) from c2_branch_resolver_fixture f;

  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.subscription_b_id,'provisional','2026-09-20T00:00:00Z','2026-09-30T00:00:00Z','2026-10-20T00:00:00Z',
    gen_random_uuid(),'Provisionally activate resolver Branch B','system',f.actor_user_id
  ) from c2_branch_resolver_fixture f;
end
$$;

select extensions.ok((select public.resolve_sellertray_branch_entitlement(tenant_id,branch_a_id,'2026-09-15T00:00:00Z')->>'accessMode'='full' from c2_branch_resolver_fixture),'Branch A remains fully entitled while the later Branch B commitment is still pending');
select extensions.ok((select public.resolve_sellertray_branch_entitlement(tenant_id,branch_b_id,'2026-09-15T00:00:00Z')->>'accessMode'='preparation' from c2_branch_resolver_fixture),'Branch B preparation does not inherit Branch A entitlement');

update c2_branch_resolver_fixture f
set b_sep25=public.resolve_sellertray_branch_entitlement(f.tenant_id,f.branch_b_id,'2026-09-25T00:00:00Z');
select extensions.ok((select b_sep25->>'effectiveStatus'='provisional' and b_sep25->>'accessMode'='full' from c2_branch_resolver_fixture),'A provisional Branch term resolves as full plan entitlement only inside its provisional window');

-- Full settlement is intentionally later than the provisional end. The as-of
-- resolver must show the gap as expired, not rewrite history after full activation.
do $$
begin
  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.subscription_b_id,'active','2026-10-10T00:00:00Z','2026-10-20T00:00:00Z','2026-10-20T00:00:00Z',
    gen_random_uuid(),'Fully activate resolver Branch B','system',f.actor_user_id
  ) from c2_branch_resolver_fixture f;
end
$$;

update c2_branch_resolver_fixture f
set b_oct05=public.resolve_sellertray_branch_entitlement(f.tenant_id,f.branch_b_id,'2026-10-05T00:00:00Z'),
    b_oct15=public.resolve_sellertray_branch_entitlement(f.tenant_id,f.branch_b_id,'2026-10-15T00:00:00Z');

select extensions.ok((select b_oct05->>'effectiveStatus'='expired' and b_oct05->>'accessMode'='read_only' from c2_branch_resolver_fixture),'Historical as-of resolution preserves the gap after provisional entitlement expires');
select extensions.ok((select b_oct15->>'effectiveStatus'='active' and b_oct15->>'accessMode'='full' and b_oct15->>'nextRenewalAt'='2026-10-20T00:00:00+00:00' from c2_branch_resolver_fixture),'Branch B later resolves on its own monthly full-term anniversary');

-- Add-on applies only to Branch A and Business override wins over Plan/add-on base.
do $$
begin
  perform public.register_sellertray_branch_subscription_addon(
    f.tenant_id,f.subscription_a_id,f.addon_version_id,'monthly','2026-10-01T00:00:00Z','2026-12-01T00:00:00Z',
    null,null,gen_random_uuid(),f.actor_user_id,jsonb_build_object('test','resolver_addon')
  ) from c2_branch_resolver_fixture f;
end
$$;

-- Retiring the catalogued Plan version stops new commitments after the retirement
-- boundary but does not erase the exact version already committed to Branch A.
update public.sellertray_plan_profile_versions v
set status='retired',effective_until='2026-10-10T00:00:00Z',retired_by_user_id=f.actor_user_id,
    retired_at=now(),retirement_reason='Retire resolver test Plan A after commitment'
from c2_branch_resolver_fixture f
where v.id=f.plan_a_version_id;

update c2_branch_resolver_fixture f
set a_oct15=public.resolve_sellertray_branch_entitlement(f.tenant_id,f.branch_a_id,'2026-10-15T00:00:00Z'),
    d_oct15=public.resolve_sellertray_branch_entitlement(f.tenant_id,f.branch_d_id,'2026-10-15T00:00:00Z'),
    summary_oct15=public.get_sellertray_business_branch_subscription_summary(f.tenant_id,'2026-10-15T00:00:00Z');

select extensions.ok((select a_oct15->>'effectiveStatus'='active' and a_oct15->>'planProfileCode'='c2_resolver_a' and a_oct15->>'runtimeCutoverActive'='false' from c2_branch_resolver_fixture),'Branch A resolves from its exact committed Plan Profile Version without activating C2 runtime cutover');
select extensions.ok((select (x->>'effectiveEnabled')::boolean from c2_branch_resolver_fixture f cross join lateral jsonb_array_elements(f.a_oct15->'features') x where x->>'code'='catalogue'),'Retiring a Plan Profile later does not erase an existing Branch term feature grant');
select extensions.ok((select not (x->>'configuredEnabled')::boolean and not (x->>'effectiveEnabled')::boolean and (x->>'overridden')::boolean from c2_branch_resolver_fixture f cross join lateral jsonb_array_elements(f.a_oct15->'features') x where x->>'code'='whatsapp_commerce'),'Business feature override wins over the Plan Profile grant');
select extensions.ok((select (x->>'configuredEnabled')::boolean and (x->>'effectiveEnabled')::boolean and (x->>'addonGranted')::boolean from c2_branch_resolver_fixture f cross join lateral jsonb_array_elements(f.a_oct15->'features') x where x->>'code'='ai_insights'),'Branch add-on contributes feature entitlement without changing another Branch');
select extensions.ok((select not (x->>'configuredEnabled')::boolean and (x->>'overridden')::boolean from c2_branch_resolver_fixture f cross join lateral jsonb_array_elements(f.a_oct15->'capabilities') x where x->>'code'='sales.return'),'Business capability override wins over the Plan Profile grant');
select extensions.ok((select (x->>'configuredEnabled')::boolean and (x->>'effectiveEnabled')::boolean and (x->>'addonGranted')::boolean from c2_branch_resolver_fixture f cross join lateral jsonb_array_elements(f.a_oct15->'capabilities') x where x->>'code'='reports.view'),'Branch add-on contributes capability entitlement through the shared resolver');
select extensions.ok((select (x->>'limitValue')::numeric=10 and x->>'usageState'='branch_meter_not_connected' and x->'usage'='null'::jsonb and x->'available'='null'::jsonb and not (x->>'enforcementReady')::boolean from c2_branch_resolver_fixture f cross join lateral jsonb_array_elements(f.a_oct15->'limits') x where x->>'code'='device_count'),'Finite Branch limit exposes governed configuration without fabricating usage or availability before a canonical Branch meter exists');
select extensions.ok((select (x->>'isUnlimited')::boolean and (x->>'enforcementReady')::boolean and x->>'usageState'='unlimited' from c2_branch_resolver_fixture f cross join lateral jsonb_array_elements(f.a_oct15->'limits') x where x->>'code'='staff_seats'),'Unlimited Branch limit is immediately resolvable without fabricated usage');
select extensions.ok((select d_oct15->>'resolutionMode'='legacy_compatibility_only' and d_oct15->>'subscriptionFound'='false' and jsonb_array_length(d_oct15->'features')=0 and (d_oct15->'legacyCompatibility'->>'canWrite')::boolean from c2_branch_resolver_fixture),'Legacy-only Branch exposes compatibility state but is not translated into speculative C2 entitlements');
select extensions.ok((select a_oct15->>'nextRenewalAt'='2027-03-15T00:00:00+00:00' and b_oct15->>'nextRenewalAt'='2026-10-20T00:00:00+00:00' from c2_branch_resolver_fixture),'Branches preserve independent renewal anniversaries');
select extensions.ok((select summary_oct15->>'isAggregateOnly'='true' and (summary_oct15->>'branchCount')::integer=3 and (summary_oct15->>'c2SubscriptionCount')::integer=2 and (summary_oct15->>'entitledBranchCount')::integer=2 and (summary_oct15->>'unprovisionedBranchCount')::integer=1 from c2_branch_resolver_fixture),'Business subscription view is aggregate-only across independent Branch states');
select extensions.ok((select summary_oct15->>'nearestRenewalAt'='2026-10-20T00:00:00+00:00' and not (summary_oct15 ? 'planProfileCode') from c2_branch_resolver_fixture),'Business aggregate shows the nearest Branch renewal without inventing one Business-wide plan');

-- Branch activity and lifecycle gates suppress effective entitlement without
-- deleting configured Plan/Add-on truth.
update public.branches b set is_active=false from c2_branch_resolver_fixture f where b.id=f.branch_a_id;
update c2_branch_resolver_fixture f set a_inactive=public.resolve_sellertray_branch_entitlement(f.tenant_id,f.branch_a_id,'2026-10-15T00:00:00Z');
select extensions.ok((select a_inactive->>'accessMode'='read_only' and (select (x->>'configuredEnabled')::boolean and not (x->>'effectiveEnabled')::boolean from jsonb_array_elements(a_inactive->'features') x where x->>'code'='catalogue') from c2_branch_resolver_fixture),'Inactive Branch becomes read-only while preserving configured entitlement history');
update public.branches b set is_active=true from c2_branch_resolver_fixture f where b.id=f.branch_a_id;

do $$
begin
  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.subscription_a_id,'suspended','2026-10-16T00:00:00Z',null,null,
    gen_random_uuid(),'Suspend resolver Branch A independently','system',f.actor_user_id
  ) from c2_branch_resolver_fixture f;
end
$$;
update c2_branch_resolver_fixture f
set a_suspended=public.resolve_sellertray_branch_entitlement(f.tenant_id,f.branch_a_id,'2026-10-17T00:00:00Z'),
    b_oct17=public.resolve_sellertray_branch_entitlement(f.tenant_id,f.branch_b_id,'2026-10-17T00:00:00Z');
select extensions.ok((select a_suspended->>'effectiveStatus'='suspended' and a_suspended->>'accessMode'='read_only' and (select (x->>'configuredEnabled')::boolean and not (x->>'effectiveEnabled')::boolean from jsonb_array_elements(a_suspended->'features') x where x->>'code'='catalogue') from c2_branch_resolver_fixture),'Suspension removes effective Branch entitlement without erasing configured Plan truth');
select extensions.ok((select b_oct17->>'effectiveStatus'='active' and b_oct17->>'accessMode'='full' from c2_branch_resolver_fixture),'Suspending Branch A does not suspend or alter Branch B');
select extensions.ok((select not ((a_oct15->'capabilities'->0) ? 'userAuthorized') from c2_branch_resolver_fixture),'Plan entitlement resolution does not silently replace separate user authorization truth');

select * from extensions.finish();
rollback;
