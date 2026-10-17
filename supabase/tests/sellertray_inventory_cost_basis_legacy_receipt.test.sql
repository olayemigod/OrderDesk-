begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

create temp table sellertray_legacy_receipt_cost_fixture(
  tenant_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  movement_id uuid
) on commit drop;

insert into sellertray_legacy_receipt_cost_fixture(tenant_id,product_id)
values(gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Legacy Receipt Cost Test','sellertray-legacy-cost-'||substr(tenant_id::text,1,8),'LGC','active'
from sellertray_legacy_receipt_cost_fixture;

update sellertray_legacy_receipt_cost_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;
update sellertray_legacy_receipt_cost_fixture f set location_id=sl.id
from public.stock_locations sl where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Legacy Receipt Product','LGC-001',100,true,'Each',false
from sellertray_legacy_receipt_cost_fixture;

update sellertray_legacy_receipt_cost_fixture set movement_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'purchase_receipt',5,'Each',5,1,
  'purchase_receipt','LEGACY-PR-001','legacy-cost:receipt:1','2026-10-17 07:00:00+00'::timestamptz,
  null,'Legacy receipt without governed cost snapshot','{}'::jsonb,null
);

select extensions.ok(
  exists(select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select movement_id from sellertray_legacy_receipt_cost_fixture)
      and ve.valuation_source='purchase_receipt_without_cost'
      and ve.unvalued_quantity_delta=5),
  'legacy purchase receipt remains unvalued before verified historical evidence exists'
);

insert into public.sellertray_inventory_cost_basis_evidence(
  tenant_id,branch_id,stock_location_id,catalog_item_id,inventory_movement_id,
  stock_unit_cost,currency,reference,reason,command_id,actor_user_id
)
select tenant_id,branch_id,location_id,product_id,movement_id,
       40,'NGN','LEGACY-INVOICE-001','Verified pre-governance supplier invoice',gen_random_uuid(),gen_random_uuid()
from sellertray_legacy_receipt_cost_fixture;

select extensions.ok(
  exists(select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select movement_id from sellertray_legacy_receipt_cost_fixture)
      and ve.valuation_source='historical_cost_basis'
      and ve.valued_quantity_delta=5
      and ve.value_delta=200
      and ve.known_unit_cost=40),
  'verified evidence values a legacy receipt at its original business position'
);

select extensions.ok(
  lower(pg_get_functiondef('public.record_sellertray_inventory_cost_basis(uuid,uuid,numeric,text,text,uuid,uuid)'::regprocedure))
    like '%governed purchase receiving already owns this receipt cost basis%',
  'governed Purchase Receiving cost snapshots remain non-overridable'
);

select * from extensions.finish();
rollback;
