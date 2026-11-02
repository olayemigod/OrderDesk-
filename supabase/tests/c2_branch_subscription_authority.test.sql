begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(25);

select extensions.ok(to_regclass('public.sellertray_branch_subscriptions') is not null,'C2-4 creates Branch Subscription authority');
select extensions.ok(to_regclass('public.sellertray_branch_subscription_events') is not null,'C2-4 creates append-only Branch Subscription lifecycle evidence');
select extensions.ok(to_regclass('public.sellertray_branch_subscription_addons') is not null,'C2-4 creates Branch Subscription add-on assignment evidence');
select extensions.ok((select relrowsecurity from pg_class where oid='public.sellertray_branch_subscriptions'::regclass),'Branch Subscription rows are protected by RLS');
select extensions.ok(not has_table_privilege('authenticated','public.sellertray_branch_subscriptions','SELECT'),'Merchant clients cannot directly read Branch Subscription master rows');
select extensions.ok(has_table_privilege('service_role','public.sellertray_branch_subscriptions','SELECT'),'Server authority can inspect Branch Subscription rows');
select extensions.ok(not has_function_privilege('authenticated','public.register_sellertray_branch_subscription_term(uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid,boolean,uuid,uuid,uuid,text,jsonb,uuid,text,uuid)','EXECUTE'),'Merchant clients cannot create Branch Subscription truth directly');
select extensions.ok(has_function_privilege('service_role','public.register_sellertray_branch_subscription_term(uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid,boolean,uuid,uuid,uuid,text,jsonb,uuid,text,uuid)','EXECUTE'),'Branch Subscription creation is available to server authority');
select extensions.is((select count(*)::integer from public.sellertray_limit_definitions where code='branch_count'),0,'Branch count remains excluded from Plan Profile limits');
select extensions.ok((select count(*)=0 from information_schema.columns where table_schema='public' and table_name='tenant_subscriptions' and column_name='branch_id'),'tenant_subscriptions remains Business-scoped compatibility authority');
select extensions.ok(position('line_type<>''branch_subscription''' in replace(pg_get_functiondef('public.register_sellertray_branch_subscription_term(uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid,boolean,uuid,uuid,uuid,text,jsonb,uuid,text,uuid)'::regprocedure),' ',''))>0,'Native C2 registration requires the future C2-6 Branch-bound subscription line');
select extensions.ok(position('same Branch Subscription Branch' in pg_get_functiondef('public.validate_sellertray_branch_subscription_evidence()'::regprocedure))>0 and position('required version' in pg_get_functiondef('public.validate_sellertray_branch_subscription_evidence()'::regprocedure))>0,'Evidence validation checks Branch and required Master version semantics, not only tenant ownership');

create temp table c2_branch_subscription_fixture(
  tenant_id uuid not null,
  actor_user_id uuid not null,
  plan_a_id uuid not null,
  plan_a_version_id uuid not null,
  plan_b_id uuid not null,
  plan_b_version_id uuid not null,
  branch_a_id uuid,
  branch_b_id uuid,
  branch_c_id uuid,
  addon_definition_id uuid not null,
  addon_version_id uuid not null,
  subscription_a_id uuid,
  subscription_b_id uuid,
  subscription_c_id uuid,
  renewal_a_id uuid,
  create_a_command uuid not null,
  activate_a_command uuid not null,
  activate_retry jsonb,
  legacy_before jsonb,
  native_registration_rejected boolean not null default false,
  overlap_rejected boolean not null default false,
  outside_addon_rejected boolean not null default false,
  cross_command_rejected boolean not null default false
) on commit drop;

insert into c2_branch_subscription_fixture(
  tenant_id,actor_user_id,plan_a_id,plan_a_version_id,plan_b_id,plan_b_version_id,
  addon_definition_id,addon_version_id,create_a_command,activate_a_command
)
values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_user_id,'c2-branch-subscription-'||substr(actor_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c2_branch_subscription_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C2 Branch Subscription Test','c2-branch-sub-'||substr(tenant_id::text,1,8),'C2B','active'
from c2_branch_subscription_fixture;

insert into public.tenant_subscriptions(
  tenant_id,plan_code,status,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at
)
select tenant_id,'business','active','2026-01-01T00:00:00Z','2026-12-31T00:00:00Z',false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
from c2_branch_subscription_fixture
on conflict (tenant_id) do update set
  plan_code=excluded.plan_code,
  status=excluded.status,
  trial_started_at=null,
  trial_ends_at=null,
  current_period_start=excluded.current_period_start,
  current_period_end=excluded.current_period_end,
  grace_ends_at=null,
  cancel_at_period_end=false,
  updated_at=excluded.updated_at;

update c2_branch_subscription_fixture f
set legacy_before=(select to_jsonb(s) from public.tenant_subscriptions s where s.tenant_id=f.tenant_id),
    branch_a_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.is_default limit 1);

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'B','Branch B',false,true from c2_branch_subscription_fixture
union all
select tenant_id,'C','Branch C',false,true from c2_branch_subscription_fixture;

