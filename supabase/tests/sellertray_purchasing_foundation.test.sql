begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(27);

select extensions.ok(
  to_regclass('public.suppliers') is not null
  and to_regclass('public.purchase_orders') is not null
  and to_regclass('public.purchase_order_items') is not null
  and to_regclass('public.purchase_receipts') is not null
  and to_regclass('public.purchase_receipt_items') is not null,
  'purchasing tables exist'
);
select extensions.ok(
  has_function_privilege('authenticated','public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,text)','EXECUTE')
  and has_function_privilege('authenticated','public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,date,text,jsonb)','EXECUTE')
  and has_function_privilege('authenticated','public.submit_sellertray_purchase_order(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.post_sellertray_purchase_receipt(uuid,uuid,text,timestamptz,text,jsonb)','EXECUTE'),
  'authenticated management sessions can use governed purchasing commands'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.suppliers','INSERT')
  and not has_table_privilege('authenticated','public.purchase_orders','INSERT')
  and not has_table_privilege('authenticated','public.purchase_order_items','INSERT')
  and not has_table_privilege('authenticated','public.purchase_receipts','INSERT')
  and not has_table_privilege('authenticated','public.purchase_receipt_items','INSERT'),
  'authenticated clients cannot bypass purchasing commands with raw inserts'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.purchase_receipts','UPDATE')
  and not has_table_privilege('authenticated','public.purchase_receipts','DELETE')
  and not has_table_privilege('authenticated','public.purchase_receipt_items','UPDATE')
  and not has_table_privilege('authenticated','public.purchase_receipt_items','DELETE'),
  'posted receipt evidence is not directly mutable by authenticated clients'
);
select extensions.ok(
  not has_function_privilege('anon','public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,date,text,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.post_sellertray_purchase_receipt(uuid,uuid,text,timestamptz,text,jsonb)','EXECUTE'),
  'anonymous users cannot execute purchasing commands'
);

create temp table sellertray_purchase_fixture(
  tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  pack_uom_id uuid,
  supplier_id uuid,
  purchase_order_id uuid,
  first_receipt jsonb,
  replay_receipt jsonb,
  final_receipt jsonb,
  over_receipt_rejected boolean not null default false,
  inactive_supplier_rejected boolean not null default false,
  receipt_update_rejected boolean not null default false,
  tenant_delete_succeeded boolean not null default false
) on commit drop;

insert into sellertray_purchase_fixture(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'purchase-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_purchase_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status,currency)
select tenant_id,'SellerTray Purchasing Test','sellertray-purchase-'||substr(tenant_id::text,1,8),'PUR','active','NGN'
from sellertray_purchase_fixture;
update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_purchase_fixture);
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_purchase_fixture;
update sellertray_purchase_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Purchase Test Drink','PUR-DRINK',150,true,'Bottle',false
from sellertray_purchase_fixture;
with u as (
  insert into public.catalog_item_uoms(tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_selling,is_default_purchase)
  select tenant_id,product_id,'Pack',12,1500,false,false,true from sellertray_purchase_fixture
  returning id
)
update sellertray_purchase_fixture set pack_uom_id=(select id from u);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_purchase_fixture),true);

update sellertray_purchase_fixture set supplier_id=public.save_sellertray_supplier(
  tenant_id,null,'Supply House','Ada','08000000000','supply@example.com','Lagos','Primary supplier'
);

select extensions.ok((select supplier_id is not null from sellertray_purchase_fixture),'management can create a Supplier');
select extensions.is(
  (select name from public.suppliers where id=(select supplier_id from sellertray_purchase_fixture)),
  'Supply House','Supplier details are persisted'
);

update sellertray_purchase_fixture set purchase_order_id=public.save_sellertray_purchase_order(
  tenant_id,null,branch_id,supplier_id,current_date+7,'Restock drinks',
  jsonb_build_array(jsonb_build_object('catalogItemId',product_id,'uomId',pack_uom_id,'quantity',2,'unitCost',1000))
);

