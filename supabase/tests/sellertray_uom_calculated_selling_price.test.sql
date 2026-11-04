-- Product-UOM prices default to a calculated sale price only when NULL.
-- Each assertion runs in a disposable pgTAP transaction and rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.ok(
  has_function_privilege('service_role','public.sellertray_effective_uom_selling_price(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.sellertray_effective_uom_selling_price(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_effective_uom_selling_price(uuid,uuid,uuid)','EXECUTE'),
  'Price authority remains server-only; direct client grants are denied'
);

create temp table sellertray_uom_price_fixture(
  tenant_id uuid not null,
  actor_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  pack_uom_id uuid,
  crate_uom_id uuid,
  free_uom_id uuid,
  order_id uuid,
  stale_price_rejected boolean not null default false
) on commit drop;

insert into sellertray_uom_price_fixture(tenant_id,actor_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_id,'unit-pricing-'||substr(actor_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_uom_price_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'UOM Price Regression',
  'unit-pricing-'||substr(tenant_id::text,1,8),'UPR','active'
from sellertray_uom_price_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_uom_price_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,actor_id,'owner' from sellertray_uom_price_fixture;

update sellertray_uom_price_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'UOM QA Drink','UOM-PRICE-QA',250,true,'Bottle',false
from sellertray_uom_price_fixture;

with ins as (
  insert into public.catalog_item_uoms(tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,barcode,allow_fractional,is_default_selling)
  select tenant_id,product_id,'Pack',6,null,'UOM-QA-PACK-'||substr(product_id::text,1,8),false,false
  from sellertray_uom_price_fixture returning id
) update sellertray_uom_price_fixture set pack_uom_id=(select id from ins);

with ins as (
  insert into public.catalog_item_uoms(tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_selling)
  select tenant_id,product_id,'Crate',12,1200,null,false,false
  from sellertray_uom_price_fixture returning id
) update sellertray_uom_price_fixture set crate_uom_id=(select id from ins);

with ins as (
  insert into public.catalog_item_uoms(tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_selling)
  select tenant_id,product_id,'Box',2,0,null,false,false
  from sellertray_uom_price_fixture returning id
) update sellertray_uom_price_fixture set free_uom_id=(select id from ins);

select extensions.is(
  (select u.selling_price from public.catalog_item_uoms u join sellertray_uom_price_fixture f on u.id=f.pack_uom_id),
  null::numeric, 'Calculated unit has no persisted explicit price'
);
select extensions.is(
  (select public.sellertray_effective_uom_selling_price(tenant_id,product_id,pack_uom_id) from sellertray_uom_price_fixture),
  1500::numeric, 'Missing Pack price defaults to Stock UOM price x six'
);
select extensions.is(
  (select public.sellertray_effective_uom_selling_price(tenant_id,product_id,crate_uom_id) from sellertray_uom_price_fixture),
  1200::numeric, 'An entered Crate price overrides its conversion-derived value'
);
select extensions.is(
  (select public.sellertray_effective_uom_selling_price(tenant_id,product_id,free_uom_id) from sellertray_uom_price_fixture),
  0::numeric, 'An explicitly entered zero remains authoritative'
);
select extensions.is(
  (select public.sellertray_effective_uom_selling_price(gen_random_uuid(),product_id,pack_uom_id) from sellertray_uom_price_fixture),
  null::numeric, 'Price lookup does not cross Business boundaries'
);

update sellertray_uom_price_fixture f set order_id=public.create_sellertray_pos_order_atomic(
  f.tenant_id,f.branch_id,null,null,'Unit price calculation QA',
  jsonb_build_array(jsonb_build_object('catalog_item_id',f.product_id,'uom_id',f.pack_uom_id,'quantity',2))
);

select extensions.ok((select order_id is not null from sellertray_uom_price_fixture),'POS accepts a calculated-price UOM');
select extensions.is(
  (select o.total_amount from public.orders o join sellertray_uom_price_fixture f on o.id=f.order_id),
  3000::numeric,'POS order total uses two calculated Pack prices'
);
select extensions.is(
  (select oi.unit_price from public.order_items oi join sellertray_uom_price_fixture f on oi.order_id=f.order_id),
  1500::numeric,'Order item freezes the calculated price at sale creation'
);
select extensions.is(
  (select oi.stock_quantity from public.order_items oi join sellertray_uom_price_fixture f on oi.order_id=f.order_id),
  12::numeric,'Stock quantity still uses six Bottle per Pack'
);
select extensions.is(
  (select count(*)::int from public.inventory_movements im join sellertray_uom_price_fixture f on im.tenant_id=f.tenant_id where im.reference_type='order' and im.reference_id=f.order_id::text),
  0,'Creating a POS draft posts no inventory movements'
);

update public.catalog_items ci set price_ngn=300
from sellertray_uom_price_fixture f where ci.id=f.product_id and ci.tenant_id=f.tenant_id;

select extensions.is(
  (select public.sellertray_effective_uom_selling_price(tenant_id,product_id,pack_uom_id) from sellertray_uom_price_fixture),
  1800::numeric,'Unpriced unit recalculates after a base price change'
);
select extensions.is(
  (select public.sellertray_effective_uom_selling_price(tenant_id,product_id,crate_uom_id) from sellertray_uom_price_fixture),
  1200::numeric,'Entered unit price is unaffected by base-price changes'
);
select extensions.is(
  (select public.sellertray_effective_uom_selling_price(tenant_id,product_id,free_uom_id) from sellertray_uom_price_fixture),
  0::numeric,'Explicit zero stays zero after the base price changes'
);
select extensions.is(
  (select oi.unit_price from public.order_items oi join sellertray_uom_price_fixture f on oi.order_id=f.order_id),
  1500::numeric,'Historical draft price snapshot is not rewritten'
);

update public.catalog_item_uoms u set conversion_factor=8
from sellertray_uom_price_fixture f where u.id=f.pack_uom_id and u.tenant_id=f.tenant_id;

select extensions.is(
  (select public.sellertray_effective_uom_selling_price(tenant_id,product_id,pack_uom_id) from sellertray_uom_price_fixture),
  2400::numeric,'Calculated price follows the updated product-specific conversion'
);

do $$
declare f record;
begin
 select * into f from sellertray_uom_price_fixture;
 begin
  perform public.create_sellertray_pos_order_idempotent(
   f.tenant_id,f.branch_id,null,null,null,'Stale offline price',
   jsonb_build_array(jsonb_build_object('catalog_item_id',f.product_id,'uom_id',f.pack_uom_id,'quantity',1,
      'expected_selling_price',1500,'expected_conversion_factor',8)),gen_random_uuid());
 exception when sqlstate '23514' then
  update sellertray_uom_price_fixture set stale_price_rejected=true;
 end;
end $$;

select extensions.ok(
  (select stale_price_rejected from sellertray_uom_price_fixture),
  'Queued/offline POS rejects a stale calculated price'
);

select pg_catalog.set_config('request.jwt.claim.sub',(select actor_id::text from sellertray_uom_price_fixture),true);
select extensions.is(
  (select selling_price from public.resolve_sellertray_product_barcode(
   (select tenant_id from sellertray_uom_price_fixture),
   (select barcode from public.catalog_item_uoms where id=(select pack_uom_id from sellertray_uom_price_fixture)))),
  2400::numeric,'Barcode resolver returns the calculated UOM selling price'
);

select public.update_sellertray_pos_draft_items(
 (select tenant_id from sellertray_uom_price_fixture),
 (select order_id from sellertray_uom_price_fixture),
 jsonb_build_array(jsonb_build_object(
  'orderItemId',(select oi.id from public.order_items oi where oi.order_id=(select order_id from sellertray_uom_price_fixture)),
  'quantity',1
 ))
);
select extensions.is(
  (select oi.unit_price from public.order_items oi join sellertray_uom_price_fixture f on oi.order_id=f.order_id),
  2400::numeric,'Draft editing validates the current calculated price'
);
select extensions.is(
  (select o.total_amount from public.orders o join sellertray_uom_price_fixture f on o.id=f.order_id),
  2400::numeric,'Draft total recalculates consistently with effective price'
);

select * from extensions.finish();
rollback;
