begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.ok(
  (select is_identity='YES' and is_nullable='NO'
   from information_schema.columns
   where table_schema='public'
     and table_name='sellertray_branch_subscription_events'
     and column_name='lifecycle_sequence'),
  'Branch Subscription lifecycle events have a monotonic insertion sequence'
);

select extensions.ok(
  position('lifecycle_sequence desc' in lower(pg_get_functiondef('public.sellertray_branch_subscription_effective_status(uuid,timestamptz)'::regprocedure)))>0,
  'As-of lifecycle resolution uses deterministic lifecycle sequence ordering for equal effective timestamps'
);

select extensions.ok(
  to_regprocedure('public.validate_sellertray_branch_subscription_entitlement_overlap()') is not null,
  'Database boundary exposes a final entitlement-range overlap guard'
);

select extensions.ok(
  position('sellertray-branch-subscription|' in lower(pg_get_functiondef('public.register_sellertray_branch_subscription_addon(uuid,uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,jsonb)'::regprocedure))) > 0
  and position('sellertray-branch-subscription|' in lower(pg_get_functiondef('public.register_sellertray_branch_subscription_addon(uuid,uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,jsonb)'::regprocedure)))
      < position('select s.* into strict v_subscription' in lower(pg_get_functiondef('public.register_sellertray_branch_subscription_addon(uuid,uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,jsonb)'::regprocedure))),
  'Add-on registration acquires Branch serialization before reading mutable subscription term state'
);

create temp table c2_review_fixture(
  tenant_id uuid not null,
  actor_user_id uuid not null,
  plan_id uuid not null,
  plan_version_id uuid not null,
  addon_id uuid not null,
  addon_version_id uuid not null,
  branch_a_id uuid,
  branch_b_id uuid,
  provisional_id uuid,
  later_id uuid,
  same_timestamp_id uuid,
  extension_overlap_rejected boolean not null default false,
  outside_addon_rejected boolean not null default false
) on commit drop;

insert into c2_review_fixture(
  tenant_id,actor_user_id,plan_id,plan_version_id,addon_id,addon_version_id
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_user_id,'c2-review-'||substr(actor_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c2_review_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C2 Review Hardening','c2-review-'||substr(tenant_id::text,1,8),'C2H','active'
from c2_review_fixture;

update c2_review_fixture f
set branch_a_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.is_default limit 1);

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'B','Review Branch B',false,true from c2_review_fixture;

update c2_review_fixture f
set branch_b_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.code='B');

insert into public.sellertray_plan_profiles(id,code,default_display_name,status,sort_order,created_by_user_id)
select plan_id,'c2_review_plan','C2 Review Plan','active',950,actor_user_id
from c2_review_fixture;

insert into public.sellertray_plan_profile_versions(
  id,plan_profile_id,version,status,display_name,description,merchant_summary,
  allowed_billing_cycles,effective_from,change_reason,created_by_user_id,published_by_user_id,published_at
)
select plan_version_id,plan_id,1,'published','C2 Review Plan v1',
       'Published Plan Profile for C2 Branch review hardening tests.',
       'C2 review hardening plan.',array['monthly','yearly']::text[],
       '2026-01-01T00:00:00Z'::timestamptz,'Publish review hardening plan',
       actor_user_id,actor_user_id,'2026-01-01T00:00:00Z'::timestamptz
from c2_review_fixture;

insert into public.sellertray_addon_definitions(id,code,default_display_name,status,sort_order,created_by_user_id)
select addon_id,'c2_review_addon','C2 Review Add-on','active',951,actor_user_id
from c2_review_fixture;

insert into public.sellertray_addon_versions(
  id,addon_definition_id,version,status,display_name,description,allowed_billing_cycles,
  effective_from,change_reason,created_by_user_id,published_by_user_id,published_at
)
select addon_version_id,addon_id,1,'published','C2 Review Add-on v1',
       'Published add-on for C2 Branch review hardening tests.',
       array['monthly','yearly','one_time']::text[],'2026-01-01T00:00:00Z'::timestamptz,
       'Publish review hardening add-on',actor_user_id,actor_user_id,'2026-01-01T00:00:00Z'::timestamptz
