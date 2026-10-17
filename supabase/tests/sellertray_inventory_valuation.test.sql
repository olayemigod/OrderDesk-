begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.ok(
  to_regclass('public.sellertray_inventory_valuation_entries') is not null
  and to_regclass('public.sellertray_inventory_valuation_state') is not null,
  'derived inventory valuation ledger and current state exist'
);

select extensions.ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sellertray_purchase_receipt_items' and column_name='unit_cost' and is_nullable='NO')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='sellertray_purchase_receipt_items' and column_name='stock_unit_cost' and is_nullable='NO')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='sellertray_purchase_receipt_items' and column_name='currency' and is_nullable='NO'),
  'purchase receipts snapshot immutable purchase and stock-unit cost evidence'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_inventory_valuation_entries','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_inventory_valuation_state','SELECT'),
  'authenticated clients cannot bypass governed valuation read models'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.rebuild_sellertray_inventory_valuation(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.rebuild_sellertray_inventory_valuation(uuid,uuid)','EXECUTE'),
  'valuation rebuild remains a privileged internal operation'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_branch_stock_as_of(uuid,uuid,timestamptz)') is not null
  and to_regprocedure('public.get_sellertray_branch_stock_valuation(uuid,uuid,timestamptz)') is not null
  and to_regprocedure('public.get_sellertray_order_profitability(uuid,uuid)') is not null
  and has_function_privilege('authenticated','public.get_sellertray_branch_stock_valuation(uuid,uuid,timestamptz)','EXECUTE'),
  'governed as-of valuation and profitability reads exist'
);

create temp table sellertray_valuation_fixture (
  tenant_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  branch2_id uuid,
  location2_id uuid,
  uom_id uuid,
  supplier_id uuid,
  po1_id uuid,
  poi1_id uuid,
  receipt1_id uuid,
  movement1_id uuid,
  po2_id uuid,
  poi2_id uuid,
  receipt2_id uuid,
  movement2_id uuid,
  sale1_id uuid,
  opening_id uuid,
  sale2_id uuid,
  transfer_out_id uuid,
  transfer_in_id uuid,
  return_id uuid,
  sale1_order_item_id uuid not null,
  sale2_order_item_id uuid not null,
  cost_mutation_rejected boolean not null default false
) on commit drop;

insert into sellertray_valuation_fixture(tenant_id,product_id,sale1_order_item_id,sale2_order_item_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Valuation Test','sellertray-valuation-'||substr(tenant_id::text,1,8),'VAL','active'
from sellertray_valuation_fixture;

update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_valuation_fixture);

update sellertray_valuation_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;
update sellertray_valuation_fixture f set location_id=sl.id
from public.stock_locations sl where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

with ins as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'VAL2','Valuation Branch 2',false,true from sellertray_valuation_fixture
  returning id
)
update sellertray_valuation_fixture set branch2_id=(select id from ins);
update sellertray_valuation_fixture f set location2_id=sl.id
from public.stock_locations sl where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch2_id and sl.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Valuation Product','VAL-PROD',300,true,'Each',false
from sellertray_valuation_fixture;

with ins as (
  insert into public.catalog_item_uoms(tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_selling)
  select tenant_id,product_id,'Box',10,2500,false,false from sellertray_valuation_fixture
  returning id
)
update sellertray_valuation_fixture set uom_id=(select id from ins);

with ins as (
  insert into public.sellertray_suppliers(tenant_id,name,is_active)
  select tenant_id,'Valuation Supplier',true from sellertray_valuation_fixture
  returning id
)
update sellertray_valuation_fixture set supplier_id=(select id from ins);

with ins as (
  insert into public.sellertray_purchase_orders(tenant_id,branch_id,supplier_id,reference,status,currency,total_amount)
  select tenant_id,branch_id,supplier_id,'PO-VAL-001','ordered','NGN',2000 from sellertray_valuation_fixture
  returning id
)
update sellertray_valuation_fixture set po1_id=(select id from ins);

