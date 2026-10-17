begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

create temp table sellertray_report_scope_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  customer_id uuid not null,
  branch_a uuid not null,
  branch_b uuid not null
) on commit drop;

insert into sellertray_report_scope_fixture
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'report-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_report_scope_fixture
union all
select staff_user_id,'report-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_report_scope_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Report Scope Test','sellertray-report-scope-'||substr(tenant_id::text,1,8),'RST','active'
from sellertray_report_scope_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_report_scope_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_report_scope_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_report_scope_fixture;

insert into public.tenant_member_capabilities(tenant_id,user_id,capability,allowed,granted_by)
select tenant_id,staff_user_id,'can_view_reports',true,owner_user_id
from sellertray_report_scope_fixture;

insert into public.branches(id,tenant_id,code,name,is_default,is_active)
select branch_a,tenant_id,'REPORT-A','Report Branch A',false,true from sellertray_report_scope_fixture
union all
select branch_b,tenant_id,'REPORT-B','Report Branch B',false,true from sellertray_report_scope_fixture;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_a,staff_user_id,true
from sellertray_report_scope_fixture;

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'2348000000999','Report Customer','2348000000999'
from sellertray_report_scope_fixture;

insert into public.orders(
  tenant_id,customer_id,branch_id,public_order_id,status,source,currency,total_amount,
  payment_status,amount_paid,fulfillment_status
)
select tenant_id,customer_id,branch_a,'RPT-A-'||substr(branch_a::text,1,8),'completed','pos','NGN',100,'paid',100,'collected'
from sellertray_report_scope_fixture
union all
select tenant_id,customer_id,branch_b,'RPT-B-'||substr(branch_b::text,1,8),'completed','pos','NGN',900,'paid',900,'collected'
from sellertray_report_scope_fixture;

select extensions.ok(
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_report_center' and p.prosecdef),
  'Report Center exists as a governed security-definer read model'
);
select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_report_center(uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_report_center(uuid,integer)','EXECUTE'),
  'Report Center is authenticated-only'
);
select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_report_summary(uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_report_summary(uuid,integer)','EXECUTE'),
  'legacy mobile report summary remains authenticated-only'
);
select extensions.ok(
  lower(pg_get_functiondef('public.sellertray_report_summary(uuid,integer)'::regprocedure)) like '%can_view_reports%'
  and lower(pg_get_functiondef('public.sellertray_report_summary(uuid,integer)'::regprocedure)) like '%sellertray_user_can_read_report_branch%',
  'mobile report summary uses capability authority and Branch read scope'
);
select extensions.ok(
  lower(pg_get_functiondef('public.sellertray_report_center(uuid,integer)'::regprocedure)) like '%can_view_reports%'
  and lower(pg_get_functiondef('public.sellertray_report_center(uuid,integer)'::regprocedure)) like '%sellertray_user_can_read_report_branch%',
  'Report Center uses capability authority and shared Branch read scope'
);
select extensions.ok(
  lower(pg_get_functiondef('public.sellertray_report_center(uuid,integer)'::regprocedure)) like '%sellertray_purchase_orders%'
  and lower(pg_get_functiondef('public.sellertray_report_center(uuid,integer)'::regprocedure)) like '%sellertray_supplier_payments%'
  and lower(pg_get_functiondef('public.sellertray_report_center(uuid,integer)'::regprocedure)) like '%supplier_state%',
  'procurement and supplier reporting are computed inside the same Branch-scoped read model'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_report_scope_fixture),true);

select extensions.ok(
  public.sellertray_user_can_read_report_branch(
    (select tenant_id from sellertray_report_scope_fixture),
    (select branch_a from sellertray_report_scope_fixture),
    (select staff_user_id from sellertray_report_scope_fixture)
  )
  and not public.sellertray_user_can_read_report_branch(
    (select tenant_id from sellertray_report_scope_fixture),
    (select branch_b from sellertray_report_scope_fixture),
    (select staff_user_id from sellertray_report_scope_fixture)
  ),
  'Staff report scope includes assigned Branch and excludes unassigned Branch'
);
select extensions.ok(
  not public.sellertray_user_can_read_report_branch(
    (select tenant_id from sellertray_report_scope_fixture),null,
    (select staff_user_id from sellertray_report_scope_fixture)
  ),
  'Staff report scope excludes unattributed legacy rows'
);
select extensions.is(
  (public.sellertray_report_summary((select tenant_id from sellertray_report_scope_fixture),30)#>>'{orders,total}')::int,
  1,
  'Staff mobile summary counts only readable Branch orders'
);
select extensions.is(
  (public.sellertray_report_summary((select tenant_id from sellertray_report_scope_fixture),30)#>>'{orders,orderValue}')::numeric,
  100::numeric,
  'Staff mobile summary excludes value from inaccessible Branches'
);
select extensions.is(
  jsonb_array_length(public.sellertray_report_center((select tenant_id from sellertray_report_scope_fixture),30)->'branchPerformance'),
  1,
  'Staff Report Center exposes only the assigned Branch row'
);
select extensions.is(
  public.sellertray_report_center((select tenant_id from sellertray_report_scope_fixture),30)#>>'{branchPerformance,0,branchId}',
  (select branch_a::text from sellertray_report_scope_fixture),
  'Staff Report Center does not substitute another Branch'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_report_scope_fixture),true);

select extensions.ok(
  public.sellertray_user_can_read_report_branch(
    (select tenant_id from sellertray_report_scope_fixture),null,
    (select owner_user_id from sellertray_report_scope_fixture)
  ),
  'management report scope preserves tenant-wide legacy history'
);
select extensions.is(
  (public.sellertray_report_summary((select tenant_id from sellertray_report_scope_fixture),30)#>>'{orders,total}')::int,
  2,
  'Owner mobile summary retains tenant-wide reporting'
);

select * from extensions.finish();
rollback;