select extensions.ok((select purchase_order_id is not null from sellertray_purchase_fixture),'management can create a draft Purchase Order');
select extensions.is(
  (select status from public.purchase_orders where id=(select purchase_order_id from sellertray_purchase_fixture)),
  'draft','new Purchase Order remains Draft until explicitly placed'
);
select extensions.is(
  (select purchase_uom from public.purchase_order_items where purchase_order_id=(select purchase_order_id from sellertray_purchase_fixture)),
  'Pack','Purchase Order freezes selected Purchase UOM'
);
select extensions.is(
  (select conversion_factor from public.purchase_order_items where purchase_order_id=(select purchase_order_id from sellertray_purchase_fixture)),
  12::numeric,'Purchase Order freezes UOM conversion factor'
);
select extensions.is(
  (select stock_quantity_ordered from public.purchase_order_items where purchase_order_id=(select purchase_order_id from sellertray_purchase_fixture)),
  24::numeric,'ordered quantity is normalized to Stock UOM'
);
select extensions.is(
  (select total_amount from public.purchase_orders where id=(select purchase_order_id from sellertray_purchase_fixture)),
  2000::numeric,'Purchase Order total is server-calculated'
);

select public.submit_sellertray_purchase_order(tenant_id,purchase_order_id) from sellertray_purchase_fixture;
select extensions.is(
  (select status from public.purchase_orders where id=(select purchase_order_id from sellertray_purchase_fixture)),
  'ordered','placing a Purchase Order closes the draft edit boundary'
);

-- Later product configuration must not reinterpret this Purchase Order.
update public.catalog_item_uoms set conversion_factor=24
where id=(select pack_uom_id from sellertray_purchase_fixture);

update sellertray_purchase_fixture f set first_receipt=public.post_sellertray_purchase_receipt(
  f.tenant_id,f.purchase_order_id,'SUP-DEL-1','2026-10-10 10:00:00+00','purchase-test-receipt-1',
  jsonb_build_array(jsonb_build_object(
    'purchaseOrderItemId',(select poi.id from public.purchase_order_items poi where poi.purchase_order_id=f.purchase_order_id),
    'quantity',1
  ))
);

select extensions.is((select first_receipt->>'status' from sellertray_purchase_fixture),'partially_received','first partial receipt advances Purchase Order status');
select extensions.is(
  (select quantity_delta from public.inventory_movements where id=(
    select inventory_movement_id from public.purchase_receipt_items where purchase_receipt_id=(select (first_receipt->>'receiptId')::uuid from sellertray_purchase_fixture)
  )),
  12::numeric,'receipt uses frozen PO conversion rather than later UOM configuration'
);
select extensions.is(
  (select source_uom from public.inventory_movements where id=(
    select inventory_movement_id from public.purchase_receipt_items where purchase_receipt_id=(select (first_receipt->>'receiptId')::uuid from sellertray_purchase_fixture)
  )),
  'Pack','stock ledger retains Purchase UOM snapshot'
);
select extensions.is(
  (select quantity_on_hand from public.get_sellertray_branch_stock(
    (select tenant_id from sellertray_purchase_fixture),(select branch_id from sellertray_purchase_fixture)
  ) where catalog_item_id=(select product_id from sellertray_purchase_fixture)),
  12::numeric,'partial Purchase Receipt increases Branch stock in Stock UOM'
);

update sellertray_purchase_fixture f set replay_receipt=public.post_sellertray_purchase_receipt(
  f.tenant_id,f.purchase_order_id,'SUP-DEL-1',now(),'purchase-test-receipt-1',
  jsonb_build_array(jsonb_build_object(
    'purchaseOrderItemId',(select poi.id from public.purchase_order_items poi where poi.purchase_order_id=f.purchase_order_id),
    'quantity',1
  ))
);
select extensions.is((select replay_receipt->>'replayed' from sellertray_purchase_fixture),'true','same receipt request retries idempotently');
select extensions.is(
  (select count(*)::integer from public.inventory_movements where reference_type='purchase_receipt'
    and metadata->>'purchaseOrderId'=(select purchase_order_id::text from sellertray_purchase_fixture)),
  1,'receipt retry does not duplicate stock movement'
);