with ins as (
  insert into public.sellertray_purchase_order_items(
    tenant_id,purchase_order_id,catalog_item_id,uom_id,product_name,sku,selected_uom,conversion_factor,
    ordered_quantity,ordered_stock_quantity,unit_cost,line_total
  )
  select tenant_id,po1_id,product_id,uom_id,'Valuation Product','VAL-PROD','Box',10,2,20,1000,2000
  from sellertray_valuation_fixture returning id
)
update sellertray_valuation_fixture set poi1_id=(select id from ins);

with ins as (
  insert into public.sellertray_purchase_receipts(tenant_id,purchase_order_id,branch_id,supplier_id,reference,items_fingerprint,received_at)
  select tenant_id,po1_id,branch_id,supplier_id,'PR-VAL-001',md5('PR-VAL-001'),'2026-10-17 10:00:00+00'::timestamptz
  from sellertray_valuation_fixture returning id
)
update sellertray_valuation_fixture set receipt1_id=(select id from ins);

update sellertray_valuation_fixture set movement1_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'purchase_receipt',20,'Box',2,10,
  'purchase_receipt',receipt1_id::text,'valuation:purchase:1','2026-10-17 10:00:00+00'::timestamptz,
  null,'Valuation receipt 1','{}'::jsonb,null
);

insert into public.sellertray_purchase_receipt_items(
  tenant_id,receipt_id,purchase_order_item_id,catalog_item_id,uom_id,selected_uom,conversion_factor,
  received_quantity,received_stock_quantity,inventory_movement_id
)
select tenant_id,receipt1_id,poi1_id,product_id,uom_id,'Box',10,2,20,movement1_id
from sellertray_valuation_fixture;

select extensions.is(
  (select stock_unit_cost from public.sellertray_purchase_receipt_items where tenant_id=(select tenant_id from sellertray_valuation_fixture) and inventory_movement_id=(select movement1_id from sellertray_valuation_fixture)),
  100::numeric,
  'purchase receipt converts selected-UOM cost to authoritative Stock-UOM unit cost'
);
select extensions.is(
  (select currency from public.sellertray_purchase_receipt_items where tenant_id=(select tenant_id from sellertray_valuation_fixture) and inventory_movement_id=(select movement1_id from sellertray_valuation_fixture)),
  'NGN',
  'purchase receipt cost snapshot preserves business currency'
);
select extensions.ok(
  exists(
    select 1 from public.sellertray_inventory_valuation_state s
    where s.tenant_id=(select tenant_id from sellertray_valuation_fixture)
      and s.catalog_item_id=(select product_id from sellertray_valuation_fixture)
      and s.branch_id=(select branch_id from sellertray_valuation_fixture)
      and s.quantity_on_hand=20 and s.known_inventory_value=2000
      and s.average_unit_cost=100 and s.valuation_status='valued'
  ),
  'first governed purchase receipt establishes fully valued branch stock'
);

with ins as (
  insert into public.sellertray_purchase_orders(tenant_id,branch_id,supplier_id,reference,status,currency,total_amount)
  select tenant_id,branch_id,supplier_id,'PO-VAL-002','ordered','NGN',2000 from sellertray_valuation_fixture
  returning id
)
update sellertray_valuation_fixture set po2_id=(select id from ins);
with ins as (
  insert into public.sellertray_purchase_order_items(
    tenant_id,purchase_order_id,catalog_item_id,uom_id,product_name,sku,selected_uom,conversion_factor,
    ordered_quantity,ordered_stock_quantity,unit_cost,line_total
  )
  select tenant_id,po2_id,product_id,uom_id,'Valuation Product','VAL-PROD','Box',10,1,10,2000,2000
  from sellertray_valuation_fixture returning id
)
update sellertray_valuation_fixture set poi2_id=(select id from ins);
with ins as (
  insert into public.sellertray_purchase_receipts(tenant_id,purchase_order_id,branch_id,supplier_id,reference,items_fingerprint,received_at)
  select tenant_id,po2_id,branch_id,supplier_id,'PR-VAL-002',md5('PR-VAL-002'),'2026-10-17 11:00:00+00'::timestamptz
  from sellertray_valuation_fixture returning id
)
update sellertray_valuation_fixture set receipt2_id=(select id from ins);
update sellertray_valuation_fixture set movement2_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'purchase_receipt',10,'Box',1,10,
  'purchase_receipt',receipt2_id::text,'valuation:purchase:2','2026-10-17 11:00:00+00'::timestamptz,
  null,'Valuation receipt 2','{}'::jsonb,null
);
insert into public.sellertray_purchase_receipt_items(
  tenant_id,receipt_id,purchase_order_item_id,catalog_item_id,uom_id,selected_uom,conversion_factor,
  received_quantity,received_stock_quantity,inventory_movement_id
)
select tenant_id,receipt2_id,poi2_id,product_id,uom_id,'Box',10,1,10,movement2_id
from sellertray_valuation_fixture;

