begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(28);

create temp table sellertray_purchase_fixture(
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  branch_id uuid,
  product_id uuid not null,
  pack_uom_id uuid,
  supplier_id uuid,
  purchase_order_id uuid,
  purchase_line_id uuid,
  first_receipt jsonb,
  replay_receipt jsonb,
  final_receipt jsonb,
  staff_supplier_denied boolean not null default false,
  uom_change_blocked boolean not null default false,
  overreceipt_blocked boolean not null default false,
  cancel_received_blocked boolean not null default false,
  receipt_update_blocked boolean not null default false,
  receipt_delete_blocked boolean not null default false,
  receipt_item_update_blocked boolean not null default false
) on commit drop;

insert into sellertray_purchase_fixture(tenant_id,owner_user_id,staff_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'purchase-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_purchase_fixture
union all
select staff_user_id,'purchase-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_purchase_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Purchasing Test','sellertray-purchase-'||substr(tenant_id::text,1,8),'PUR','active'
from sellertray_purchase_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_purchase_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_purchase_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_purchase_fixture;

update sellertray_purchase_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_user_id,true from sellertray_purchase_fixture;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Purchasing Drink','PUR-DRINK',1500,true,'Bottle',false
from sellertray_purchase_fixture;

with inserted as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_purchase
  )
  select tenant_id,product_id,'Pack',12,1500,false,true from sellertray_purchase_fixture
  returning id
)
update sellertray_purchase_fixture set pack_uom_id=(select id from inserted);

select extensions.is(
  (
    select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'get_sellertray_suppliers','save_sellertray_supplier','save_sellertray_purchase_order',
      'submit_sellertray_purchase_order','cancel_sellertray_purchase_order',
      'get_sellertray_purchase_orders','get_sellertray_purchase_order_detail','receive_sellertray_purchase_order'
    )
  ),8,'shared purchasing commands exist'
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
  has_function_privilege('authenticated','public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,date,date,text,jsonb)','EXECUTE')
  and has_function_privilege('authenticated','public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)','EXECUTE'),
  'purchasing commands are authenticated but unavailable anonymously'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_purchase_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_purchase_fixture f
set supplier_id=public.save_sellertray_supplier(
  f.tenant_id,null,'Acme Supplies','08000000000','supply@example.com','Lagos','Primary supplier',true
);

select extensions.ok(
  (select supplier_id is not null from sellertray_purchase_fixture),
  'Owner can create a Supplier through the governed command'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_purchase_fixture),true);
do $$
begin
  begin
    perform * from public.get_sellertray_suppliers((select tenant_id from sellertray_purchase_fixture));
  exception when sqlstate '42501' then
    update sellertray_purchase_fixture set staff_supplier_denied=true;
  end;
end $$;

select extensions.ok((select staff_supplier_denied from sellertray_purchase_fixture),'Staff cannot manage Supplier master data');

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_purchase_fixture),true);

update sellertray_purchase_fixture f
set purchase_order_id=public.save_sellertray_purchase_order(
  f.tenant_id,null,f.branch_id,f.supplier_id,current_date,current_date+7,'Weekly replenishment',
  jsonb_build_array(jsonb_build_object('productId',f.product_id,'uomId',f.pack_uom_id,'quantity',2,'unitCost',1000))
);

update sellertray_purchase_fixture f
set purchase_line_id=poi.id
from public.purchase_order_items poi
where poi.tenant_id=f.tenant_id and poi.purchase_order_id=f.purchase_order_id;

select extensions.is(
  (select total_amount from public.purchase_orders where id=(select purchase_order_id from sellertray_purchase_fixture)),
  2000::numeric,'draft Purchase Order total is calculated server-side'
);

select extensions.is(
  (select stock_quantity_ordered from public.purchase_order_items where id=(select purchase_line_id from sellertray_purchase_fixture)),
  24::numeric,'Purchase Order snapshots quantity in Stock UOM'
);

select public.submit_sellertray_purchase_order(tenant_id,purchase_order_id)
from sellertray_purchase_fixture;

select extensions.is(
  (select status from public.purchase_orders where id=(select purchase_order_id from sellertray_purchase_fixture)),
  'ordered','Owner can submit a non-empty draft Purchase Order'
);

do $$
begin
  begin
    update public.catalog_item_uoms
    set conversion_factor=10
    where id=(select pack_uom_id from sellertray_purchase_fixture);
  exception when sqlstate '23514' then
    update sellertray_purchase_fixture set uom_change_blocked=true;
  end;
end $$;

select extensions.ok((select uom_change_blocked from sellertray_purchase_fixture),'open Purchase Order protects its UOM conversion');

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_purchase_fixture),
    (select staff_user_id from sellertray_purchase_fixture),
    'can_receive_stock',true,
    (select owner_user_id from sellertray_purchase_fixture)
  ),'Owner can grant existing stock-receive authority for Purchase receiving'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_purchase_fixture),true);

select extensions.ok(
  (public.get_sellertray_purchase_order_detail(
    (select tenant_id from sellertray_purchase_fixture),
    (select purchase_order_id from sellertray_purchase_fixture)
  )->>'purchaseNumber') is not null,
  'authorized receiving Staff can read Purchase Order detail for their Branch'
);

update sellertray_purchase_fixture f
set first_receipt=public.receive_sellertray_purchase_order(
  f.tenant_id,f.purchase_order_id,'DN-001','First delivery',
  jsonb_build_array(jsonb_build_object('lineId',f.purchase_line_id,'quantity',1))
);

select extensions.is((select first_receipt->>'status' from sellertray_purchase_fixture),'partially_received','first partial receipt keeps Purchase Order open');