do $$ begin
  begin
    perform public.post_sellertray_purchase_receipt(
      (select tenant_id from sellertray_purchase_fixture),(select purchase_order_id from sellertray_purchase_fixture),
      'OVER',now(),'purchase-test-over',jsonb_build_array(jsonb_build_object(
        'purchaseOrderItemId',(select id from public.purchase_order_items where purchase_order_id=(select purchase_order_id from sellertray_purchase_fixture)),
        'quantity',2))
    );
  exception when check_violation then update sellertray_purchase_fixture set over_receipt_rejected=true; end;
end $$;
select extensions.ok((select over_receipt_rejected from sellertray_purchase_fixture),'receipt cannot exceed remaining Purchase Order quantity');

update sellertray_purchase_fixture f set final_receipt=public.post_sellertray_purchase_receipt(
  f.tenant_id,f.purchase_order_id,'SUP-DEL-2','2026-10-10 11:00:00+00','purchase-test-receipt-2',
  jsonb_build_array(jsonb_build_object(
    'purchaseOrderItemId',(select poi.id from public.purchase_order_items poi where poi.purchase_order_id=f.purchase_order_id),
    'quantity',1
  ))
);
select extensions.is((select final_receipt->>'status' from sellertray_purchase_fixture),'received','final receipt completes Purchase Order');
select extensions.is(
  (select quantity_on_hand from public.get_sellertray_branch_stock(
    (select tenant_id from sellertray_purchase_fixture),(select branch_id from sellertray_purchase_fixture)
  ) where catalog_item_id=(select product_id from sellertray_purchase_fixture)),
  24::numeric,'full Purchase Order receipt posts exact total Stock UOM quantity'
);

select public.set_sellertray_supplier_active(tenant_id,supplier_id,false) from sellertray_purchase_fixture;
select extensions.ok(
  exists(select 1 from public.purchase_orders where id=(select purchase_order_id from sellertray_purchase_fixture) and status='received'),
  'Supplier deactivation preserves Purchase Order history'
);

do $$ begin
  begin
    perform public.save_sellertray_purchase_order(
      (select tenant_id from sellertray_purchase_fixture),null,(select branch_id from sellertray_purchase_fixture),
      (select supplier_id from sellertray_purchase_fixture),null,null,
      jsonb_build_array(jsonb_build_object('catalogItemId',(select product_id from sellertray_purchase_fixture),
        'uomId',(select pack_uom_id from sellertray_purchase_fixture),'quantity',1,'unitCost',1000))
    );
  exception when check_violation then update sellertray_purchase_fixture set inactive_supplier_rejected=true; end;
end $$;
select extensions.ok((select inactive_supplier_rejected from sellertray_purchase_fixture),'inactive Supplier cannot be used for a new Purchase Order');

do $$ begin
  begin
    update public.purchase_receipts set total_cost=0 where id=(select (first_receipt->>'receiptId')::uuid from sellertray_purchase_fixture);
  exception when object_not_in_prerequisite_state then update sellertray_purchase_fixture set receipt_update_rejected=true; end;
end $$;
select extensions.ok((select receipt_update_rejected from sellertray_purchase_fixture),'posted Purchase Receipt is immutable');

select extensions.is(
  (select count(*)::integer from public.purchase_receipt_items where purchase_order_item_id=(
    select id from public.purchase_order_items where purchase_order_id=(select purchase_order_id from sellertray_purchase_fixture)
  )),
  2,'partial receipts preserve separate immutable receipt-line evidence'
);

select * from extensions.finish();
rollback;