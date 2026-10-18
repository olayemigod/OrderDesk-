begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(28);

select extensions.ok(
  (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_purchase_orders_management_list(uuid,uuid,text,text,integer,integer)'))
  and (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_purchase_order_management_detail(uuid,uuid)'))
  and (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_suppliers_management_list(uuid,text,text,integer,integer)'))
  and (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_supplier_management_detail(uuid,uuid)')),
  'Purchasing management reads are stable SECURITY DEFINER functions'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_purchase_orders_management_list(uuid,uuid,text,text,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_purchase_order_management_detail(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_suppliers_management_list(uuid,text,text,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_supplier_management_detail(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_purchase_orders_management_list(uuid,uuid,text,text,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_purchase_order_management_detail(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_suppliers_management_list(uuid,text,text,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_supplier_management_detail(uuid,uuid)','EXECUTE'),
  'Purchasing management reads are authenticated-only'
);

create temp table sellertray_purchasing_management_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  branch_id uuid,
  other_branch_id uuid,
  foreign_branch_id uuid,
  supplier_id uuid not null,
  inactive_supplier_id uuid not null,
  foreign_supplier_id uuid not null,
  ordered_po_id uuid,
  foreign_po_id uuid,
  list_result jsonb,
  page_result jsonb,
  all_branches_result jsonb,
  supplier_result jsonb,
  supplier_page_result jsonb,
  supplier_detail jsonb,
  po_detail jsonb
) on commit drop;

insert into sellertray_purchasing_management_fixture(
  tenant_id,other_tenant_id,owner_user_id,manager_user_id,staff_user_id,supplier_id,inactive_supplier_id,foreign_supplier_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'purchasing-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_purchasing_management_fixture
union all
select manager_user_id,'purchasing-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_purchasing_management_fixture
union all
select staff_user_id,'purchasing-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_purchasing_management_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Purchasing Management Test','sellertray-purchasing-management-'||substr(tenant_id::text,1,8),'PMR','active' from sellertray_purchasing_management_fixture
union all
select other_tenant_id,'SellerTray Other Purchasing Test','sellertray-other-purchasing-'||substr(other_tenant_id::text,1,8),'PMX','active' from sellertray_purchasing_management_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (
  select tenant_id from sellertray_purchasing_management_fixture
  union all select other_tenant_id from sellertray_purchasing_management_fixture
);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_purchasing_management_fixture
union all select tenant_id,manager_user_id,'manager' from sellertray_purchasing_management_fixture
union all select tenant_id,staff_user_id,'staff' from sellertray_purchasing_management_fixture;

update sellertray_purchasing_management_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_purchasing_management_fixture f
set foreign_branch_id=b.id
from public.branches b
where b.tenant_id=f.other_tenant_id and b.is_default=true;

with inserted as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'ALT','Alternate Branch',false,true from sellertray_purchasing_management_fixture
  returning id
)
update sellertray_purchasing_management_fixture
set other_branch_id=(select id from inserted);

insert into public.sellertray_suppliers(id,tenant_id,name,contact_name,phone,email,is_active)
select supplier_id,tenant_id,'Alpha Supplies','Ada Buyer','08010000001','alpha@example.com',true from sellertray_purchasing_management_fixture
union all
select inactive_supplier_id,tenant_id,'Beta Wholesale','Bola Contact','08010000002','beta@example.com',false from sellertray_purchasing_management_fixture
union all
select foreign_supplier_id,other_tenant_id,'Foreign Supplier','Foreign Contact','08010000003','foreign@example.com',true from sellertray_purchasing_management_fixture;

insert into public.sellertray_purchase_orders(tenant_id,branch_id,supplier_id,reference,status,currency,total_amount,created_at,ordered_at,received_at)
select tenant_id,branch_id,supplier_id,'PMR-DRAFT','draft','NGN',50,now()-interval '7 days',null,null from sellertray_purchasing_management_fixture
union all
select tenant_id,branch_id,supplier_id,'PMR-ORDERED','ordered','NGN',100,now()-interval '6 days',now()-interval '6 days',null from sellertray_purchasing_management_fixture
union all
select tenant_id,branch_id,supplier_id,'PMR-PARTIAL','partially_received','NGN',200,now()-interval '5 days',now()-interval '5 days',null from sellertray_purchasing_management_fixture
union all
select tenant_id,branch_id,inactive_supplier_id,'PMR-RECEIVED','received','NGN',300,now()-interval '4 days',now()-interval '4 days',now()-interval '2 days' from sellertray_purchasing_management_fixture
union all
select tenant_id,branch_id,inactive_supplier_id,'PMR-CANCELLED','cancelled','NGN',400,now()-interval '3 days',now()-interval '3 days',null from sellertray_purchasing_management_fixture
union all
select tenant_id,other_branch_id,inactive_supplier_id,'PMR-ALT','ordered','NGN',500,now()-interval '2 days',now()-interval '2 days',null from sellertray_purchasing_management_fixture
union all
select other_tenant_id,foreign_branch_id,foreign_supplier_id,'PMR-FOREIGN','ordered','NGN',600,now()-interval '1 day',now()-interval '1 day',null from sellertray_purchasing_management_fixture;

update sellertray_purchasing_management_fixture f
set ordered_po_id=po.id
from public.sellertray_purchase_orders po
where po.tenant_id=f.tenant_id and po.reference='PMR-ORDERED';

update sellertray_purchasing_management_fixture f
set foreign_po_id=po.id
from public.sellertray_purchase_orders po
where po.tenant_id=f.other_tenant_id and po.reference='PMR-FOREIGN';

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_purchasing_management_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_purchasing_management_fixture
set list_result=public.get_sellertray_purchase_orders_management_list(tenant_id,branch_id,null,null,50,0),
    page_result=public.get_sellertray_purchase_orders_management_list(tenant_id,branch_id,null,null,1,0),
    all_branches_result=public.get_sellertray_purchase_orders_management_list(tenant_id,null,null,null,50,0),
    supplier_result=public.get_sellertray_suppliers_management_list(tenant_id,null,null,50,0),
    supplier_page_result=public.get_sellertray_suppliers_management_list(tenant_id,null,null,1,0),
    supplier_detail=public.get_sellertray_supplier_management_detail(tenant_id,supplier_id),
    po_detail=public.get_sellertray_purchase_order_management_detail(tenant_id,ordered_po_id);

select extensions.is(((select list_result->>'totalCount' from sellertray_purchasing_management_fixture))::integer,5,'Purchase Order management list is scoped to the selected Branch');
select extensions.is((public.get_sellertray_purchase_orders_management_list((select tenant_id from sellertray_purchasing_management_fixture),(select branch_id from sellertray_purchasing_management_fixture),null,'ordered',50,0)->>'totalCount')::integer,1,'Purchase Order status filtering is server-side');
select extensions.is((public.get_sellertray_purchase_orders_management_list((select tenant_id from sellertray_purchasing_management_fixture),(select branch_id from sellertray_purchasing_management_fixture),'Alpha',null,50,0)->>'totalCount')::integer,3,'Purchase Order search matches supplier names server-side');
select extensions.ok(((select page_result->>'totalCount' from sellertray_purchasing_management_fixture))::integer=5 and jsonb_array_length((select page_result->'items' from sellertray_purchasing_management_fixture))=1,'Purchase Order paging keeps total count independent of page size');
select extensions.is(((select page_result->>'orderedValue' from sellertray_purchasing_management_fixture))::numeric,600::numeric,'Purchase Order aggregate value covers the full filtered result set');
select extensions.is(((select all_branches_result->>'totalCount' from sellertray_purchasing_management_fixture))::integer,6,'All-Branches purchasing remains Business-scoped');
select extensions.is(((select all_branches_result->>'orderedValue' from sellertray_purchasing_management_fixture))::numeric,1100::numeric,'All-Branches aggregate includes governed purchases from each Business Branch');

select extensions.throws_ok(
  format('select public.get_sellertray_purchase_orders_management_list(%L::uuid,%L::uuid,null,null,50,0)',(select tenant_id::text from sellertray_purchasing_management_fixture),(select foreign_branch_id::text from sellertray_purchasing_management_fixture)),
  'P0002','Branch not found','Purchase Order list fails closed for another Business Branch'
);
select extensions.throws_ok(
  format('select public.get_sellertray_purchase_orders_management_list(%L::uuid,%L::uuid,null,%L,50,0)',(select tenant_id::text from sellertray_purchasing_management_fixture),(select branch_id::text from sellertray_purchasing_management_fixture),'unknown'),
  '22023','Unsupported Purchase Order status','Unsupported Purchase Order status is rejected'
);

select extensions.ok((select po_detail->>'reference' from sellertray_purchasing_management_fixture)='PMR-ORDERED' and (select po_detail->>'supplierName' from sellertray_purchasing_management_fixture)='Alpha Supplies','Purchase Order detail is tenant-scoped and returns the expected immutable header');
select extensions.ok(
  exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_purchase_order_management_detail(uuid,uuid)') and lower(pg_get_functiondef(p.oid)) like '%productname%' and lower(pg_get_functiondef(p.oid)) like '%selecteduom%' and lower(pg_get_functiondef(p.oid)) like '%unitcost%' and lower(pg_get_functiondef(p.oid)) like '%remainingvalue%'),
  'Purchase Order detail exposes immutable product, UOM, cost and remaining-value snapshots'
);
select extensions.throws_ok(
  format('select public.get_sellertray_purchase_order_management_detail(%L::uuid,%L::uuid)',(select tenant_id::text from sellertray_purchasing_management_fixture),(select foreign_po_id::text from sellertray_purchasing_management_fixture)),
  'P0002','Purchase Order not found','Purchase Order detail fails closed across Businesses'
);

select extensions.is(((select supplier_result->>'totalCount' from sellertray_purchasing_management_fixture))::integer,2,'Supplier management list is Business-scoped');
select extensions.is((public.get_sellertray_suppliers_management_list((select tenant_id from sellertray_purchasing_management_fixture),null,'active',50,0)->>'totalCount')::integer,1,'Active supplier filtering is server-side');
select extensions.is((public.get_sellertray_suppliers_management_list((select tenant_id from sellertray_purchasing_management_fixture),null,'inactive',50,0)->>'totalCount')::integer,1,'Inactive supplier filtering is server-side');
select extensions.is((public.get_sellertray_suppliers_management_list((select tenant_id from sellertray_purchasing_management_fixture),'Bola',null,50,0)->>'totalCount')::integer,1,'Supplier search matches contact details server-side');
select extensions.ok(((select supplier_page_result->>'totalCount' from sellertray_purchasing_management_fixture))::integer=2 and jsonb_array_length((select supplier_page_result->'items' from sellertray_purchasing_management_fixture))=1,'Supplier paging keeps total count independent of page size');
select extensions.is(((select supplier_result->>'outstandingAmount' from sellertray_purchasing_management_fixture))::numeric,1100::numeric,'Supplier outstanding aggregate excludes draft and cancelled Purchase Orders');
select extensions.is(((select supplier_detail->>'purchaseCount' from sellertray_purchasing_management_fixture))::integer,2,'Supplier summary counts only placed purchasing obligations');
select extensions.is(((select supplier_detail->>'outstandingAmount' from sellertray_purchasing_management_fixture))::numeric,300::numeric,'Supplier detail reuses derived payable truth');
select extensions.ok(jsonb_array_length((select supplier_detail->'purchaseHistory' from sellertray_purchasing_management_fixture))=3,'Supplier detail retains purchase history including draft review while payable totals remain governed');
select extensions.throws_ok(
  format('select public.get_sellertray_supplier_management_detail(%L::uuid,%L::uuid)',(select tenant_id::text from sellertray_purchasing_management_fixture),(select foreign_supplier_id::text from sellertray_purchasing_management_fixture)),
  'P0002','Supplier not found','Supplier detail fails closed across Businesses'
);

select set_config('request.jwt.claim.sub',(select manager_user_id::text from sellertray_purchasing_management_fixture),true);
select extensions.is((public.get_sellertray_purchase_orders_management_list((select tenant_id from sellertray_purchasing_management_fixture),(select branch_id from sellertray_purchasing_management_fixture),null,null,50,0)->>'totalCount')::integer,5,'Managers can use purchasing management reads');

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_purchasing_management_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_purchase_orders_management_list(%L::uuid,%L::uuid,null,null,50,0)',(select tenant_id::text from sellertray_purchasing_management_fixture),(select branch_id::text from sellertray_purchasing_management_fixture)),
  '42501','Owner or Manager access is required to manage purchasing','Staff cannot use purchasing management reads'
);
select extensions.throws_ok(
  format('select public.get_sellertray_suppliers_management_list(%L::uuid,null,null,50,0)',(select tenant_id::text from sellertray_purchasing_management_fixture)),
  '42501','Owner or Manager access is required to manage suppliers','Staff cannot use supplier management reads'
);

select extensions.ok(
  not exists(
    select 1 from pg_proc p
    where p.oid in (
      to_regprocedure('public.get_sellertray_purchase_orders_management_list(uuid,uuid,text,text,integer,integer)'),
      to_regprocedure('public.get_sellertray_purchase_order_management_detail(uuid,uuid)'),
      to_regprocedure('public.get_sellertray_suppliers_management_list(uuid,text,text,integer,integer)'),
      to_regprocedure('public.get_sellertray_supplier_management_detail(uuid,uuid)')
    )
    and (lower(pg_get_functiondef(p.oid)) like '%insert into public.inventory_movements%' or lower(pg_get_functiondef(p.oid)) like '%update public.inventory_movements%' or lower(pg_get_functiondef(p.oid)) like '%apply_sellertray_inventory_operation%')
  ),
  'Purchasing management reads cannot mutate inventory or valuation state'
);
select extensions.ok(
  not exists(
    select 1 from pg_proc p
    where p.oid in (
      to_regprocedure('public.get_sellertray_purchase_orders_management_list(uuid,uuid,text,text,integer,integer)'),
      to_regprocedure('public.get_sellertray_purchase_order_management_detail(uuid,uuid)'),
      to_regprocedure('public.get_sellertray_suppliers_management_list(uuid,text,text,integer,integer)'),
      to_regprocedure('public.get_sellertray_supplier_management_detail(uuid,uuid)')
    ) and lower(pg_get_functiondef(p.oid)) like '%wa_id%'
  ),
  'Purchasing management reads do not expose raw WhatsApp identity'
);
select extensions.ok(
  exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_suppliers_management_list(uuid,text,text,integer,integer)') and lower(pg_get_functiondef(p.oid)) like '%sellertray_purchase_paid_amount%')
  and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_supplier_management_detail(uuid,uuid)') and lower(pg_get_functiondef(p.oid)) like '%sellertray_purchase_paid_amount%'),
  'Supplier management reuses the existing effective supplier-payment helper'
);

select * from extensions.finish();
rollback;
