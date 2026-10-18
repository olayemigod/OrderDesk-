begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(31);

select extensions.ok(
  (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_returns_management_list(uuid,uuid,text,integer,integer)'))
  and
  (select p.prosecdef and p.provolatile='s' from pg_proc p where p.oid=to_regprocedure('public.get_sellertray_return_management_detail(uuid,uuid,uuid)')),
  'Returns management reads are stable SECURITY DEFINER functions'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_returns_management_list(uuid,uuid,text,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_return_management_detail(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_returns_management_list(uuid,uuid,text,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_return_management_detail(uuid,uuid,uuid)','EXECUTE'),
  'Returns management reads are authenticated-only'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_sale_return_history(uuid,integer)') is not null,
  'Legacy return-history read remains available for existing reporting consumers'
);

create temp table sellertray_returns_read_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  branch_id uuid,
  other_branch_id uuid,
  foreign_branch_id uuid,
  customer_id uuid not null,
  second_customer_id uuid not null,
  foreign_customer_id uuid not null,
  primary_return_id uuid not null,
  list_result jsonb,
  page_result jsonb,
  page_two_result jsonb,
  detail_result jsonb
) on commit drop;

insert into sellertray_returns_read_fixture(
  tenant_id,other_tenant_id,owner_user_id,manager_user_id,staff_user_id,
  customer_id,second_customer_id,foreign_customer_id,primary_return_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'returns-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_returns_read_fixture
union all
select manager_user_id,'returns-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_returns_read_fixture
union all
select staff_user_id,'returns-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_returns_read_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Returns Read Test','sellertray-returns-'||substr(tenant_id::text,1,8),'RTR','active' from sellertray_returns_read_fixture
union all
select other_tenant_id,'SellerTray Foreign Returns Read Test','sellertray-foreign-returns-'||substr(other_tenant_id::text,1,8),'RTX','active' from sellertray_returns_read_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (
  select tenant_id from sellertray_returns_read_fixture
  union all
  select other_tenant_id from sellertray_returns_read_fixture
);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_returns_read_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_returns_read_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_returns_read_fixture;

update sellertray_returns_read_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_returns_read_fixture f
set foreign_branch_id=b.id
from public.branches b
where b.tenant_id=f.other_tenant_id and b.is_default=true;

with inserted as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'ALT','Returns Alternate Branch',false,true from sellertray_returns_read_fixture
  returning id
)
update sellertray_returns_read_fixture
set other_branch_id=(select id from inserted);

insert into public.customers(id,tenant_id,wa_id,display_name,phone,email,created_at,updated_at)
select customer_id,tenant_id,'9991000000001','Ada Returns','+2348011111111','ada-returns@example.com',now()-interval '20 days',now() from sellertray_returns_read_fixture
union all
select second_customer_id,tenant_id,'9991000000002','Chidi Returns','+2348022222222','chidi-returns@example.com',now()-interval '20 days',now() from sellertray_returns_read_fixture
union all
select foreign_customer_id,other_tenant_id,'9991000000099','Foreign Returns','+2348099999999',null,now()-interval '20 days',now() from sellertray_returns_read_fixture;

insert into public.catalog_items(tenant_id,name,sku,price_ngn,stock_uom,allow_fractional_stock)
select tenant_id,'Current Blue Paint','RET-BLUE',100,'Each',true from sellertray_returns_read_fixture
union all
select tenant_id,'Current Brush','RET-BRUSH',50,'Each',true from sellertray_returns_read_fixture
union all
select tenant_id,'Current Red Paint','RET-RED',450,'Each',true from sellertray_returns_read_fixture
union all
select other_tenant_id,'Foreign Current Product','RET-FOREIGN',900,'Each',true from sellertray_returns_read_fixture;

insert into public.orders(
  tenant_id,customer_id,branch_id,public_order_id,status,source,total_amount,amount_paid,payment_status,created_at
)
select tenant_id,customer_id,branch_id,'RETREAD/1001','completed','pos',450,450,'paid',now()-interval '10 days' from sellertray_returns_read_fixture
union all
select tenant_id,second_customer_id,branch_id,'RETREAD/1002','completed','whatsapp',450,450,'paid',now()-interval '9 days' from sellertray_returns_read_fixture
union all
select tenant_id,customer_id,other_branch_id,'RETREAD/ALT','completed','pos',800,800,'paid',now()-interval '8 days' from sellertray_returns_read_fixture
union all
select tenant_id,customer_id,branch_id,'RETREAD/OPEN','accepted','pos',111,111,'paid',now()-interval '7 days' from sellertray_returns_read_fixture
union all
select other_tenant_id,foreign_customer_id,foreign_branch_id,'RETREAD/FOREIGN','completed','pos',900,900,'paid',now()-interval '6 days' from sellertray_returns_read_fixture;

insert into public.orders(
  tenant_id,customer_id,branch_id,public_order_id,status,source,total_amount,amount_paid,payment_status,
  created_at,deleted_at,deleted_by_user_id,deletion_reason,deletion_command_hash
)
select tenant_id,customer_id,branch_id,'RETREAD/DELETED','draft','pos',222,222,'paid',
  now()-interval '5 days',now()-interval '1 day',owner_user_id,'Historical fixture exclusion','abcdef0123456789abcdef0123456789'
from sellertray_returns_read_fixture;

-- order_items.line_total is generated from quantity * unit_price. The fixture
-- leaves that column to the database instead of writing derived commercial truth.
insert into public.order_items(
  tenant_id,order_id,catalog_item_id,item_name,quantity,unit_price,selected_uom,conversion_factor,stock_quantity
)
select o.tenant_id,o.id,ci.id,'Current Blue Paint',2,100,'Box',12,24
from public.orders o join sellertray_returns_read_fixture f on f.tenant_id=o.tenant_id
join public.catalog_items ci on ci.tenant_id=o.tenant_id and ci.sku='RET-BLUE'
where o.public_order_id='RETREAD/1001'
union all
select o.tenant_id,o.id,ci.id,'Current Brush',5,50,'Each',1,5
from public.orders o join sellertray_returns_read_fixture f on f.tenant_id=o.tenant_id
join public.catalog_items ci on ci.tenant_id=o.tenant_id and ci.sku='RET-BRUSH'
where o.public_order_id='RETREAD/1001'
union all
select o.tenant_id,o.id,ci.id,'Current Red Paint',1,450,'Carton',6,6
from public.orders o join sellertray_returns_read_fixture f on f.tenant_id=o.tenant_id
join public.catalog_items ci on ci.tenant_id=o.tenant_id and ci.sku='RET-RED'
where o.public_order_id='RETREAD/1002'
union all
select o.tenant_id,o.id,ci.id,'Current Red Paint',1,800,'Each',1,1
from public.orders o join sellertray_returns_read_fixture f on f.tenant_id=o.tenant_id
join public.catalog_items ci on ci.tenant_id=o.tenant_id and ci.sku='RET-RED'
where o.public_order_id='RETREAD/ALT'
union all
select o.tenant_id,o.id,ci.id,'Current Red Paint',1,111,'Each',1,1
from public.orders o join sellertray_returns_read_fixture f on f.tenant_id=o.tenant_id
join public.catalog_items ci on ci.tenant_id=o.tenant_id and ci.sku='RET-RED'
where o.public_order_id='RETREAD/OPEN'
union all
select o.tenant_id,o.id,ci.id,'Current Red Paint',1,222,'Each',1,1
from public.orders o join sellertray_returns_read_fixture f on f.tenant_id=o.tenant_id
join public.catalog_items ci on ci.tenant_id=o.tenant_id and ci.sku='RET-RED'
where o.public_order_id='RETREAD/DELETED'
union all
select o.tenant_id,o.id,ci.id,'Foreign Current Product',1,900,'Each',1,1
from public.orders o join sellertray_returns_read_fixture f on f.other_tenant_id=o.tenant_id
join public.catalog_items ci on ci.tenant_id=o.tenant_id and ci.sku='RET-FOREIGN'
where o.public_order_id='RETREAD/FOREIGN';

insert into public.order_financial_documents(
  tenant_id,order_id,document_type,document_reference,currency,amount,status,issued_at
)
select o.tenant_id,o.id,'invoice','INV-RETREAD-'||replace(o.public_order_id,'/','-'),'NGN',o.total_amount,'issued',o.created_at
from public.orders o
where o.public_order_id like 'RETREAD/%';

insert into public.order_payments(
  tenant_id,order_id,invoice_document_id,method_type,provider,status,amount,currency,
  confirmed_at,confirmation_source,created_at,updated_at
)
select o.tenant_id,o.id,d.id,'cash','pos_cash','confirmed',o.total_amount,'NGN',
       o.created_at+interval '5 minutes','system',o.created_at+interval '5 minutes',o.created_at+interval '5 minutes'
from public.orders o
join public.order_financial_documents d on d.tenant_id=o.tenant_id and d.order_id=o.id and d.document_type='invoice'
where o.public_order_id like 'RETREAD/%';

-- The primary return ID is allocated before the commercial fixtures are written.
-- That avoids a post-hoc lookup becoming part of the test's correctness contract.
insert into public.sale_returns(
  id,tenant_id,branch_id,order_id,original_payment_id,return_type,status,amount,currency,reason,created_at
)
select
  case when o.tenant_id=f.tenant_id and o.public_order_id='RETREAD/1001' then f.primary_return_id else gen_random_uuid() end,
  o.tenant_id,o.branch_id,o.id,p.id,'partial','completed',
  case o.public_order_id
    when 'RETREAD/1001' then 300
    when 'RETREAD/1002' then 450
    when 'RETREAD/ALT' then 800
    when 'RETREAD/OPEN' then 111
    when 'RETREAD/DELETED' then 222
    when 'RETREAD/FOREIGN' then 900
  end,
  'NGN',
  case o.public_order_id
    when 'RETREAD/1001' then 'Damaged seal'
    when 'RETREAD/1002' then 'Wrong shade'
    when 'RETREAD/ALT' then 'Alternate Branch return'
    when 'RETREAD/OPEN' then 'Non-completed order fixture'
    when 'RETREAD/DELETED' then 'Deleted draft fixture'
    when 'RETREAD/FOREIGN' then 'Foreign Business return'
  end,
  case o.public_order_id
    when 'RETREAD/1001' then now()-interval '1 hour'
    when 'RETREAD/1002' then now()-interval '2 hours'
    when 'RETREAD/ALT' then now()-interval '30 minutes'
    when 'RETREAD/OPEN' then now()-interval '3 hours'
    when 'RETREAD/DELETED' then now()-interval '4 hours'
    when 'RETREAD/FOREIGN' then now()-interval '20 minutes'
  end
from public.orders o
join public.order_payments p on p.tenant_id=o.tenant_id and p.order_id=o.id
cross join sellertray_returns_read_fixture f
where o.public_order_id like 'RETREAD/%'
  and o.tenant_id in (f.tenant_id,f.other_tenant_id);

-- Return line_total is intentionally persisted: it is immutable historical refund evidence.
insert into public.sale_return_items(
  tenant_id,sale_return_id,order_item_id,catalog_item_id,product_name,selected_uom,
  quantity,conversion_factor,stock_quantity,unit_price,line_total,created_at
)
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Blue Paint Historic','Box',1.5,12,18,100,150,r.created_at
from public.sale_returns r
join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id and o.public_order_id='RETREAD/1001'
join public.order_items oi on oi.tenant_id=o.tenant_id and oi.order_id=o.id and oi.item_name='Current Blue Paint'
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Brush Historic','Each',3,1,3,50,150,r.created_at+interval '1 second'
from public.sale_returns r
join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id and o.public_order_id='RETREAD/1001'
join public.order_items oi on oi.tenant_id=o.tenant_id and oi.order_id=o.id and oi.item_name='Current Brush'
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Red Paint Historic','Carton',1,6,6,450,450,r.created_at
from public.sale_returns r join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id and o.public_order_id='RETREAD/1002'
join public.order_items oi on oi.tenant_id=o.tenant_id and oi.order_id=o.id
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Alternate Branch Historic','Each',1,1,1,800,800,r.created_at
from public.sale_returns r join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id and o.public_order_id='RETREAD/ALT'
join public.order_items oi on oi.tenant_id=o.tenant_id and oi.order_id=o.id
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Open Order Historic','Each',1,1,1,111,111,r.created_at
from public.sale_returns r join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id and o.public_order_id='RETREAD/OPEN'
join public.order_items oi on oi.tenant_id=o.tenant_id and oi.order_id=o.id
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Deleted Order Historic','Each',1,1,1,222,222,r.created_at
from public.sale_returns r join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id and o.public_order_id='RETREAD/DELETED'
join public.order_items oi on oi.tenant_id=o.tenant_id and oi.order_id=o.id
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Foreign Product Historic','Each',1,1,1,900,900,r.created_at
from public.sale_returns r join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id and o.public_order_id='RETREAD/FOREIGN'
join public.order_items oi on oi.tenant_id=o.tenant_id and oi.order_id=o.id;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_returns_read_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_returns_read_fixture
set list_result=public.get_sellertray_returns_management_list(tenant_id,branch_id,null,50,0),
    page_result=public.get_sellertray_returns_management_list(tenant_id,branch_id,null,1,0),
    page_two_result=public.get_sellertray_returns_management_list(tenant_id,branch_id,null,1,1),
    detail_result=public.get_sellertray_return_management_detail(tenant_id,branch_id,primary_return_id);

select extensions.is(((select list_result->>'totalCount' from sellertray_returns_read_fixture))::integer,2,'Returns list contains only completed returns for completed non-deleted sales in the selected Branch');
select extensions.is(((select list_result->>'returnedAmount' from sellertray_returns_read_fixture))::numeric,750::numeric,'Returns aggregate amount covers the full selected-Branch filtered set');
select extensions.is(((select list_result->>'returnedLines' from sellertray_returns_read_fixture))::integer,3,'Returns aggregate line count covers immutable returned lines');
select extensions.ok(
  ((select page_result->>'totalCount' from sellertray_returns_read_fixture))::integer=2
  and ((select page_result->>'returnedAmount' from sellertray_returns_read_fixture))::numeric=750::numeric
  and jsonb_array_length((select page_result->'items' from sellertray_returns_read_fixture))=1,
  'Returns paging preserves full-result aggregates independently from page size'
);
select extensions.is((select page_result->'items'->0->>'publicOrderId' from sellertray_returns_read_fixture),'RETREAD/1001','Returns first page follows deterministic newest-return ordering');
select extensions.is((select page_two_result->'items'->0->>'publicOrderId' from sellertray_returns_read_fixture),'RETREAD/1002','Returns offset paging advances deterministically through the filtered set');

select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'RETREAD/ALT',50,0)->>'totalCount')::integer,0,'Returns list excludes returns from another Branch');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'RETREAD/FOREIGN',50,0)->>'totalCount')::integer,0,'Returns list excludes returns from another Business');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'RETREAD/OPEN',50,0)->>'totalCount')::integer,0,'Returns list excludes return rows attached to non-completed orders');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'RETREAD/DELETED',50,0)->>'totalCount')::integer,0,'Returns list excludes return artifacts attached to soft-deleted POS drafts');
select extensions.ok(position('9991000000001' in (select list_result::text from sellertray_returns_read_fixture))=0,'Returns list does not expose raw WhatsApp identity');

