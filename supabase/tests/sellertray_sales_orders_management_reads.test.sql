begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

select extensions.ok(
  (
    select p.prosecdef and p.provolatile='s'
    from pg_proc p
    where p.oid=to_regprocedure('public.get_sellertray_order_management_list(uuid,uuid,text,text,integer,integer)')
  )
  and (
    select p.prosecdef and p.provolatile='s'
    from pg_proc p
    where p.oid=to_regprocedure('public.get_sellertray_order_management_detail(uuid,uuid,uuid)')
  )
  and (
    select p.prosecdef and p.provolatile='s'
    from pg_proc p
    where p.oid=to_regprocedure('public.get_sellertray_sales_management_list(uuid,uuid,text,text,integer,integer)')
  ),
  'Sales and Orders management reads are stable SECURITY DEFINER functions'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_order_management_list(uuid,uuid,text,text,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_order_management_detail(uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_sales_management_list(uuid,uuid,text,text,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_order_management_list(uuid,uuid,text,text,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_order_management_detail(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_sales_management_list(uuid,uuid,text,text,integer,integer)','EXECUTE'),
  'Sales and Orders management reads are authenticated-only'
);

create temp table sellertray_sales_orders_read_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  branch_id uuid,
  other_branch_id uuid,
  foreign_branch_id uuid,
  customer_id uuid not null,
  other_customer_id uuid not null,
  open_order_id uuid,
  completed_order_id uuid,
  open_result jsonb,
  payment_result jsonb,
  all_result jsonb,
  search_result jsonb,
  page_result jsonb,
  detail_result jsonb,
  sales_result jsonb,
  sales_page_result jsonb,
  sales_source_result jsonb,
  sales_search_result jsonb
) on commit drop;

insert into sellertray_sales_orders_read_fixture(
  tenant_id,other_tenant_id,owner_user_id,manager_user_id,staff_user_id,customer_id,other_customer_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'sales-orders-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_sales_orders_read_fixture
union all
select manager_user_id,'sales-orders-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_sales_orders_read_fixture
union all
select staff_user_id,'sales-orders-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_sales_orders_read_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Sales Orders Read Test','sellertray-sales-orders-'||substr(tenant_id::text,1,8),'SOR','active'
from sellertray_sales_orders_read_fixture
union all
select other_tenant_id,'SellerTray Other Sales Orders Read Test','sellertray-other-sales-orders-'||substr(other_tenant_id::text,1,8),'SOX','active'
from sellertray_sales_orders_read_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (
  select tenant_id from sellertray_sales_orders_read_fixture
  union all
  select other_tenant_id from sellertray_sales_orders_read_fixture
);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_sales_orders_read_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_sales_orders_read_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_sales_orders_read_fixture;

update sellertray_sales_orders_read_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_sales_orders_read_fixture f
set foreign_branch_id=b.id
from public.branches b
where b.tenant_id=f.other_tenant_id and b.is_default=true;

with inserted as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'ALT','Alternate Branch',false,true
  from sellertray_sales_orders_read_fixture
  returning id
)
update sellertray_sales_orders_read_fixture
set other_branch_id=(select id from inserted);

insert into public.customers(id,tenant_id,wa_id,display_name,phone,email,created_at,updated_at)
select customer_id,tenant_id,'2348099999999','Ada Manager Read','+2348099999999','ada-manager-read@example.com',now()-interval '20 days',now()
from sellertray_sales_orders_read_fixture
union all
select other_customer_id,other_tenant_id,'2348088888888','Other Business Customer','+2348088888888',null,now()-interval '20 days',now()
from sellertray_sales_orders_read_fixture;

insert into public.orders(
  tenant_id,customer_id,branch_id,public_order_id,status,source,total_amount,amount_paid,payment_status,created_at
)
select tenant_id,customer_id,branch_id,'MGRREAD/OPEN','accepted','manual',100,0,'unpaid',now()-interval '10 days'
from sellertray_sales_orders_read_fixture
union all
select tenant_id,customer_id,branch_id,'MGRREAD/PENDING','processing','manual',200,0,'pending',now()-interval '9 days'
from sellertray_sales_orders_read_fixture
union all
select tenant_id,customer_id,branch_id,'MGRREAD/VERIFY','ready','manual',300,0,'verification_required',now()-interval '8 days'
from sellertray_sales_orders_read_fixture
union all
select tenant_id,customer_id,branch_id,'MGRREAD/ISSUE','needs_review','whatsapp',400,0,'payment_issue',now()-interval '7 days'
from sellertray_sales_orders_read_fixture
union all
select tenant_id,customer_id,branch_id,'MGRREAD/DRAFT','draft','pos',50,0,'unpaid',now()-interval '6 days'
from sellertray_sales_orders_read_fixture
union all
select tenant_id,customer_id,branch_id,'MGRREAD/SALE-POS','completed','pos',1000,1000,'paid',now()-interval '5 days'
from sellertray_sales_orders_read_fixture
union all
select tenant_id,customer_id,branch_id,'MGRREAD/SALE-WA','completed','whatsapp',2000,2000,'paid',now()-interval '4 days'
from sellertray_sales_orders_read_fixture
union all
select tenant_id,customer_id,branch_id,'MGRREAD/REJECT','rejected','manual',500,0,'unpaid',now()-interval '3 days'
from sellertray_sales_orders_read_fixture
union all
select tenant_id,customer_id,branch_id,'MGRREAD/CANCEL','cancelled','manual',600,0,'unpaid',now()-interval '2 days'
from sellertray_sales_orders_read_fixture
union all
select tenant_id,customer_id,other_branch_id,'MGRREAD/OTHER-BRANCH','accepted','manual',700,0,'unpaid',now()-interval '1 day'
from sellertray_sales_orders_read_fixture
union all
select other_tenant_id,other_customer_id,foreign_branch_id,'MGRREAD/OTHER-BUSINESS','accepted','manual',800,0,'unpaid',now()-interval '1 day'
from sellertray_sales_orders_read_fixture;

insert into public.orders(
  tenant_id,customer_id,branch_id,public_order_id,status,source,total_amount,amount_paid,payment_status,
  created_at,deleted_at,deleted_by_user_id,deletion_reason,deletion_command_hash
)
select tenant_id,customer_id,branch_id,'MGRREAD/DELETED','draft','pos',900,0,'unpaid',
  now()-interval '1 day',now(),owner_user_id,'Duplicate draft','abcdef0123456789abcdef0123456789'
from sellertray_sales_orders_read_fixture;

update sellertray_sales_orders_read_fixture f
set open_order_id=o.id
from public.orders o
where o.tenant_id=f.tenant_id and o.public_order_id='MGRREAD/OPEN';

update sellertray_sales_orders_read_fixture f
set completed_order_id=o.id
from public.orders o
where o.tenant_id=f.tenant_id and o.public_order_id='MGRREAD/SALE-POS';

insert into public.order_items(tenant_id,order_id,item_name,quantity,unit_price,selected_uom,conversion_factor,stock_quantity)
select tenant_id,open_order_id,'Blue Paint',2,50,'Each',1,2
from sellertray_sales_orders_read_fixture
union all
select f.tenant_id,o.id,'Red Paint',2,500,'Each',1,2
from sellertray_sales_orders_read_fixture f
join public.orders o on o.tenant_id=f.tenant_id and o.public_order_id='MGRREAD/SALE-POS'
union all
select f.tenant_id,o.id,'Brush',4,500,'Each',1,4
from sellertray_sales_orders_read_fixture f
join public.orders o on o.tenant_id=f.tenant_id and o.public_order_id='MGRREAD/SALE-WA';

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_sales_orders_read_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_sales_orders_read_fixture
set open_result=public.get_sellertray_order_management_list(tenant_id,branch_id,'open',null,50,0),
    payment_result=public.get_sellertray_order_management_list(tenant_id,branch_id,'awaiting_payment',null,50,0),
    all_result=public.get_sellertray_order_management_list(tenant_id,branch_id,'all',null,50,0),
    search_result=public.get_sellertray_order_management_list(tenant_id,branch_id,'all','Blue Paint',50,0),
    page_result=public.get_sellertray_order_management_list(tenant_id,branch_id,'all',null,1,0),
    detail_result=public.get_sellertray_order_management_detail(tenant_id,branch_id,open_order_id),
    sales_result=public.get_sellertray_sales_management_list(tenant_id,branch_id,null,null,50,0),
    sales_page_result=public.get_sellertray_sales_management_list(tenant_id,branch_id,null,null,1,0),
    sales_source_result=public.get_sellertray_sales_management_list(tenant_id,branch_id,null,'pos',50,0),
    sales_search_result=public.get_sellertray_sales_management_list(tenant_id,branch_id,'Brush',null,50,0);

select extensions.is(
  ((select open_result->>'totalCount' from sellertray_sales_orders_read_fixture))::integer,
  5,
  'Open Orders contains only non-terminal orders in the selected Branch'
);

select extensions.ok(
  not exists(
    select 1
    from sellertray_sales_orders_read_fixture f,
         jsonb_array_elements(f.open_result->'items') item
    where item->>'status' in ('completed','rejected','cancelled')
  ),
  'Open Orders excludes completed, rejected and cancelled lifecycle states'
);

select extensions.is(
  ((select payment_result->>'totalCount' from sellertray_sales_orders_read_fixture))::integer,
  5,
  'Awaiting payment uses the governed unpaid, pending, verification-required and payment-issue family'
);

select extensions.is(
  (public.get_sellertray_order_management_list(
    (select tenant_id from sellertray_sales_orders_read_fixture),
    (select branch_id from sellertray_sales_orders_read_fixture),
    'cancelled',null,50,0
  )->>'totalCount')::integer,
  1,
  'Cancelled Orders is a terminal view and remains separately reviewable'
);

select extensions.is(
  ((select all_result->>'totalCount' from sellertray_sales_orders_read_fixture))::integer,
  9,
  'All Orders is Branch-scoped and excludes soft-deleted drafts'
);

select extensions.is(
  ((select search_result->>'totalCount' from sellertray_sales_orders_read_fixture))::integer,
  1,
  'Orders search is performed server-side across product names'
);

select extensions.ok(
  ((select page_result->>'totalCount' from sellertray_sales_orders_read_fixture))::integer=9
  and jsonb_array_length((select page_result->'items' from sellertray_sales_orders_read_fixture))=1,
  'Orders paging returns total count independently from page size'
);

select extensions.ok(
  position('2348099999999' in (select all_result::text from sellertray_sales_orders_read_fixture))=0,
  'Orders list does not expose the raw WhatsApp identity'
);

select extensions.is(
  jsonb_array_length((select detail_result->'items' from sellertray_sales_orders_read_fixture)),
  1,
  'Order detail loads line items through the governed read model'
);

select extensions.ok(
  position('2348099999999' in (select detail_result::text from sellertray_sales_orders_read_fixture))=0,
  'Order detail does not expose the raw WhatsApp identity'
);

select extensions.throws_ok(
  format(
    'select public.get_sellertray_order_management_detail(%L::uuid,%L::uuid,%L::uuid)',
    (select tenant_id::text from sellertray_sales_orders_read_fixture),
    (select other_branch_id::text from sellertray_sales_orders_read_fixture),
    (select open_order_id::text from sellertray_sales_orders_read_fixture)
  ),
  'P0002',
  'Order not found',
  'Order detail fails closed across Branch boundaries'
);

select extensions.is(
  ((select sales_result->>'totalCount' from sellertray_sales_orders_read_fixture))::integer,
  2,
  'Sales list contains completed transactions only in the selected Branch'
);

select extensions.ok(
  ((select sales_page_result->>'totalCount' from sellertray_sales_orders_read_fixture))::integer=2
  and jsonb_array_length((select sales_page_result->'items' from sellertray_sales_orders_read_fixture))=1
  and ((select sales_page_result->>'collected' from sellertray_sales_orders_read_fixture))::numeric=3000::numeric,
  'Sales totals cover the full filtered set even when the current page contains one transaction'
);

select extensions.is(
  ((select sales_page_result->>'returned' from sellertray_sales_orders_read_fixture))::numeric,
  0::numeric,
  'Sales returned total is aggregated by the governed read model'
);

select extensions.ok(
  ((select sales_source_result->>'totalCount' from sellertray_sales_orders_read_fixture))::integer=1
  and ((select sales_source_result->>'collected' from sellertray_sales_orders_read_fixture))::numeric=1000::numeric,
  'Sales channel filter and aggregate are applied server-side'
);

select extensions.is(
  ((select sales_search_result->>'totalCount' from sellertray_sales_orders_read_fixture))::integer,
  1,
  'Sales search is performed server-side across product names'
);

select extensions.ok(
  position('2348099999999' in (select sales_result::text from sellertray_sales_orders_read_fixture))=0,
  'Sales list does not expose the raw WhatsApp identity'
);

select set_config('request.jwt.claim.sub',(select manager_user_id::text from sellertray_sales_orders_read_fixture),true);
select extensions.is(
  (public.get_sellertray_order_management_list(
    (select tenant_id from sellertray_sales_orders_read_fixture),
    (select branch_id from sellertray_sales_orders_read_fixture),
    'open',null,50,0
  )->>'totalCount')::integer,
  5,
  'Manager can use governed Orders management reads'
);

select extensions.is(
  (public.get_sellertray_sales_management_list(
    (select tenant_id from sellertray_sales_orders_read_fixture),
    (select branch_id from sellertray_sales_orders_read_fixture),
    null,null,50,0
  )->>'totalCount')::integer,
  2,
  'Manager can use governed Sales management reads'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_sales_orders_read_fixture),true);
select extensions.throws_ok(
  format(
    'select public.get_sellertray_order_management_list(%L::uuid,%L::uuid,''open'',null,50,0)',
    (select tenant_id::text from sellertray_sales_orders_read_fixture),
    (select branch_id::text from sellertray_sales_orders_read_fixture)
  ),
  '42501',
  'Owner or Manager access is required to manage orders',
  'Cashier/Staff cannot use the management Orders read model'
);

select extensions.throws_ok(
  format(
    'select public.get_sellertray_sales_management_list(%L::uuid,%L::uuid,null,null,50,0)',
    (select tenant_id::text from sellertray_sales_orders_read_fixture),
    (select branch_id::text from sellertray_sales_orders_read_fixture)
  ),
  '42501',
  'Owner or Manager access is required to manage sales',
  'Cashier/Staff cannot use the management Sales read model'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_sales_orders_read_fixture),true);
select extensions.throws_ok(
  format(
    'select public.get_sellertray_order_management_list(%L::uuid,%L::uuid,''unknown'',null,50,0)',
    (select tenant_id::text from sellertray_sales_orders_read_fixture),
    (select branch_id::text from sellertray_sales_orders_read_fixture)
  ),
  '22023',
  'Unsupported order view',
  'Orders read rejects an unknown lifecycle view'
);

select extensions.throws_ok(
  format(
    'select public.get_sellertray_sales_management_list(%L::uuid,%L::uuid,null,''marketplace'',50,0)',
    (select tenant_id::text from sellertray_sales_orders_read_fixture),
    (select branch_id::text from sellertray_sales_orders_read_fixture)
  ),
  '22023',
  'Unsupported sales channel',
  'Sales read rejects an unknown channel'
);

select extensions.throws_ok(
  format(
    'select public.get_sellertray_order_management_list(%L::uuid,%L::uuid,''all'',null,50,0)',
    (select other_tenant_id::text from sellertray_sales_orders_read_fixture),
    (select foreign_branch_id::text from sellertray_sales_orders_read_fixture)
  ),
  '42501',
  'Owner or Manager access is required to manage orders',
  'Orders read fails closed across Business boundaries'
);

select extensions.throws_ok(
  format(
    'select public.get_sellertray_sales_management_list(%L::uuid,%L::uuid,null,null,50,0)',
    (select other_tenant_id::text from sellertray_sales_orders_read_fixture),
    (select foreign_branch_id::text from sellertray_sales_orders_read_fixture)
  ),
  '42501',
  'Owner or Manager access is required to manage sales',
  'Sales read fails closed across Business boundaries'
);

select * from extensions.finish();
rollback;