from c2_review_fixture;

select set_config('request.jwt.claim.role','service_role',true);

update c2_review_fixture f
set same_timestamp_id=public.register_sellertray_branch_subscription_term(
  f.tenant_id,f.branch_b_id,f.plan_version_id,'monthly','2026-10-05T00:00:00Z',
  null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','same_timestamp'),
  gen_random_uuid(),'system',f.actor_user_id
);

do $$
begin
  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.same_timestamp_id,'active','2026-10-05T00:00:00Z','2026-11-05T00:00:00Z','2026-11-05T00:00:00Z',
    gen_random_uuid(),'Activate at commitment timestamp','system',f.actor_user_id
  ) from c2_review_fixture f;
end
$$;

select extensions.is(
  public.sellertray_branch_subscription_effective_status(
    (select same_timestamp_id from c2_review_fixture),'2026-10-06T00:00:00Z'
  ),
  'active'::text,
  'Same-timestamp creation then activation resolves deterministically to active'
);

update c2_review_fixture f
set provisional_id=public.register_sellertray_branch_subscription_term(
      f.tenant_id,f.branch_a_id,f.plan_version_id,'monthly','2026-10-01T00:00:00Z',
      null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','provisional'),
      gen_random_uuid(),'system',f.actor_user_id
    ),
    later_id=public.register_sellertray_branch_subscription_term(
      f.tenant_id,f.branch_a_id,f.plan_version_id,'monthly','2026-10-10T00:00:00Z',
      null,null,null,false,null,null,null,'legacy_compatibility',jsonb_build_object('test','later'),
      gen_random_uuid(),'system',f.actor_user_id
    );

do $$
begin
  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.provisional_id,'provisional','2026-10-01T00:00:00Z','2026-10-15T00:00:00Z','2026-11-01T00:00:00Z',
    gen_random_uuid(),'Start short provisional term','system',f.actor_user_id
  ) from c2_review_fixture f;

  perform public.transition_sellertray_branch_subscription(
    f.tenant_id,f.later_id,'active','2026-10-20T00:00:00Z','2026-11-20T00:00:00Z','2026-11-20T00:00:00Z',
    gen_random_uuid(),'Activate later independent term','system',f.actor_user_id
  ) from c2_review_fixture f;
end
$$;

do $$
begin
  begin
    perform public.transition_sellertray_branch_subscription(
      f.tenant_id,f.provisional_id,'active','2026-10-10T00:00:00Z','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z',
      gen_random_uuid(),'Reject full-term overlap extension','system',f.actor_user_id
    ) from c2_review_fixture f;
  exception when sqlstate '23P01' then
    update c2_review_fixture set extension_overlap_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select extension_overlap_rejected from c2_review_fixture),
  'Provisional-to-full extension rechecks and rejects overlap with another Branch term'
);

select extensions.ok(
  (select lifecycle_status='provisional' and entitlement_period_end='2026-10-15T00:00:00Z'::timestamptz
   from public.sellertray_branch_subscriptions s
   join c2_review_fixture f on f.provisional_id=s.id),
  'Rejected full-term extension leaves the provisional Branch term unchanged'
);

do $$
begin
  begin
    perform public.register_sellertray_branch_subscription_addon(
      f.tenant_id,f.later_id,f.addon_version_id,'monthly',
      '2026-10-20T00:00:00Z','2026-12-01T00:00:00Z',
      null,null,gen_random_uuid(),f.actor_user_id,jsonb_build_object('test','post_lock_term_validation')
    ) from c2_review_fixture f;
  exception when sqlstate '23514' then
    update c2_review_fixture set outside_addon_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select outside_addon_rejected from c2_review_fixture),
  'Add-on registration rejects a window outside the post-lock current Branch Subscription term'
);

select extensions.is(
  (select count(*)::integer
   from public.sellertray_branch_subscription_addons a
   join c2_review_fixture f on f.later_id=a.branch_subscription_id),
  0,
  'Rejected out-of-term add-on leaves no entitlement assignment evidence'
);

select * from extensions.finish();
rollback;
