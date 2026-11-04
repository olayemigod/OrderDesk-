begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

select extensions.ok(
  position('sellertray-branch-subscription|' in lower(pg_get_functiondef('public.transition_sellertray_branch_subscription(uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,uuid)'::regprocedure))) > 0
  and position('for update;' in lower(pg_get_functiondef('public.transition_sellertray_branch_subscription(uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,uuid)'::regprocedure))) > 0
  and position('sellertray-branch-subscription|' in lower(pg_get_functiondef('public.transition_sellertray_branch_subscription(uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,uuid)'::regprocedure)))
      < position('for update;' in lower(pg_get_functiondef('public.transition_sellertray_branch_subscription(uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,uuid)'::regprocedure))),
  'Lifecycle transition acquires the Branch advisory lock before the subscription row lock'
);

create temp table c2_provisional_resume_fixture(
  tenant_id uuid not null,
  actor_user_id uuid not null,
  plan_id uuid not null,
  plan_version_id uuid not null,
  branch_id uuid,
  subscription_id uuid,
  resume_result jsonb,
  release_result jsonb
) on commit drop;

insert into c2_provisional_resume_fixture(tenant_id,actor_user_id,plan_id,plan_version_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_user_id,'c2-provisional-resume-'||substr(actor_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c2_provisional_resume_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C2 Provisional Resume Test','c2-prov-resume-'||substr(tenant_id::text,1,8),'C2P','active'
from c2_provisional_resume_fixture;

update c2_provisional_resume_fixture f
set branch_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.is_default limit 1);

insert into public.sellertray_plan_profiles(id,code,default_display_name,status,sort_order,created_by_user_id)
select plan_id,'c2_provisional_resume','C2 Provisional Resume','active',960,actor_user_id
from c2_provisional_resume_fixture;

insert into public.sellertray_plan_profile_versions(
  id,plan_profile_id,version,status,display_name,description,merchant_summary,
  allowed_billing_cycles,effective_from,change_reason,created_by_user_id,published_by_user_id,published_at
)
select plan_version_id,plan_id,1,'published','C2 Provisional Resume v1',
       'Published Plan Profile for provisional suspension and full-release tests.',
       'C2 provisional resume test plan.',array['monthly']::text[],
       '2026-01-01T00:00:00Z'::timestamptz,'Publish provisional resume test plan',
       actor_user_id,actor_user_id,'2026-01-01T00:00:00Z'::timestamptz
from c2_provisional_resume_fixture;

select set_config('request.jwt.claim.role','service_role',true);

update c2_provisional_resume_fixture f
set subscription_id=public.register_sellertray_branch_subscription_term(
  f.tenant_id,f.branch_id,f.plan_version_id,'monthly','2026-10-01T00:00:00Z',
  null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','provisional_suspend_resume'),
  gen_random_uuid(),'system',f.actor_user_id
);

do $$
begin
  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.subscription_id,'provisional','2026-10-01T00:00:00Z','2026-10-15T00:00:00Z','2026-11-01T00:00:00Z',
    gen_random_uuid(),'Start provisional entitlement','system',f.actor_user_id
  ) from c2_provisional_resume_fixture f;
end
$$;

select extensions.ok(
  (select lifecycle_status='provisional'
     and entitlement_period_end='2026-10-15T00:00:00Z'::timestamptz
     and expected_full_term_end='2026-11-01T00:00:00Z'::timestamptz
   from public.sellertray_branch_subscriptions s
   join c2_provisional_resume_fixture f on f.subscription_id=s.id),
  'Provisional activation records both provisional and governed full-term boundaries'
);

do $$
begin
  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.subscription_id,'suspended','2026-10-05T00:00:00Z',null,null,
    gen_random_uuid(),'Suspend provisional entitlement','system',f.actor_user_id
  ) from c2_provisional_resume_fixture f;
end
$$;

select extensions.is(
  (select lifecycle_status from public.sellertray_branch_subscriptions s join c2_provisional_resume_fixture f on f.subscription_id=s.id),
  'suspended'::text,
  'A provisional term may be suspended without rewriting its entitlement boundaries'
);

update c2_provisional_resume_fixture f
set resume_result=public.transition_sellertray_branch_subscription(
  f.tenant_id,f.subscription_id,'provisional','2026-10-07T00:00:00Z',null,null,
  gen_random_uuid(),'Resume provisional entitlement','system',f.actor_user_id
);

select extensions.ok(
  (select lifecycle_status='provisional'
     and entitlement_period_end='2026-10-15T00:00:00Z'::timestamptz
     and expected_full_term_end='2026-11-01T00:00:00Z'::timestamptz
   from public.sellertray_branch_subscriptions s
   join c2_provisional_resume_fixture f on f.subscription_id=s.id),
  'Resuming a provisionally suspended term preserves provisional state and the full-release boundary'
);

select extensions.is(
  public.sellertray_branch_subscription_effective_status(
    (select subscription_id from c2_provisional_resume_fixture),'2026-10-08T00:00:00Z'
  ),
  'provisional'::text,
  'Historical resolver reads a resumed provisional event as provisional, not fully active'
);

do $$
begin
  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.subscription_id,'suspended','2026-10-09T00:00:00Z',null,null,
    gen_random_uuid(),'Suspend provisional entitlement again','system',f.actor_user_id
  ) from c2_provisional_resume_fixture f;
end
$$;

update c2_provisional_resume_fixture f
set release_result=public.transition_sellertray_branch_subscription(
  f.tenant_id,f.subscription_id,'active','2026-10-10T00:00:00Z','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z',
  gen_random_uuid(),'Release full entitlement after settlement','system',f.actor_user_id
);

select extensions.ok(
  (select lifecycle_status='active'
     and entitlement_period_end='2026-11-01T00:00:00Z'::timestamptz
     and expected_full_term_end='2026-11-01T00:00:00Z'::timestamptz
   from public.sellertray_branch_subscriptions s
   join c2_provisional_resume_fixture f on f.subscription_id=s.id),
  'A suspended provisional term retains its governed path to full entitlement release'
);

select extensions.is(
  public.sellertray_branch_subscription_effective_status(
    (select subscription_id from c2_provisional_resume_fixture),'2026-10-11T00:00:00Z'
  ),
  'active'::text,
  'Historical resolver sees the later full release as active after provisional suspension'
);

select * from extensions.finish();
rollback;
