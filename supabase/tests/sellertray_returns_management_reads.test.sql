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
  primary_order_id uuid,
  secondary_order_id uuid,
  alt_order_id uuid,
  open_order_id uuid,
  deleted_order_id uuid,
  foreign_order_id uuid,
  primary_return_id uuid not null,
  primary_public_order_id text,
  secondary_public_order_id text,
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

-- Alternate units are configured through the same persisted UOM model used by
-- SellerTray commerce. The stock-UOM rows already exist via the product trigger.
insert into public.catalog_item_uoms(
  tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,
  is_default_selling,is_default_purchase
)
select ci.tenant_id,ci.id,'Box',12,100,true,false,false
from public.catalog_items ci
join sellertray_returns_read_fixture f on f.tenant_id=ci.tenant_id
where ci.sku='RET-BLUE'
union all
select ci.tenant_id,ci.id,'Carton',6,450,true,false,false
from public.catalog_items ci
join sellertray_returns_read_fixture f on f.tenant_id=ci.tenant_id
where ci.sku='RET-RED';

-- Public order references are server-assigned. Supplied values are not used for
-- fixture lookup or assertions.
insert into public.orders(
  tenant_id,customer_id,branch_id,public_order_id,status,source,total_amount,amount_paid,payment_status,created_at
)
select tenant_id,customer_id,branch_id,'IGNORED-PRIMARY','completed','pos',450,450,'paid',now()-interval '10 days' from sellertray_returns_read_fixture
union all
select tenant_id,second_customer_id,branch_id,'IGNORED-SECONDARY','completed','whatsapp',450,450,'paid',now()-interval '9 days' from sellertray_returns_read_fixture
union all
select tenant_id,customer_id,other_branch_id,'IGNORED-ALT','completed','pos',800,800,'paid',now()-interval '8 days' from sellertray_returns_read_fixture
union all
select tenant_id,customer_id,branch_id,'IGNORED-OPEN','accepted','pos',111,111,'paid',now()-interval '7 days' from sellertray_returns_read_fixture
union all
select tenant_id,customer_id,branch_id,'IGNORED-DELETED','draft','pos',222,222,'paid',now()-interval '5 days' from sellertray_returns_read_fixture
union all
select other_tenant_id,foreign_customer_id,foreign_branch_id,'IGNORED-FOREIGN','completed','pos',900,900,'paid',now()-interval '6 days' from sellertray_returns_read_fixture;

update sellertray_returns_read_fixture f
set primary_order_id=(
      select o.id from public.orders o
      where o.tenant_id=f.tenant_id and o.branch_id=f.branch_id and o.status='completed' and o.source='pos' and o.total_amount=450
      limit 1
    ),
    secondary_order_id=(
      select o.id from public.orders o
      where o.tenant_id=f.tenant_id and o.branch_id=f.branch_id and o.status='completed' and o.source='whatsapp' and o.total_amount=450
      limit 1
    ),
    alt_order_id=(
      select o.id from public.orders o
      where o.tenant_id=f.tenant_id and o.branch_id=f.other_branch_id and o.status='completed' and o.total_amount=800
      limit 1
    ),
    open_order_id=(
      select o.id from public.orders o
      where o.tenant_id=f.tenant_id and o.branch_id=f.branch_id and o.status='accepted' and o.total_amount=111
      limit 1
    ),
    deleted_order_id=(
      select o.id from public.orders o
      where o.tenant_id=f.tenant_id and o.branch_id=f.branch_id and o.status='draft' and o.source='pos' and o.total_amount=222
      limit 1
    ),
    foreign_order_id=(
      select o.id from public.orders o
      where o.tenant_id=f.other_tenant_id and o.branch_id=f.foreign_branch_id and o.status='completed' and o.total_amount=900
      limit 1
    );

update sellertray_returns_read_fixture f
set primary_public_order_id=o1.public_order_id,
    secondary_public_order_id=o2.public_order_id
from public.orders o1,public.orders o2
where o1.id=f.primary_order_id and o2.id=f.secondary_order_id;

