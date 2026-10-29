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

create temp table returns_read_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_id uuid not null,
  manager_id uuid not null,
  staff_id uuid not null,
  branch_id uuid,
  alt_branch_id uuid,
  foreign_branch_id uuid,
  customer_a uuid not null,
  customer_b uuid not null,
  primary_order_id uuid,
  secondary_order_id uuid,
  alt_order_id uuid,
  primary_return_id uuid not null,
  primary_order_ref text,
  secondary_order_ref text,
  list_result jsonb,
  page_one jsonb,
  page_two jsonb,
  detail_result jsonb
) on commit drop;

insert into returns_read_fixture(
  tenant_id,other_tenant_id,owner_id,manager_id,staff_id,customer_a,customer_b,primary_return_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'returns-owner-'||substr(owner_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from returns_read_fixture
union all
select manager_id,'returns-manager-'||substr(manager_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from returns_read_fixture
union all
select staff_id,'returns-staff-'||substr(staff_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from returns_read_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Returns Management Test','returns-read-'||substr(tenant_id::text,1,8),'RTR','active' from returns_read_fixture
union all
select other_tenant_id,'Foreign Returns Test','foreign-returns-'||substr(other_tenant_id::text,1,8),'RTX','active' from returns_read_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (
  select tenant_id from returns_read_fixture
  union all select other_tenant_id from returns_read_fixture
);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from returns_read_fixture
union all select tenant_id,manager_id,'manager' from returns_read_fixture
union all select tenant_id,staff_id,'staff' from returns_read_fixture;

update returns_read_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;
update returns_read_fixture f
set foreign_branch_id=b.id
from public.branches b
where b.tenant_id=f.other_tenant_id and b.is_default=true;
with inserted as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'ALT','Returns Alternate Branch',false,true from returns_read_fixture
  returning id
)
update returns_read_fixture set alt_branch_id=(select id from inserted);

insert into public.customers(id,tenant_id,wa_id,display_name,phone,email,created_at,updated_at)
select customer_a,tenant_id,'9991000000001','Ada Returns','+2348011111111','ada-returns@example.com',now()-interval '20 days',now() from returns_read_fixture
union all
select customer_b,tenant_id,'9991000000002','Chidi Returns','+2348022222222','chidi-returns@example.com',now()-interval '20 days',now() from returns_read_fixture;

insert into public.catalog_items(tenant_id,name,sku,price_ngn,stock_uom,allow_fractional_stock)
select tenant_id,'Current Blue Paint','RET-BLUE',100,'Each',true from returns_read_fixture
union all
select tenant_id,'Current Brush','RET-BRUSH',50,'Each',true from returns_read_fixture
union all
select tenant_id,'Current Red Paint','RET-RED',450,'Each',true from returns_read_fixture;

insert into public.catalog_item_uoms(
  tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_selling,is_default_purchase
)
select ci.tenant_id,ci.id,'Box',12,100,true,false,false
from public.catalog_items ci join returns_read_fixture f on f.tenant_id=ci.tenant_id
where ci.sku='RET-BLUE'
union all
select ci.tenant_id,ci.id,'Carton',6,450,true,false,false
from public.catalog_items ci join returns_read_fixture f on f.tenant_id=ci.tenant_id
where ci.sku='RET-RED';

-- Orders begin genuinely unpaid. Confirmed order_payments below are the single
-- authority that establishes settlement; the fixture never pre-writes paid truth.
insert into public.orders(tenant_id,customer_id,branch_id,public_order_id,status,source,total_amount,created_at)
select tenant_id,customer_a,branch_id,'IGNORED-A','completed','pos',450,now()-interval '10 days' from returns_read_fixture
union all
select tenant_id,customer_b,branch_id,'IGNORED-B','completed','whatsapp',450,now()-interval '9 days' from returns_read_fixture
union all
select tenant_id,customer_a,alt_branch_id,'IGNORED-ALT','completed','pos',800,now()-interval '8 days' from returns_read_fixture;

update returns_read_fixture f
set primary_order_id=(select o.id from public.orders o where o.tenant_id=f.tenant_id and o.branch_id=f.branch_id and o.source='pos' and o.total_amount=450 limit 1),
    secondary_order_id=(select o.id from public.orders o where o.tenant_id=f.tenant_id and o.branch_id=f.branch_id and o.source='whatsapp' and o.total_amount=450 limit 1),
    alt_order_id=(select o.id from public.orders o where o.tenant_id=f.tenant_id and o.branch_id=f.alt_branch_id and o.total_amount=800 limit 1);

update returns_read_fixture f
set primary_order_ref=p.public_order_id,secondary_order_ref=s.public_order_id
from public.orders p,public.orders s
where p.id=f.primary_order_id and s.id=f.secondary_order_id;

insert into public.order_items(tenant_id,order_id,catalog_item_id,item_name,quantity,unit_price,selected_uom,conversion_factor,stock_quantity)
select f.tenant_id,f.primary_order_id,ci.id,'Current Blue Paint',2,100,'Box',12,24
from returns_read_fixture f join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-BLUE'
union all
select f.tenant_id,f.primary_order_id,ci.id,'Current Brush',5,50,'Each',1,5
from returns_read_fixture f join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-BRUSH'
union all
select f.tenant_id,f.secondary_order_id,ci.id,'Current Red Paint',1,450,'Carton',6,6
from returns_read_fixture f join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-RED'
union all
select f.tenant_id,f.alt_order_id,ci.id,'Current Red Paint',1,800,'Each',1,1
from returns_read_fixture f join public.catalog_items ci on ci.tenant_id=f.tenant_id and ci.sku='RET-RED';

insert into public.order_financial_documents(tenant_id,order_id,document_type,document_reference,currency,amount,status,issued_at)
select o.tenant_id,o.id,'invoice','INV-RET-'||substr(o.id::text,1,8),'NGN',o.total_amount,'issued',o.created_at
from public.orders o join returns_read_fixture f on o.id in (f.primary_order_id,f.secondary_order_id,f.alt_order_id);

insert into public.order_payments(
  tenant_id,order_id,invoice_document_id,method_type,provider,status,amount,currency,confirmed_at,confirmation_source,created_at,updated_at
)
select o.tenant_id,o.id,d.id,'cash','pos_cash','confirmed',o.total_amount,'NGN',o.created_at+interval '5 minutes','system',o.created_at+interval '5 minutes',o.created_at+interval '5 minutes'
from public.orders o
join returns_read_fixture f on o.id in (f.primary_order_id,f.secondary_order_id,f.alt_order_id)
join public.order_financial_documents d on d.tenant_id=o.tenant_id and d.order_id=o.id and d.document_type='invoice';

insert into public.sale_returns(
  id,tenant_id,branch_id,order_id,original_payment_id,return_type,status,amount,currency,reason,actor_user_id,created_at
)
select f.primary_return_id,f.tenant_id,f.branch_id,f.primary_order_id,p.id,'partial','completed',300,'NGN','Damaged seal',f.owner_id,now()-interval '1 hour'
from returns_read_fixture f join public.order_payments p on p.tenant_id=f.tenant_id and p.order_id=f.primary_order_id
union all
select gen_random_uuid(),f.tenant_id,f.branch_id,f.secondary_order_id,p.id,'partial','completed',450,'NGN','Wrong shade',f.owner_id,now()-interval '2 hours'
from returns_read_fixture f join public.order_payments p on p.tenant_id=f.tenant_id and p.order_id=f.secondary_order_id
union all
select gen_random_uuid(),f.tenant_id,f.alt_branch_id,f.alt_order_id,p.id,'partial','completed',800,'NGN','Alternate Branch return',f.owner_id,now()-interval '30 minutes'
from returns_read_fixture f join public.order_payments p on p.tenant_id=f.tenant_id and p.order_id=f.alt_order_id;

insert into public.sale_return_items(
  tenant_id,sale_return_id,order_item_id,catalog_item_id,product_name,selected_uom,quantity,conversion_factor,stock_quantity,unit_price,line_total,created_at
)
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Blue Paint Historic','Box',1.5,12,18,100,150,r.created_at
from returns_read_fixture f join public.sale_returns r on r.order_id=f.primary_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id and oi.item_name='Current Blue Paint'
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Brush Historic','Each',3,1,3,50,150,r.created_at+interval '1 second'
from returns_read_fixture f join public.sale_returns r on r.order_id=f.primary_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id and oi.item_name='Current Brush'
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Red Paint Historic','Carton',1,6,6,450,450,r.created_at
from returns_read_fixture f join public.sale_returns r on r.order_id=f.secondary_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id
union all
select r.tenant_id,r.id,oi.id,oi.catalog_item_id,'Alternate Branch Historic','Each',1,1,1,800,800,r.created_at
from returns_read_fixture f join public.sale_returns r on r.order_id=f.alt_order_id
join public.order_items oi on oi.tenant_id=r.tenant_id and oi.order_id=r.order_id;

select set_config('request.jwt.claim.sub',(select owner_id::text from returns_read_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
update returns_read_fixture
set list_result=public.get_sellertray_returns_management_list(tenant_id,branch_id,null,50,0),
    page_one=public.get_sellertray_returns_management_list(tenant_id,branch_id,null,1,0),
    page_two=public.get_sellertray_returns_management_list(tenant_id,branch_id,null,1,1),
    detail_result=public.get_sellertray_return_management_detail(tenant_id,branch_id,primary_return_id);

select extensions.is(((select list_result->>'totalCount' from returns_read_fixture))::integer,2,'Selected Branch returns list contains both governed completed returns');
select extensions.is(((select list_result->>'returnedAmount' from returns_read_fixture))::numeric,750::numeric,'Returns aggregate amount covers the full filtered result');
select extensions.is(((select list_result->>'returnedLines' from returns_read_fixture))::integer,3,'Returns aggregate line count covers all immutable returned lines');
select extensions.ok(
  ((select page_one->>'totalCount' from returns_read_fixture))::integer=2
  and ((select page_one->>'returnedAmount' from returns_read_fixture))::numeric=750
  and jsonb_array_length((select page_one->'items' from returns_read_fixture))=1,
  'Paging does not truncate full-result aggregates'
);
select extensions.is((select page_one->'items'->0->>'publicOrderId' from returns_read_fixture),(select primary_order_ref from returns_read_fixture),'Newest selected-Branch return is page one');
select extensions.is((select page_two->'items'->0->>'publicOrderId' from returns_read_fixture),(select secondary_order_ref from returns_read_fixture),'Offset paging advances deterministically');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from returns_read_fixture),(select branch_id from returns_read_fixture),'Alternate Branch return',50,0)->>'totalCount')::integer,0,'Selected Branch list excludes another Branch return');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from returns_read_fixture),(select alt_branch_id from returns_read_fixture),null,50,0)->>'totalCount')::integer,1,'Owner can read the explicitly selected alternate Branch without mixing Branches');
select extensions.ok(position('9991000000001' in (select list_result::text from returns_read_fixture))=0,'Returns list does not expose raw WhatsApp identity');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from returns_read_fixture),(select branch_id from returns_read_fixture),(select primary_order_ref from returns_read_fixture),50,0)->>'totalCount')::integer,1,'Search matches server-generated order reference');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from returns_read_fixture),(select branch_id from returns_read_fixture),'Ada Returns',50,0)->>'totalCount')::integer,1,'Search matches governed customer name');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from returns_read_fixture),(select branch_id from returns_read_fixture),'Damaged seal',50,0)->>'totalCount')::integer,1,'Search matches immutable return reason');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from returns_read_fixture),(select branch_id from returns_read_fixture),'Blue Paint Historic',50,0)->>'totalCount')::integer,1,'Search matches immutable returned-product snapshot');
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from returns_read_fixture),(select branch_id from returns_read_fixture),'No matching return',50,0)->>'totalCount')::integer,0,'Search fails closed when no return matches');

