begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

-- A complete posted sale must produce real, independently verified COGS.
-- Fixture is local CI-only and rolls back. No Production merchant changes.
select set_config('request.jwt.claim.role','service_role',true);

create temp table profit_valued_fixture (
  tenant_id uuid default gen_random_uuid(),
  owner_id uuid default gen_random_uuid(),
  customer_id uuid default gen_random_uuid(),
  product_id uuid default gen_random_uuid(),
  order_id uuid default gen_random_uuid(),
  order_item_id uuid default gen_random_uuid(),
  branch_id uuid,
  location_id uuid,
  uom_id uuid,
  supplier_id uuid,
  purchase_order_id uuid,
  purchase_item_id uuid,
  receipt_id uuid,
  receipt_movement_id uuid,
  sale_movement_id uuid
) on commit drop;
insert into profit_valued_fixture default values;

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'profit-valued-'||owner_id||'@example.com',
       'authenticated','authenticated',now(),now()
from profit_valued_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Valued Sale Report QA','profit-valued-'||tenant_id,'PVA','active'
from profit_valued_fixture;
update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from profit_valued_fixture);
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from profit_valued_fixture;

update profit_valued_fixture f set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;
update profit_valued_fixture f set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.customers(id,tenant_id,wa_id,display_name)
select customer_id,tenant_id,'qa-valued:'||customer_id,'Valued Sale Customer'
from profit_valued_fixture;
insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Profitability Valued Product','PV-100',200,true,'Each',false
from profit_valued_fixture;

with ins as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,
    selling_price,allow_fractional,is_default_selling
  )
  select tenant_id,product_id,'Box',10,2000,false,false
  from profit_valued_fixture returning id
)
update profit_valued_fixture set uom_id=(select id from ins);

with ins as (
  insert into public.sellertray_suppliers(tenant_id,name,is_active)
  select tenant_id,'Valued Fixture Supplier',true from profit_valued_fixture
  returning id
)
update profit_valued_fixture set supplier_id=(select id from ins);
with ins as (
  insert into public.sellertray_purchase_orders(
    tenant_id,branch_id,supplier_id,reference,status,currency,total_amount
  )
  select tenant_id,branch_id,supplier_id,'PO-PROFIT-001','ordered','NGN',1000
  from profit_valued_fixture returning id
)
update profit_valued_fixture set purchase_order_id=(select id from ins);
with ins as (
  insert into public.sellertray_purchase_order_items(
    tenant_id,purchase_order_id,catalog_item_id,uom_id,product_name,sku,selected_uom,
    conversion_factor,ordered_quantity,ordered_stock_quantity,unit_cost,line_total
  )
  select tenant_id,purchase_order_id,product_id,uom_id,
    'Profitability Valued Product','PV-100','Box',
    10,1,10,1000,1000 from profit_valued_fixture returning id
)
update profit_valued_fixture set purchase_item_id=(select id from ins);
with ins as (
  insert into public.sellertray_purchase_receipts(
    tenant_id,purchase_order_id,branch_id,supplier_id,reference,items_fingerprint,received_at
  )
  select tenant_id,purchase_order_id,branch_id,supplier_id,
         'PR-PROFIT-001',md5('PR-PROFIT-001'),now()
  from profit_valued_fixture returning id
)
update profit_valued_fixture set receipt_id=(select id from ins);

update profit_valued_fixture
set receipt_movement_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'purchase_receipt',
  10,'Box',1,10,'purchase_receipt',receipt_id::text,
  'profitability:purchase:1',now()-interval '5 minutes',
  null,'Synthetic fully-valued receipt','{}'::jsonb,null
);
insert into public.sellertray_purchase_receipt_items(
  tenant_id,receipt_id,purchase_order_item_id,catalog_item_id,uom_id,
  selected_uom,conversion_factor,received_quantity,
  received_stock_quantity,inventory_movement_id
)
select tenant_id,receipt_id,purchase_item_id,product_id,uom_id,
  'Box',10,1,10,receipt_movement_id from profit_valued_fixture;

insert into public.orders(
  id,tenant_id,customer_id,branch_id,public_order_id,status,source,
  currency,total_amount,payment_status,amount_paid,fulfillment_status
)
select order_id,tenant_id,customer_id,branch_id,'PFQ/VALUED/0001',
       'completed','pos','NGN',400,'paid',400,'collected'
from profit_valued_fixture;
update profit_valued_fixture
set sale_movement_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'sale',
  -2,'Each',2,1,'order',order_id::text,'profitability:sale:1',
  now()-interval '1 minute',null,null,
  jsonb_build_object('order_id',order_id::text,'order_item_id',order_item_id::text),null
);

select extensions.is(
  (select stock_unit_cost from public.sellertray_purchase_receipt_items
   where inventory_movement_id=(select receipt_movement_id from profit_valued_fixture)),
  100::numeric,
  'Purchase receiving preserves verified Stock-UOM unit cost'
);
select extensions.ok(
  exists(select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select sale_movement_id from profit_valued_fixture)
      and ve.cogs_complete=true and ve.cogs_amount=200),
  'Posted sale has 2 Stock-UOM units of fully evidenced historical COGS'
);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select owner_id::text from profit_valued_fixture),true);

select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profit_valued_fixture))#>>'{summary,salesCount}')::integer,
  1,'Fully costed completed sale appears once'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profit_valued_fixture))#>>'{summary,netRevenue}')::numeric,
  400::numeric,'Revenue remains independent of cost accounting and receipt entries'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profit_valued_fixture))#>>'{summary,knownCogs}')::numeric,
  200::numeric,'Aggregated COGS equals immutable posted sale cost'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profit_valued_fixture))#>>'{summary,incompleteCostSales}')::integer,
  0,'Fully valued sale is not wrongly marked cost-incomplete'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profit_valued_fixture))#>>'{summary,grossProfit}')::numeric,
  200::numeric,'Gross profit is correctly published once all sales have verified COGS'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profit_valued_fixture))#>>'{summary,grossMarginPercent}')::numeric,
  50::numeric,'Verified gross margin is 50 percent'
);
select extensions.is(
  (public.get_sellertray_profitability_report((select tenant_id from profit_valued_fixture))#>>'{branches,0,grossProfit}')::numeric,
  200::numeric,'Branch detail reconciles to all-Branch report when only one Branch has sales'
);
select extensions.is(
  (public.get_sellertray_order_profitability(
    (select tenant_id from profit_valued_fixture),
    (select order_id from profit_valued_fixture)
  )#>>'{grossProfit}')::numeric,
  200::numeric,'New aggregate profit equals existing single-sale profitability authority'
);
select extensions.is(
  (public.get_sellertray_order_profitability(
    (select tenant_id from profit_valued_fixture),
    (select order_id from profit_valued_fixture)
  )#>>'{knownCogs}')::numeric,
  200::numeric,'New aggregate COGS equals existing single-sale immutable valuation'
);
select extensions.is(
  (public.get_sellertray_profitability_report(
    (select tenant_id from profit_valued_fixture),
    current_date-30,current_date-29
  )#>>'{summary,salesCount}')::integer,
  0,'Business period filter excludes a completed sale outside the selected range'
);

select * from extensions.finish();
rollback;
