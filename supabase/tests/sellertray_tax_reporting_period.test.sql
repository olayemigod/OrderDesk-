begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

create temp table sellertray_tax_period_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  register_id uuid,
  pack_uom_id uuid,
  order_id uuid,
  return_result jsonb
) on commit drop;

insert into sellertray_tax_period_fixture(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'tax-period-'||substr(owner_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from sellertray_tax_period_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Tax Period Test',
       'sellertray-tax-period-'||substr(tenant_id::text,1,8),'TXP','active'
from sellertray_tax_period_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_tax_period_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_tax_period_fixture;

update sellertray_tax_period_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_tax_period_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

update sellertray_tax_period_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Tax Period Drink','TAX-PERIOD',100,true,'Bottle',false
from sellertray_tax_period_fixture;

with inserted_uom as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,
    allow_fractional,is_default_selling
  )
  select tenant_id,product_id,'Pack',12,1050,false,false
  from sellertray_tax_period_fixture
  returning id
)
update sellertray_tax_period_fixture set pack_uom_id=(select id from inserted_uom);

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',96,'Bottle',96,1,
  'opening_stock','TAX-PERIOD-OPENING','opening:TAX-PERIOD-OPENING',
  now(),owner_user_id,'Opening stock for tax period regression','{}'::jsonb,null
)
from sellertray_tax_period_fixture;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_tax_period_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select public.save_sellertray_tax_settings(
  (select tenant_id from sellertray_tax_period_fixture),true,7.5,true
);

update sellertray_tax_period_fixture
set order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Tax reporting period sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',pack_uom_id,'quantity',2
  ))
);

-- Period A is order capture. It must not become the tax reporting period.
update public.orders o
set created_at=((current_date-10)::timestamp at time zone 'Africa/Lagos')
where o.id=(select order_id from sellertray_tax_period_fixture);

select public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,0,owner_user_id
)
from sellertray_tax_period_fixture;

set local request.jwt.claim.role='service_role';
select public.complete_sellertray_pos_cash_sale(
  tenant_id,order_id,owner_user_id
)
from sellertray_tax_period_fixture;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_tax_period_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.is(
  (public.get_sellertray_tax_report_summary(
    (select tenant_id from sellertray_tax_period_fixture),current_date-10,current_date-10,null,'pos'
  )->>'salesTax')::numeric,
  0::numeric,
  'order creation period does not recognise tax before finalisation'
);

select extensions.is(
  (public.get_sellertray_tax_report_summary(
    (select tenant_id from sellertray_tax_period_fixture),current_date,current_date,null,'pos'
  )->>'salesTax')::numeric,
  157.50::numeric,
  'tax is recognised in the immutable posting period'
);

select public.save_sellertray_tax_settings(
  (select tenant_id from sellertray_tax_period_fixture),true,10,false
);

set local request.jwt.claim.role='service_role';
update sellertray_tax_period_fixture
set return_result=public.return_sellertray_pos_cash_sale(
  tenant_id,order_id,owner_user_id,'Cross-period historical tax return',
  jsonb_build_array(jsonb_build_object('orderItemId',(
    select oi.id from public.order_items oi
    where oi.order_id=order_id order by oi.id limit 1
  ),'quantity',1)),
  'tax-period-return-1'
);

-- Period C is the completed return event. Move the fixture clock forward so the
-- report regression can prove sale posting and tax reversal are independent.
update public.sale_returns sr
set created_at=((current_date+10)::timestamp at time zone 'Africa/Lagos')
where sr.id=(select (return_result->>'returnId')::uuid from sellertray_tax_period_fixture);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_tax_period_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.is(
  (public.get_sellertray_tax_report_summary(
    (select tenant_id from sellertray_tax_period_fixture),current_date,current_date,null,'pos'
  )->>'returnedTax')::numeric,
  0::numeric,
  'sale posting period does not recognise a later tax reversal'
);

select extensions.is(
  (public.get_sellertray_tax_report_summary(
    (select tenant_id from sellertray_tax_period_fixture),current_date+10,current_date+10,null,'pos'
  )->>'salesTax')::numeric,
  0::numeric,
  'return period does not re-recognise the original sale tax'
);

select extensions.is(
  (public.get_sellertray_tax_report_summary(
    (select tenant_id from sellertray_tax_period_fixture),current_date+10,current_date+10,null,'pos'
  )->>'returnedTax')::numeric,
  78.75::numeric,
  'return period recognises the historical tax reversal despite current rate changes'
);

select extensions.is(
  (select sr.tax_rate_percent from public.sale_returns sr
   where sr.id=(select (return_result->>'returnId')::uuid from sellertray_tax_period_fixture)),
  7.5::numeric,
  'cross-period return remains pinned to the original sale tax snapshot'
);

select * from extensions.finish();
rollback;