-- order_items.line_total is database-generated. UOM snapshots below are valid
-- against the configured product UOM rows above.
insert into public.order_items(
  tenant_id,order_id,catalog_item_id,item_name,quantity,unit_price,selected_uom,conversion_factor,stock_quantity
)
select f.tenant_id,f.primary_order_id,ci.id,'Current Blue Paint',2,100,'Box',12,24
from sellertray_returns_read_fixture f
join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-BLUE'
union all
select f.tenant_id,f.primary_order_id,ci.id,'Current Brush',5,50,'Each',1,5
from sellertray_returns_read_fixture f
join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-BRUSH'
union all
select f.tenant_id,f.secondary_order_id,ci.id,'Current Red Paint',1,450,'Carton',6,6
from sellertray_returns_read_fixture f
join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-RED'
union all
select f.tenant_id,f.alt_order_id,ci.id,'Current Red Paint',1,800,'Each',1,1
from sellertray_returns_read_fixture f
join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-RED'
union all
select f.tenant_id,f.open_order_id,ci.id,'Current Red Paint',1,111,'Each',1,1
from sellertray_returns_read_fixture f
join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-RED'
union all
select f.tenant_id,f.deleted_order_id,ci.id,'Current Red Paint',1,222,'Each',1,1
from sellertray_returns_read_fixture f
join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-RED'
union all
select f.other_tenant_id,f.foreign_order_id,ci.id,'Foreign Current Product',1,900,'Each',1,1
from sellertray_returns_read_fixture f
join public.catalog_items ci on ci.tenant_id=f.other_tenant_id and ci.sku='RET-FOREIGN';

insert into public.order_financial_documents(
  tenant_id,order_id,document_type,document_reference,currency,amount,status,issued_at
)
select o.tenant_id,o.id,'invoice','INV-RETREAD-'||substr(o.id::text,1,8),'NGN',o.total_amount,'issued',o.created_at
from public.orders o
join sellertray_returns_read_fixture f
  on o.id in (f.primary_order_id,f.secondary_order_id,f.alt_order_id,f.open_order_id,f.deleted_order_id);

insert into public.order_payments(
  tenant_id,order_id,invoice_document_id,method_type,provider,status,amount,currency,
  confirmed_at,confirmation_source,created_at,updated_at
)
select o.tenant_id,o.id,d.id,'cash','pos_cash','confirmed',o.total_amount,'NGN',
       o.created_at+interval '5 minutes','system',o.created_at+interval '5 minutes',o.created_at+interval '5 minutes'
from public.orders o
join sellertray_returns_read_fixture f
  on o.id in (f.primary_order_id,f.secondary_order_id,f.alt_order_id,f.open_order_id,f.deleted_order_id)
join public.order_financial_documents d
  on d.tenant_id=o.tenant_id and d.order_id=o.id and d.document_type='invoice';

-- Return rows use an accountable owner actor as required by governed return authority.
insert into public.sale_returns(
  id,tenant_id,branch_id,order_id,original_payment_id,return_type,status,amount,currency,reason,actor_user_id,created_at
)
select f.primary_return_id,f.tenant_id,f.branch_id,f.primary_order_id,p.id,'partial','completed',300,'NGN','Damaged seal',f.owner_user_id,now()-interval '1 hour'
from sellertray_returns_read_fixture f
join public.order_payments p on p.tenant_id=f.tenant_id and p.order_id=f.primary_order_id
union all
select gen_random_uuid(),f.tenant_id,f.branch_id,f.secondary_order_id,p.id,'partial','completed',450,'NGN','Wrong shade',f.owner_user_id,now()-interval '2 hours'
from sellertray_returns_read_fixture f
join public.order_payments p on p.tenant_id=f.tenant_id and p.order_id=f.secondary_order_id
union all
select gen_random_uuid(),f.tenant_id,f.other_branch_id,f.alt_order_id,p.id,'partial','completed',800,'NGN','Alternate Branch return',f.owner_user_id,now()-interval '30 minutes'
from sellertray_returns_read_fixture f
join public.order_payments p on p.tenant_id=f.tenant_id and p.order_id=f.alt_order_id
union all
select gen_random_uuid(),f.tenant_id,f.branch_id,f.open_order_id,p.id,'partial','completed',111,'NGN','Non-completed order fixture',f.owner_user_id,now()-interval '3 hours'
from sellertray_returns_read_fixture f
join public.order_payments p on p.tenant_id=f.tenant_id and p.order_id=f.open_order_id
union all
select gen_random_uuid(),f.tenant_id,f.branch_id,f.deleted_order_id,p.id,'partial','completed',222,'NGN','Deleted draft fixture',f.owner_user_id,now()-interval '4 hours'
from sellertray_returns_read_fixture f
join public.order_payments p on p.tenant_id=f.tenant_id and p.order_id=f.deleted_order_id;