select extensions.is(jsonb_array_length((select detail_result->'items' from returns_read_fixture)),2,'Return detail includes every immutable returned line');
select extensions.ok(
  (select detail_result->>'publicOrderId' from returns_read_fixture)=(select primary_order_ref from returns_read_fixture)
  and ((select detail_result->>'returnedAmount' from returns_read_fixture))::numeric=300
  and (select detail_result->>'reason' from returns_read_fixture)='Damaged seal',
  'Return detail preserves immutable header evidence'
);
select extensions.ok(
  exists(select 1 from returns_read_fixture f,jsonb_array_elements(f.detail_result->'items') i
    where i->>'itemName'='Blue Paint Historic' and i->>'selectedUom'='Box'
      and (i->>'returnedQuantity')::numeric=1.5 and (i->>'conversionFactor')::numeric=12
      and (i->>'returnedStockQuantity')::numeric=18 and (i->>'unitPrice')::numeric=100 and (i->>'lineAmount')::numeric=150),
  'Return detail preserves historical Box quantity, stock conversion and refund value'
);
select extensions.ok(
  exists(select 1 from returns_read_fixture f,jsonb_array_elements(f.detail_result->'items') i
    where i->>'itemName'='Brush Historic' and i->>'selectedUom'='Each'
      and (i->>'returnedQuantity')::numeric=3 and (i->>'returnedStockQuantity')::numeric=3 and (i->>'lineAmount')::numeric=150),
  'Return detail preserves each partial-return line independently'
);
select extensions.ok(position('9991000000001' in (select detail_result::text from returns_read_fixture))=0,'Return detail does not expose raw WhatsApp identity');
select extensions.throws_ok(
  format('select public.get_sellertray_return_management_detail(%L::uuid,%L::uuid,%L::uuid)',(select tenant_id::text from returns_read_fixture),(select alt_branch_id::text from returns_read_fixture),(select primary_return_id::text from returns_read_fixture)),
  'P0002','Return not found','Return detail fails closed across Branch boundaries'
);

