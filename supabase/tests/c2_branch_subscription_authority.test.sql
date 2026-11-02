begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(24);

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
select extensions.ok(position("line_type<>'branch_subscription'" in replace(pg_get_functiondef('public.register_sellertray_branch_subscription_term(uuid,uuid,uuid,text,timestamptz,uuid,uuid,uuid,boolean,uuid,uuid,uuid,text,jsonb,uuid,text,uuid)'::regprocedure),' ',''))>0,'Native C2 registration requires the future C2-6 Branch-bound subscription line');
select extensions.ok(position('same Branch Subscription Branch' in pg_get_functiondef('public.validate_sellertray_branch_subscription_evidence()'::regprocedure))>0 and position('required version' in pg_get_functiondef('public.validate_sellertray_branch_subscription_evidence()'::regprocedure))>0,'Evidence validation checks Branch and required Master version semantics, not only tenant ownership');

create temp table c2_branch_subscription_fixture(
  tenant_id uuid not null,
  actor_user_id uuid not null,
  plan_a_id uuid,
  plan_a_version_id uuid,
  plan_b_id uuid,
  plan_b_version_id uuid,
  branch_a_id uuid,
  branch_b_id uuid,
  branch_c_id uuid,
  addon_definition_id uuid,
  addon_version_id uuid,
  subscription_a_id uuid,
  subscription_b_id uuid,
  subscription_c_id uuid,
  renewal_a_id uuid,
  create_a_command uuid not null,
  activate_a_command uuid not null,
  legacy_before jsonb,
  native_registration_rejected boolean not null default false,
  overlap_rejected boolean not null default false,
  outside_addon_rejected boolean not null default false,
  cross_command_rejected boolean not null default false
) on commit drop;

insert into c2_branch_subscription_fixture(tenant_id,actor_user_id,create_a_command,activate_a_command)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_user_id,'c2-branch-subscription-'||substr(actor_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c2_branch_subscription_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C2 Branch Subscription Test','c2-branch-sub-'||substr(tenant_id::text,1,8),'C2B','active'
from c2_branch_subscription_fixture;

update public.tenant_subscriptions s
set plan_code='business',status='active',trial_started_at=null,trial_ends_at=null,
    current_period_start='2026-01-01T00:00:00Z',current_period_end='2026-12-31T00:00:00Z',
    grace_ends_at=null,cancel_at_period_end=false,updated_at='2026-01-01T00:00:00Z'
from c2_branch_subscription_fixture f
where s.tenant_id=f.tenant_id;

update c2_branch_subscription_fixture f
set legacy_before=(select to_jsonb(s) from public.tenant_subscriptions s where s.tenant_id=f.tenant_id);

update c2_branch_subscription_fixture f
set branch_a_id=(select b.id from public.branches b where b.tenant_id=f.tenant_id and b.is_default limit 1);

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'B','Branch B',false,true from c2_branch_subscription_fixture
returning id into strict _unused;