-- sale_return_items.line_total is immutable historical refund evidence.
insert into public.sale_return_items(
  tenant_id,sale_return_id,order_item_id,catalog_item_id,product_name,selected_uom,
  quantity,conversion_factor,stock_quantity,unit_price,line_total,created_at
)
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Blue Paint Historic','Box',1.5,12,18,100,150,r.created_at
from sellertray_returns_read_fixture f
join public.sale_returns r on r.tenant_id=f.tenant_id and r.order_id=f.primary_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id and oi.item_name='Current Blue Paint'
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Brush Historic','Each',3,1,3,50,150,r.created_at+interval '1 second'
from sellertray_returns_read_fixture f
join public.sale_returns r on r.tenant_id=f.tenant_id and r.order_id=f.primary_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id and oi.item_name='Current Brush'
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Red Paint Historic','Carton',1,6,6,450,450,r.created_at
from sellertray_returns_read_fixture f
join public.sale_returns r on r.tenant_id=f.tenant_id and r.order_id=f.secondary_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Alternate Branch Historic','Each',1,1,1,800,800,r.created_at
from sellertray_returns_read_fixture f
join public.sale_returns r on r.tenant_id=f.tenant_id and r.order_id=f.alt_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Open Order Historic','Each',1,1,1,111,111,r.created_at
from sellertray_returns_read_fixture f
join public.sale_returns r on r.tenant_id=f.tenant_id and r.order_id=f.open_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Deleted Order Historic','Each',1,1,1,222,222,r.created_at
from sellertray_returns_read_fixture f
join public.sale_returns r on r.tenant_id=f.tenant_id and r.order_id=f.deleted_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id;

-- A soft-deleted sales artifact is valid only as a POS draft. It is deleted after
-- fixture payment/return creation so payment projection triggers do not touch an
-- already deleted order.
update public.orders o
set deleted_at=now()-interval '1 day',
    deleted_by_user_id=f.owner_user_id,
    deletion_reason='Historical fixture exclusion',
    deletion_command_hash='abcdef0123456789abcdef0123456789'
from sellertray_returns_read_fixture f
where o.id=f.deleted_order_id;

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
select extensions.is((select page_result->'items'->0->>'publicOrderId' from sellertray_returns_read_fixture),(select primary_public_order_id from sellertray_returns_read_fixture),'Returns first page follows deterministic newest-return ordering');
select extensions.is((select page_two_result->'items'->0->>'publicOrderId' from sellertray_returns_read_fixture),(select secondary_public_order_id from sellertray_returns_read_fixture),'Returns offset paging advances deterministically through the filtered set');

select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Alternate Branch return',50,0)->>'totalCount')::integer,0,'Returns list excludes returns from another Branch');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Foreign Returns',50,0)->>'totalCount')::integer,0,'Returns list excludes another Business customer identity');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Non-completed order fixture',50,0)->>'totalCount')::integer,0,'Returns list excludes return rows attached to non-completed orders');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Deleted draft fixture',50,0)->>'totalCount')::integer,0,'Returns list excludes return artifacts attached to soft-deleted POS drafts');
select extensions.ok(position('9991000000001' in (select list_result::text from sellertray_returns_read_fixture))=0,'Returns list does not expose raw WhatsApp identity');

select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),(select primary_public_order_id from sellertray_returns_read_fixture),50,0)->>'totalCount')::integer,1,'Returns search matches the actual server-generated public order ID');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Ada Returns',50,0)->>'totalCount')::integer,1,'Returns search matches governed customer display name server-side');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Damaged seal',50,0)->>'totalCount')::integer,1,'Returns search matches immutable return reason server-side');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from sellertray_returns_read_fixture),(select branch_id from sellertray_returns_read_fixture),'Blue Paint Historic',50,0)->>'totalCount')::integer,1,'Returns search matches immutable returned-product snapshot server-side');

select extensions.is(jsonb_array_length((select detail_result->'items' from sellertray_returns_read_fixture)),2,'Return detail loads all immutable returned lines through the governed read model');
select extensions.ok(
  (select detail_result->>'publicOrderId' from sellertray_returns_read_fixture)=(select primary_public_order_id from sellertray_returns_read_fixture)
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