select extensions.ok(
  exists(
    select 1 from public.sellertray_inventory_valuation_state s
    where s.tenant_id=(select tenant_id from sellertray_valuation_fixture)
      and s.branch_id=(select branch_id from sellertray_valuation_fixture)
      and s.catalog_item_id=(select product_id from sellertray_valuation_fixture)
      and s.quantity_on_hand=30 and s.known_inventory_value=4000
      and round(s.average_unit_cost,8)=133.33333333::numeric
  ),
  'multiple receipts use moving weighted-average valuation'
);

update sellertray_valuation_fixture set sale1_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'sale',-6,'Each',6,1,
  'order','VAL-ORDER-001','valuation:sale:1','2026-10-17 12:00:00+00'::timestamptz,
  null,null,jsonb_build_object('order_id','00000000-0000-0000-0000-000000000101','order_item_id',sale1_order_item_id::text),null
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select sale1_id from sellertray_valuation_fixture)
      and ve.cogs_amount=800 and ve.cogs_complete=true
      and ve.valuation_source='moving_weighted_average'
  ),
  'sale COGS uses the historical moving weighted-average cost'
);
select extensions.is(
  (select quantity_on_hand from public.get_sellertray_branch_stock_as_of(
    (select tenant_id from sellertray_valuation_fixture),(select branch_id from sellertray_valuation_fixture),'2026-10-17 12:30:00+00'::timestamptz
  ) where catalog_item_id=(select product_id from sellertray_valuation_fixture)),
  24::numeric,
  'as-of quantity reads follow business time rather than sync time'
);
select extensions.ok(
  exists(
    select 1 from public.get_sellertray_branch_stock_valuation(
      (select tenant_id from sellertray_valuation_fixture),(select branch_id from sellertray_valuation_fixture),'2026-10-17 12:30:00+00'::timestamptz
    ) v where v.catalog_item_id=(select product_id from sellertray_valuation_fixture)
      and v.quantity_on_hand=24 and v.known_inventory_value=3200
      and round(v.average_unit_cost,8)=133.33333333::numeric and v.valuation_status='valued'
  ),
  'as-of valuation replays the deterministic historical cost state'
);

update sellertray_valuation_fixture set opening_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'opening',6,'Each',6,1,
  'opening_stock','VAL-OPEN-001','valuation:opening:1','2026-10-17 13:00:00+00'::timestamptz,
  null,'Historical opening stock without cost evidence','{}'::jsonb,null
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_inventory_valuation_state s
    where s.tenant_id=(select tenant_id from sellertray_valuation_fixture)
      and s.branch_id=(select branch_id from sellertray_valuation_fixture)
      and s.catalog_item_id=(select product_id from sellertray_valuation_fixture)
      and s.quantity_on_hand=30 and s.valued_quantity_on_hand=24 and s.unvalued_quantity_on_hand=6
      and s.known_inventory_value=3200 and s.average_unit_cost is null and s.valuation_status='partial'
  ),
  'stock without authoritative cost evidence remains explicitly unvalued'
);

update sellertray_valuation_fixture set sale2_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'sale',-5,'Each',5,1,
  'order','VAL-ORDER-002','valuation:sale:2','2026-10-17 14:00:00+00'::timestamptz,
  null,null,jsonb_build_object('order_id','00000000-0000-0000-0000-000000000102','order_item_id',sale2_order_item_id::text),null
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select sale2_id from sellertray_valuation_fixture)
      and ve.valued_quantity_delta=-4 and ve.unvalued_quantity_delta=-1
      and ve.cogs_amount=533.333333 and ve.cogs_complete=false
      and ve.valuation_status='partial'
  ),
  'mixed stock produces partial known COGS and explicitly incomplete profitability'
);