select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'RETREAD/1001',50,0)->>'totalCount')::integer,1,'Returns search matches public order ID server-side');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Ada Returns',50,0)->>'totalCount')::integer,1,'Returns search matches governed customer display name server-side');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Damaged seal',50,0)->>'totalCount')::integer,1,'Returns search matches immutable return reason server-side');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Blue Paint Historic',50,0)->>'totalCount')::integer,1,'Returns search matches immutable returned-product snapshot server-side');

select extensions.is(jsonb_array_length((select detail_result->'items' from sellertray_returns_read_fixture)),2,'Return detail loads all immutable returned lines through the governed read model');
select extensions.ok(
  (select detail_result->>'publicOrderId' from sellertray_returns_read_fixture)='RETREAD/1001'
  and ((select detail_result->>'returnedAmount' from sellertray_returns_read_fixture))::numeric=300::numeric
  and (select detail_result->>'reason' from sellertray_returns_read_fixture)='Damaged seal',
  'Return detail preserves immutable return header evidence'
);
select extensions.ok(
  exists(select 1 from sellertray_returns_read_fixture f,jsonb_array_elements(f.detail_result->'items') item
    where item->>'itemName'='Blue Paint Historic' and item->>'selectedUom'='Box'
      and (item->>'returnedQuantity')::numeric=1.5 and (item->>'conversionFactor')::numeric=12
      and (item->>'returnedStockQuantity')::numeric=18 and (item->>'unitPrice')::numeric=100 and (item->>'lineAmount')::numeric=150),
  'Return detail preserves historical UOM, quantity, conversion and refund snapshot'
);
select extensions.ok(
  exists(select 1 from sellertray_returns_read_fixture f,jsonb_array_elements(f.detail_result->'items') item
    where item->>'itemName'='Brush Historic' and item->>'selectedUom'='Each'
      and (item->>'returnedQuantity')::numeric=3 and (item->>'returnedStockQuantity')::numeric=3 and (item->>'lineAmount')::numeric=150),
  'Return detail preserves each immutable line independently for partial returns'
);
select extensions.ok(position('9991000000001' in (select detail_result::text from sellertray_returns_read_fixture))=0,'Return detail does not expose raw WhatsApp identity');

