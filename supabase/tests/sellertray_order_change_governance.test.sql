begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

create temp table sellertray_order_change_governance_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  default_branch_id uuid,
  secondary_branch_id uuid not null
) on commit drop;

insert into sellertray_order_change_governance_fixture(
  tenant_id,owner_user_id,manager_user_id,staff_user_id,secondary_branch_id
)
values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'order-change-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_order_change_governance_fixture
union all
select manager_user_id,
  'order-change-manager-'||substr(manager_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_order_change_governance_fixture
union all
select staff_user_id,
  'order-change-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_order_change_governance_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,
  'SellerTray Order Change Governance Test',
  'sellertray-order-change-'||substr(tenant_id::text,1,8),
  'OCG',
  'active'
from sellertray_order_change_governance_fixture;

update sellertray_order_change_governance_fixture f
set default_branch_id=(
  select b.id
  from public.branches b
  where b.tenant_id=f.tenant_id
    and b.is_default=true
  limit 1
);

insert into public.branches(id,tenant_id,code,name,is_default,is_active)
select secondary_branch_id,tenant_id,'SECONDARY','Secondary Branch',false,true
from sellertray_order_change_governance_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_order_change_governance_fixture
union all
select tenant_id,manager_user_id,'manager'
from sellertray_order_change_governance_fixture
union all
select tenant_id,staff_user_id,'staff'
from sellertray_order_change_governance_fixture;

select extensions.ok(
  to_regprocedure(
    'public.resolve_sellertray_customer_order_change(uuid,uuid,text)'
  ) is not null,
  'governed customer order-change resolver exists'
);

select extensions.ok(
  to_regprocedure(
    'public.sellertray_user_can_operate_branch(uuid,uuid,uuid)'
  ) is not null,
  'shared SellerTray branch-operation authority exists'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.resolve_sellertray_customer_order_change(uuid,uuid,text)',
    'EXECUTE'
  ),
  'service role can execute the governed resolver'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.resolve_sellertray_customer_order_change(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute the governed resolver'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_sellertray_customer_order_change(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the order-change Edge Function'
);

select extensions.ok(
  position(
    'sellertray_user_can_operate_branch' in
    pg_get_functiondef(
      'public.resolve_sellertray_customer_order_change(uuid,uuid,text)'::regprocedure
    )
  )>0,
  'resolver reuses the shared branch-operation authority'
);

select extensions.ok(
  position(
    'sellertray_user_can_access_branch' in
    pg_get_functiondef(
      'public.resolve_sellertray_customer_order_change(uuid,uuid,text)'::regprocedure
    )
  )=0,
  'resolver does not reference the obsolete branch helper name'
);

select extensions.ok(
  position(
    'v_request.status not in (''pending'',''reviewed'')' in
    pg_get_functiondef(
      'public.resolve_sellertray_customer_order_change(uuid,uuid,text)'::regprocedure
    )
  )>0,
  'resolver retains its handled-request retry guard'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select owner_user_id from sellertray_order_change_governance_fixture),
    'can_manage_orders'
  ),
  'Owner has order-management authority'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select manager_user_id from sellertray_order_change_governance_fixture),
    'can_manage_orders'
  ),
  'Manager has order-management authority by default'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select staff_user_id from sellertray_order_change_governance_fixture),
    'can_manage_orders'
  ),
  'Staff does not receive order-management authority by default'
);

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select staff_user_id from sellertray_order_change_governance_fixture),
    'can_manage_orders',true,
    (select owner_user_id from sellertray_order_change_governance_fixture)
  ),
  'Owner can explicitly grant Staff order-management authority'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select staff_user_id from sellertray_order_change_governance_fixture),
    'can_manage_orders'
  ),
  'explicit Staff order-management grant becomes effective'
);

select extensions.is(
  (
    select count(*)::integer
    from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_order_change_governance_fixture)
      and e.user_id=(select staff_user_id from sellertray_order_change_governance_fixture)
      and e.capability='can_manage_orders'
      and e.previous_allowed=false
      and e.new_allowed=true
  ),
  1,
  'order-management permission grant is audit recorded'
);

select extensions.ok(
  public.sellertray_user_can_operate_branch(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select default_branch_id from sellertray_order_change_governance_fixture),
    (select staff_user_id from sellertray_order_change_governance_fixture)
  ),
  'Staff without explicit assignments can operate the active default Branch'
);

select extensions.ok(
  not public.sellertray_user_can_operate_branch(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select secondary_branch_id from sellertray_order_change_governance_fixture),
    (select staff_user_id from sellertray_order_change_governance_fixture)
  ),
  'Staff without explicit assignments cannot operate another Branch'
);

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,secondary_branch_id,staff_user_id,true
from sellertray_order_change_governance_fixture;

select extensions.ok(
  not public.sellertray_user_can_operate_branch(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select default_branch_id from sellertray_order_change_governance_fixture),
    (select staff_user_id from sellertray_order_change_governance_fixture)
  ),
  'explicit Branch assignment replaces Staff default-Branch fallback'
);

select extensions.ok(
  public.sellertray_user_can_operate_branch(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select secondary_branch_id from sellertray_order_change_governance_fixture),
    (select staff_user_id from sellertray_order_change_governance_fixture)
  ),
  'Staff can operate an explicitly allowed Branch'
);

select extensions.ok(
  not public.set_sellertray_member_capability(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select staff_user_id from sellertray_order_change_governance_fixture),
    'can_manage_orders',false,
    (select owner_user_id from sellertray_order_change_governance_fixture)
  ),
  'Owner can explicitly revoke Staff order-management authority'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_order_change_governance_fixture),
    (select staff_user_id from sellertray_order_change_governance_fixture),
    'can_manage_orders'
  ),
  'revoked Staff order-management authority is denied'
);

select * from extensions.finish();
rollback;