select extensions.is(
  (select quantity_delta from public.inventory_movements where reference_id=(select first_receipt->>'receiptId' from sellertray_purchase_fixture) limit 1),
  12::numeric,'one received Pack posts twelve Bottles to the stock ledger'
);

select extensions.is(
  (
    select quantity_on_hand from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_purchase_fixture),(select branch_id from sellertray_purchase_fixture)
    ) where catalog_item_id=(select product_id from sellertray_purchase_fixture)
  ),12::numeric,'first Purchase receipt increases Branch stock by exact Stock UOM quantity'
);

update sellertray_purchase_fixture f
set replay_receipt=public.receive_sellertray_purchase_order(
  f.tenant_id,f.purchase_order_id,'DN-001','First delivery retry',
  jsonb_build_array(jsonb_build_object('lineId',f.purchase_line_id,'quantity',1))
);

select extensions.is((select replay_receipt->>'idempotentReplay' from sellertray_purchase_fixture),'true','same Supplier receipt reference replays idempotently');

select extensions.is(
  (select count(*)::integer from public.inventory_movements where reference_type='purchase_receipt' and metadata->>'purchaseOrderId'=(select purchase_order_id::text from sellertray_purchase_fixture)),
  1,'receipt retry does not duplicate inventory movement'
);

do $$
begin
  begin
    perform public.receive_sellertray_purchase_order(
      (select tenant_id from sellertray_purchase_fixture),(select purchase_order_id from sellertray_purchase_fixture),
      'DN-OVER','Too much stock',jsonb_build_array(jsonb_build_object('lineId',(select purchase_line_id from sellertray_purchase_fixture),'quantity',2))
    );
  exception when sqlstate '23514' then
    update sellertray_purchase_fixture set overreceipt_blocked=true;
  end;
end $$;

select extensions.ok((select overreceipt_blocked from sellertray_purchase_fixture),'receiving cannot exceed remaining ordered quantity');

update sellertray_purchase_fixture f
set final_receipt=public.receive_sellertray_purchase_order(
  f.tenant_id,f.purchase_order_id,'DN-002','Final delivery',
  jsonb_build_array(jsonb_build_object('lineId',f.purchase_line_id,'quantity',1))
);

select extensions.is((select final_receipt->>'status' from sellertray_purchase_fixture),'received','final receipt completes the Purchase Order');

select extensions.is(
  (
    select quantity_on_hand from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_purchase_fixture),(select branch_id from sellertray_purchase_fixture)
    ) where catalog_item_id=(select product_id from sellertray_purchase_fixture)
  ),24::numeric,'completed Purchase Order posts exactly ordered Stock UOM quantity'
);

select extensions.is(
  (select status from public.purchase_orders where id=(select purchase_order_id from sellertray_purchase_fixture)),
  'received','Purchase Order status is received after all ordered quantities arrive'
);

do $$
begin
  begin
    perform public.cancel_sellertray_purchase_order((select tenant_id from sellertray_purchase_fixture),(select purchase_order_id from sellertray_purchase_fixture));
  exception when sqlstate '23514' then
    update sellertray_purchase_fixture set cancel_received_blocked=true;
  end;
end $$;
select extensions.ok((select cancel_received_blocked from sellertray_purchase_fixture),'received Purchase Order cannot be cancelled');

do $$
begin
  begin
    update public.purchase_receipts set notes='tamper'
    where id=(select (first_receipt->>'receiptId')::uuid from sellertray_purchase_fixture);
  exception when sqlstate '55000' then
    update sellertray_purchase_fixture set receipt_update_blocked=true;
  end;
end $$;
select extensions.ok((select receipt_update_blocked from sellertray_purchase_fixture),'Purchase receipt header is immutable');

do $$
begin
  begin
    delete from public.purchase_receipts
    where id=(select (first_receipt->>'receiptId')::uuid from sellertray_purchase_fixture);
  exception when sqlstate '55000' then
    update sellertray_purchase_fixture set receipt_delete_blocked=true;
  end;
end $$;
select extensions.ok((select receipt_delete_blocked from sellertray_purchase_fixture),'Purchase receipt cannot be deleted during business life');

do $$
begin
  begin
    update public.purchase_receipt_items set source_quantity=99
    where purchase_receipt_id=(select (first_receipt->>'receiptId')::uuid from sellertray_purchase_fixture);
  exception when sqlstate '55000' then
    update sellertray_purchase_fixture set receipt_item_update_blocked=true;
  end;
end $$;
select extensions.ok((select receipt_item_update_blocked from sellertray_purchase_fixture),'Purchase receipt lines are immutable');

update public.catalog_item_uoms
set conversion_factor=10
where id=(select pack_uom_id from sellertray_purchase_fixture);
select extensions.is(
  (select conversion_factor from public.catalog_item_uoms where id=(select pack_uom_id from sellertray_purchase_fixture)),
  10::numeric,'UOM conversion may change after the Purchase Order is fully received'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_purchase_fixture),true);
select extensions.is(
  (
    select count(*)::integer from public.get_sellertray_purchase_orders(
      (select tenant_id from sellertray_purchase_fixture),
      (select branch_id from sellertray_purchase_fixture),null
    )
  ),1,'management Purchase Order list returns the completed order'
);

select extensions.is(
  (select count(*)::integer from public.purchase_receipt_items where tenant_id=(select tenant_id from sellertray_purchase_fixture)),
  2,'two physical receipts preserve two immutable receipt-line records'
);

select extensions.is(
  (select count(*)::integer from public.inventory_movements where tenant_id=(select tenant_id from sellertray_purchase_fixture) and movement_type='purchase_receipt'),
  2,'two physical receipts preserve two inventory movements'
);

select * from extensions.finish();
rollback;