update c2_branch_subscription_fixture f
set branch_b_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.code='B'),
    branch_c_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.code='C');

insert into public.sellertray_plan_profiles(id,code,default_display_name,status,sort_order,created_by_user_id)
select plan_a_id,'c2_authority_a','C2 Authority A','active',901,actor_user_id from c2_branch_subscription_fixture
union all
select plan_b_id,'c2_authority_b','C2 Authority B','active',902,actor_user_id from c2_branch_subscription_fixture;

insert into public.sellertray_plan_profile_versions(
  id,plan_profile_id,version,status,display_name,description,merchant_summary,
  allowed_billing_cycles,effective_from,change_reason,created_by_user_id,published_by_user_id,published_at
)
select plan_a_version_id,plan_a_id,1,'published','C2 Authority A v1',
       'Published test Plan Profile A for Branch Subscription authority coverage.',
       'Test Plan Profile A.',array['monthly','yearly']::text[],'2026-01-01T00:00:00Z',
       'Publish C2 authority test plan A',actor_user_id,actor_user_id,'2026-01-01T00:00:00Z'
from c2_branch_subscription_fixture
union all
select plan_b_version_id,plan_b_id,1,'published','C2 Authority B v1',
       'Published test Plan Profile B for Branch Subscription authority coverage.',
       'Test Plan Profile B.',array['monthly','yearly']::text[],'2026-01-01T00:00:00Z',
       'Publish C2 authority test plan B',actor_user_id,actor_user_id,'2026-01-01T00:00:00Z'
from c2_branch_subscription_fixture;

insert into public.sellertray_addon_definitions(id,code,default_display_name,status,sort_order,created_by_user_id)
select addon_definition_id,'c2_authority_addon','C2 Authority Add-on','active',903,actor_user_id
from c2_branch_subscription_fixture;

insert into public.sellertray_addon_versions(
  id,addon_definition_id,version,status,display_name,description,allowed_billing_cycles,
  effective_from,change_reason,created_by_user_id,published_by_user_id,published_at
)
select addon_version_id,addon_definition_id,1,'published','C2 Authority Add-on v1',
       'Published test add-on for Branch Subscription authority coverage.',
       array['monthly','yearly','one_time']::text[],'2026-01-01T00:00:00Z',
       'Publish C2 authority test add-on',actor_user_id,actor_user_id,'2026-01-01T00:00:00Z'
from c2_branch_subscription_fixture;

select set_config('request.jwt.claim.role','service_role',true);

update c2_branch_subscription_fixture f
set subscription_a_id=public.register_sellertray_branch_subscription_term(
      f.tenant_id,f.branch_a_id,f.plan_a_version_id,'yearly','2026-03-15T00:00:00Z',
      null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','branch_a'),
      f.create_a_command,'system',f.actor_user_id
    ),
    subscription_b_id=public.register_sellertray_branch_subscription_term(
      f.tenant_id,f.branch_b_id,f.plan_b_version_id,'monthly','2026-09-10T00:00:00Z',
      null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','branch_b'),
      gen_random_uuid(),'system',f.actor_user_id
    ),
    subscription_c_id=public.register_sellertray_branch_subscription_term(
      f.tenant_id,f.branch_c_id,f.plan_b_version_id,'monthly','2026-10-01T00:00:00Z',
      null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','branch_c'),
      gen_random_uuid(),'system',f.actor_user_id
    );

select extensions.is(
  public.register_sellertray_branch_subscription_term(
    f.tenant_id,f.branch_a_id,f.plan_a_version_id,'yearly','2026-03-15T00:00:00Z',
    null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','branch_a'),
    f.create_a_command,'system',f.actor_user_id
  ),f.subscription_a_id,
  'Exact Branch Subscription creation retry returns the original term'
)
from c2_branch_subscription_fixture f;

do $$
begin
  begin
    perform public.register_sellertray_branch_subscription_term(
      f.tenant_id,f.branch_b_id,f.plan_b_version_id,'monthly','2026-09-10T00:00:00Z',
      null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','wrong-command'),
      f.create_a_command,'system',f.actor_user_id
    ) from c2_branch_subscription_fixture f;
  exception when sqlstate '23505' then
    update c2_branch_subscription_fixture set cross_command_rejected=true;
  end;
end
$$;

select extensions.ok((select cross_command_rejected from c2_branch_subscription_fixture),'One Branch Subscription creation command cannot be reused for different facts');

do $$
begin
  begin
    perform public.register_sellertray_branch_subscription_term(
      f.tenant_id,f.branch_b_id,f.plan_b_version_id,'monthly','2026-09-10T00:00:00Z',
      null,null,null,false,null,null,null,'commercial_order',jsonb_build_object('test','native-before-c2-6'),
      gen_random_uuid(),'system',f.actor_user_id
    ) from c2_branch_subscription_fixture f;
  exception when sqlstate '23514' then
    update c2_branch_subscription_fixture set native_registration_rejected=true;
  end;
end
$$;