update sellertray_valuation_fixture set transfer_out_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'transfer_out',-3,'Each',3,1,
  'stock_transfer','VAL-TRANSFER-001','valuation:transfer:out','2026-10-17 15:00:00+00'::timestamptz,
  null,null,jsonb_build_object('transfer_reference','VAL-TRANSFER-001'),null
);
update sellertray_valuation_fixture set transfer_in_id=public.record_sellertray_inventory_movement(
  tenant_id,branch2_id,location2_id,product_id,'transfer_in',3,'Each',3,1,
  'stock_transfer','VAL-TRANSFER-001','valuation:transfer:in','2026-10-17 16:00:00+00'::timestamptz,
  null,null,jsonb_build_object('transfer_reference','VAL-TRANSFER-001'),null
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select transfer_out_id from sellertray_valuation_fixture)
      and ve.value_delta=-320 and ve.valued_quantity_delta=-2.4 and ve.unvalued_quantity_delta=-0.6
  ),
  'transfer dispatch carries the exact known and unvalued cost proportions out of the source Branch'
);
select extensions.ok(
  exists(
    select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select transfer_in_id from sellertray_valuation_fixture)
      and ve.value_delta=320 and ve.valued_quantity_delta=2.4 and ve.unvalued_quantity_delta=0.6
      and ve.valuation_source='transfer_preserved'
  ),
  'transfer receipt preserves dispatch value rather than revaluing at destination'
);

update sellertray_valuation_fixture set return_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'sale_return',2,'Each',2,1,
  'sale_return','VAL-RETURN-001','valuation:return:1','2026-10-17 17:00:00+00'::timestamptz,
  null,null,jsonb_build_object('order_id','00000000-0000-0000-0000-000000000102','order_item_id',sale2_order_item_id::text),null
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select return_id from sellertray_valuation_fixture)
      and ve.value_delta=213.333333 and ve.valued_quantity_delta=1.6 and ve.unvalued_quantity_delta=0.4
      and ve.cogs_amount=-213.333333 and ve.cogs_complete=false
      and ve.valuation_source='sale_return_history'
  ),
  'partial returns restore the original sale cost basis instead of current average cost'
);
select extensions.ok(
  exists(
    select 1 from public.get_sellertray_branch_stock_valuation(
      (select tenant_id from sellertray_valuation_fixture),(select branch2_id from sellertray_valuation_fixture),'2026-10-17 18:00:00+00'::timestamptz
    ) v where v.catalog_item_id=(select product_id from sellertray_valuation_fixture)
      and v.quantity_on_hand=3 and v.valued_quantity_on_hand=2.4 and v.unvalued_quantity_on_hand=0.6
      and v.known_inventory_value=320 and v.average_unit_cost is null and v.valuation_status='partial'
  ),
  'destination Branch reports transferred mixed valuation without inventing an average cost'
);

select extensions.ok(
  lower(pg_get_functiondef('public.rebuild_sellertray_inventory_valuation(uuid,uuid)'::regprocedure)) like '%order by im.business_at,im.created_at,im.id%'
  and lower(pg_get_functiondef('public.get_sellertray_stock_movements(uuid,uuid,uuid,integer)'::regprocedure)) like '%order by im.business_at desc,im.created_at desc,im.id desc%',
  'valuation replay and movement history use deterministic business-time ordering with stable tie-breaks'
);

do $$
begin
  begin
    update public.sellertray_purchase_receipt_items
    set unit_cost=999
    where tenant_id=(select tenant_id from sellertray_valuation_fixture)
      and inventory_movement_id=(select movement1_id from sellertray_valuation_fixture);
  exception when others then
    update sellertray_valuation_fixture set cost_mutation_rejected=true;
  end;
end
$$;
select extensions.ok(
  (select cost_mutation_rejected from sellertray_valuation_fixture),
  'posted purchase cost snapshots cannot be silently rewritten'
);

select * from extensions.finish();
rollback;