select extensions.throws_ok(
  format('select public.get_sellertray_return_management_detail(%L::uuid,%L::uuid,%L::uuid)',
    (select tenant_id::text from sellertray_returns_read_fixture),(select other_branch_id::text from sellertray_returns_read_fixture),(select primary_return_id::text from sellertray_returns_read_fixture)),
  'P0002','Return not found','Return detail fails closed across Branch boundaries'
);

select set_config('request.jwt.claim.sub',(select manager_user_id::text from sellertray_returns_read_fixture),true);
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),null,50,0)->>'totalCount')::integer,2,'Manager can use governed Returns management list');
select extensions.is(jsonb_array_length(public.get_sellertray_return_management_detail((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),(select primary_return_id from sellertray_returns_read_fixture))->'items'),2,'Manager can inspect governed immutable return detail');

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_returns_read_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_returns_management_list(%L::uuid,%L::uuid,null,50,0)',(select tenant_id::text from sellertray_returns_read_fixture),(select branch_id::text from sellertray_returns_read_fixture)),
  '42501','Owner or Manager access is required to manage returns','Cashier/Staff cannot use the Returns management list'
);
select extensions.throws_ok(
  format('select public.get_sellertray_return_management_detail(%L::uuid,%L::uuid,%L::uuid)',(select tenant_id::text from sellertray_returns_read_fixture),(select branch_id::text from sellertray_returns_read_fixture),(select primary_return_id::text from sellertray_returns_read_fixture)),
  '42501','Owner or Manager access is required to manage returns','Cashier/Staff cannot use Returns management detail'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_returns_read_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_returns_management_list(%L::uuid,%L::uuid,null,50,0)',(select other_tenant_id::text from sellertray_returns_read_fixture),(select foreign_branch_id::text from sellertray_returns_read_fixture)),
  '42501','Owner or Manager access is required to manage returns','Returns management fails closed across Business boundaries'
);
select extensions.throws_ok(
  format('select public.get_sellertray_returns_management_list(%L::uuid,%L::uuid,null,50,0)',(select tenant_id::text from sellertray_returns_read_fixture),(select foreign_branch_id::text from sellertray_returns_read_fixture)),
  'P0002','Branch not found','Returns management rejects a Branch outside the selected Business'
);
select extensions.throws_ok(
  format('select public.get_sellertray_returns_management_list(%L::uuid,null,null,50,0)',(select tenant_id::text from sellertray_returns_read_fixture)),
  '22023','Business and Branch are required','Returns management requires explicit Branch scope'
);

select * from extensions.finish();
rollback;