select extensions.ok((select native_registration_rejected from c2_branch_subscription_fixture),'Native Branch Subscription registration fails closed before C2-6 supplies a Branch-bound commercial order line');

do $$
begin
  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.subscription_a_id,'active','2026-03-15T00:00:00Z','2027-03-15T00:00:00Z','2027-03-15T00:00:00Z',
    f.activate_a_command,'Activate independent Branch A term','system',f.actor_user_id
  ) from c2_branch_subscription_fixture f;
end
$$;

update c2_branch_subscription_fixture f
set activate_retry=public.transition_sellertray_branch_subscription(
  f.tenant_id,f.subscription_a_id,'active','2026-03-15T00:00:00Z','2027-03-15T00:00:00Z','2027-03-15T00:00:00Z',
  f.activate_a_command,'Activate independent Branch A term','system',f.actor_user_id
);

select extensions.ok((select lifecycle_status='active' and entitlement_period_end='2027-03-15T00:00:00Z'::timestamptz from public.sellertray_branch_subscriptions s join c2_branch_subscription_fixture f on f.subscription_a_id=s.id),'Branch A activates on its own annual term');
select extensions.ok(coalesce((select (activate_retry->>'alreadyApplied')::boolean from c2_branch_subscription_fixture),false),'Exact Branch lifecycle transition retry is idempotent');
select extensions.ok((select lifecycle_status='pending' from public.sellertray_branch_subscriptions s join c2_branch_subscription_fixture f on f.subscription_b_id=s.id),'Branch B remains pending while Branch A activates');
select extensions.ok((select count(*)=2 from public.sellertray_branch_subscriptions s join c2_branch_subscription_fixture f on f.tenant_id=s.tenant_id where (s.branch_id=f.branch_a_id and s.billing_cycle='yearly') or (s.branch_id=f.branch_b_id and s.billing_cycle='monthly')),'One Business may have Branches on independent billing cycles');

update c2_branch_subscription_fixture f
set renewal_a_id=public.register_sellertray_branch_subscription_term(
  f.tenant_id,f.branch_a_id,f.plan_b_version_id,'monthly','2026-10-15T00:00:00Z',
  null,null,null,false,null,null,f.subscription_a_id,'legacy_compatibility',jsonb_build_object('test','branch_a_renewal'),
  gen_random_uuid(),'system',f.actor_user_id
);

do $$
begin
  begin
    perform public.transition_sellertray_branch_subscription(
      f.tenant_id,f.renewal_a_id,'active','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z','2026-12-01T00:00:00Z',
      gen_random_uuid(),'Reject overlapping Branch A renewal','system',f.actor_user_id
    ) from c2_branch_subscription_fixture f;
  exception when sqlstate '23P01' then
    update c2_branch_subscription_fixture set overlap_rejected=true;
  end;
end
$$;

select extensions.ok((select overlap_rejected from c2_branch_subscription_fixture),'A second entitlement term cannot overlap the active term for the same Branch');

do $$
begin
  perform public.register_sellertray_branch_subscription_addon(
    f.tenant_id,f.subscription_c_id,f.addon_version_id,'monthly','2026-10-01T00:00:00Z','2026-12-01T00:00:00Z',
    null,null,gen_random_uuid(),f.actor_user_id,jsonb_build_object('test','outside-term')
  ) from c2_branch_subscription_fixture f;
end
$$;

do $$
begin
  begin
    perform public.transition_sellertray_branch_subscription(
      f.tenant_id,f.subscription_c_id,'active','2026-10-15T00:00:00Z','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z',
      gen_random_uuid(),'Reject add-on outside Branch term','system',f.actor_user_id
    ) from c2_branch_subscription_fixture f;
  exception when sqlstate '23514' then
    update c2_branch_subscription_fixture set outside_addon_rejected=true;
  end;
end
$$;

select extensions.ok((select outside_addon_rejected from c2_branch_subscription_fixture),'A pre-registered add-on cannot activate outside the eventual Branch Subscription term');
select extensions.ok((select lifecycle_status='pending' from public.sellertray_branch_subscriptions s join c2_branch_subscription_fixture f on f.subscription_c_id=s.id),'Failed add-on term validation leaves Branch C pending');
select extensions.ok((select legacy_before=(select to_jsonb(s) from public.tenant_subscriptions s where s.tenant_id=f.tenant_id) from c2_branch_subscription_fixture f),'C2-4 Branch lifecycle operations do not mutate tenant_subscriptions');
select extensions.ok(position('requestedEntitlementPeriodEnd' in pg_get_functiondef('public.transition_sellertray_branch_subscription(uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,uuid)'::regprocedure))>0,'Lifecycle idempotency compares requested transition facts separately from derived event snapshots');
select extensions.ok(position('entitlementPeriodEnd' in pg_get_functiondef('public.sellertray_branch_subscription_effective_status(uuid,timestamptz)'::regprocedure))>0,'As-of lifecycle state uses the period window snapshotted on lifecycle events');

select * from extensions.finish();
rollback;
