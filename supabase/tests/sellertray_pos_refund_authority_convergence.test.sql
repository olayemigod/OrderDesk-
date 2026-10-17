begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

create temp table sellertray_refund_authority_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  branch_id uuid
) on commit drop;

insert into sellertray_refund_authority_fixture(tenant_id,owner_user_id,manager_user_id,staff_user_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'refund-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_refund_authority_fixture
union all
select manager_user_id,'refund-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_refund_authority_fixture
union all
select staff_user_id,'refund-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_refund_authority_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Refund Authority Test',
  'sellertray-refund-authority-'||substr(tenant_id::text,1,8),'RAT','active'
from sellertray_refund_authority_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_refund_authority_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_refund_authority_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_refund_authority_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_refund_authority_fixture;

update sellertray_refund_authority_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

select extensions.ok(
  exists(
    select 1
    from pg_constraint c
    join pg_class r on r.oid=c.conrelid
    join pg_namespace n on n.oid=r.relnamespace
    where n.nspname='public' and r.relname='tenant_member_capabilities'
      and c.conname='tenant_member_capabilities_capability_check'
      and lower(pg_get_constraintdef(c.oid)) like '%can_refund_sale%'
  ),
  'member capability vocabulary includes refund authority'
);

select extensions.ok(
  exists(
    select 1
    from pg_constraint c
    join pg_class r on r.oid=c.conrelid
    join pg_namespace n on n.oid=r.relnamespace
    where n.nspname='public' and r.relname='tenant_member_capability_events'
      and c.conname='tenant_member_capability_events_capability_check'
      and lower(pg_get_constraintdef(c.oid)) like '%can_refund_sale%'
  ),
  'capability audit vocabulary includes refund authority'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_user_has_capability'
      and lower(pg_get_functiondef(p.oid)) like '%can_refund_sale%'
  ),
  'effective capability helper recognizes refund authority'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_sellertray_member_capability'
      and lower(pg_get_functiondef(p.oid)) like '%can_refund_sale%'
      and lower(pg_get_functiondef(p.oid)) like '%tenant_member_capability_events%'
  ),
  'audited capability command can manage refund authority'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_team_access_matrix'
      and lower(pg_get_functiondef(p.oid)) like '%can_refund_sale%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_payments%'
      and lower(pg_get_functiondef(p.oid)) like '%can_view_reports%'
  ),
  'Team access matrix exposes the current governed capability vocabulary'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_pos_return_authority'
      and p.prosecdef=true
  )
  and has_function_privilege('authenticated','public.get_sellertray_pos_return_authority(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_pos_return_authority(uuid,uuid)','EXECUTE'),
  'authenticated mobile sessions have a governed refund-authority reader'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='enforce_sellertray_sale_return_authority'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%can_refund_sale%'
  ),
  'immutable sale-return insertion requires both Branch operation and refund capability'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='return_sellertray_pos_cash_sale'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%can_refund_sale%'
      and lower(pg_get_functiondef(p.oid)) like '%apply_sellertray_pos_cash_return_internal%'
  ),
  'public server return command rechecks Branch and refund authority before every apply or replay'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='apply_sellertray_pos_cash_return_internal'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%can_refund_sale%'
  ),
  'private return implementation also fails closed on Branch and refund authority'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_refund_authority_fixture),
    (select owner_user_id from sellertray_refund_authority_fixture),
    'can_refund_sale'
  ),
  'Owner retains refund authority by default'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_refund_authority_fixture),
    (select manager_user_id from sellertray_refund_authority_fixture),
    'can_refund_sale'
  ),
  'Manager retains refund authority by default'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_refund_authority_fixture),
    (select staff_user_id from sellertray_refund_authority_fixture),
    'can_refund_sale'
  ),
  'Staff does not receive refund authority by default'
);

select public.set_sellertray_member_capability(
  (select tenant_id from sellertray_refund_authority_fixture),
  (select staff_user_id from sellertray_refund_authority_fixture),
  'can_refund_sale',true,
  (select owner_user_id from sellertray_refund_authority_fixture)
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_refund_authority_fixture),
    (select staff_user_id from sellertray_refund_authority_fixture),
    'can_refund_sale'
  ),
  'Staff refund authority can be explicitly delegated through the audited capability command'
);

select set_config(
  'request.jwt.claim.sub',
  (select staff_user_id::text from sellertray_refund_authority_fixture),
  true
);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.ok(
  public.get_sellertray_pos_return_authority(
    (select tenant_id from sellertray_refund_authority_fixture),
    (select branch_id from sellertray_refund_authority_fixture)
  ),
  'delegated Staff refund authority is usable on the permitted active default Branch'
);

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_user_id,false
from sellertray_refund_authority_fixture;

select extensions.ok(
  not public.get_sellertray_pos_return_authority(
    (select tenant_id from sellertray_refund_authority_fixture),
    (select branch_id from sellertray_refund_authority_fixture)
  ),
  'refund authority fails closed when Branch operating access is denied'
);

select public.set_sellertray_member_capability(
  (select tenant_id from sellertray_refund_authority_fixture),
  (select staff_user_id from sellertray_refund_authority_fixture),
  'can_refund_sale',false,
  (select owner_user_id from sellertray_refund_authority_fixture)
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_refund_authority_fixture),
    (select staff_user_id from sellertray_refund_authority_fixture),
    'can_refund_sale'
  ),
  'explicit refund-capability revocation takes effect immediately'
);

select * from extensions.finish();
rollback;