select set_config('request.jwt.claim.sub',(select manager_id::text from returns_read_fixture),true);
select extensions.is((public.get_sellertray_returns_management_list((select tenant_id from returns_read_fixture),(select branch_id from returns_read_fixture),null,50,0)->>'totalCount')::integer,2,'Manager can use governed Returns management list');
select extensions.is(jsonb_array_length(public.get_sellertray_return_management_detail((select tenant_id from returns_read_fixture),(select branch_id from returns_read_fixture),(select primary_return_id from returns_read_fixture))->'items'),2,'Manager can inspect immutable return detail');

select set_config('request.jwt.claim.sub',(select staff_id::text from returns_read_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_returns_management_list(%L::uuid,%L::uuid,null,50,0)',(select tenant_id::text from returns_read_fixture),(select branch_id::text from returns_read_fixture)),
  '42501','Owner or Manager access is required to manage returns','Cashier/Staff cannot use Returns management list'
);
select extensions.throws_ok(
  format('select public.get_sellertray_return_management_detail(%L::uuid,%L::uuid,%L::uuid)',(select tenant_id::text from returns_read_fixture),(select branch_id::text from returns_read_fixture),(select primary_return_id::text from returns_read_fixture)),
  '42501','Owner or Manager access is required to manage returns','Cashier/Staff cannot inspect Returns management detail'
);

select set_config('request.jwt.claim.sub',(select owner_id::text from returns_read_fixture),true);
select extensions.throws_ok(
  format('select public.get_sellertray_returns_management_list(%L::uuid,%L::uuid,null,50,0)',(select other_tenant_id::text from returns_read_fixture),(select foreign_branch_id::text from returns_read_fixture)),
  '42501','Owner or Manager access is required to manage returns','Returns management fails closed across Business boundaries'
);
select extensions.throws_ok(
  format('select public.get_sellertray_returns_management_list(%L::uuid,%L::uuid,null,50,0)',(select tenant_id::text from returns_read_fixture),(select foreign_branch_id::text from returns_read_fixture)),
  'P0002','Branch not found','Returns management rejects a Branch outside the selected Business'
);
select extensions.throws_ok(
  format('select public.get_sellertray_returns_management_list(%L::uuid,null,null,50,0)',(select tenant_id::text from returns_read_fixture)),
  '22023','Business and Branch are required','Returns management requires explicit Branch scope'
);
select extensions.ok(
  (select lower(pg_get_functiondef('public.get_sellertray_returns_management_list(uuid,uuid,text,integer,integer)'::regprocedure)) ~ 'o\.deleted_at[[:space:]]+is[[:space:]]+null')
  and (select lower(pg_get_functiondef('public.get_sellertray_returns_management_list(uuid,uuid,text,integer,integer)'::regprocedure)) ~ 'o\.status[[:space:]]*=[[:space:]]*''completed''')
  and (select lower(pg_get_functiondef('public.get_sellertray_return_management_detail(uuid,uuid,uuid)'::regprocedure)) ~ 'o\.deleted_at[[:space:]]+is[[:space:]]+null')
  and (select lower(pg_get_functiondef('public.get_sellertray_return_management_detail(uuid,uuid,uuid)'::regprocedure)) ~ 'o\.status[[:space:]]*=[[:space:]]*''completed'''),
  'Both Returns management reads defensively require completed, non-deleted parent sales'
);

select * from extensions.finish();
rollback;