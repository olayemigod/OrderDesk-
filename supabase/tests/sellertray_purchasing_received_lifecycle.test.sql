begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

create temp table sellertray_received_purchase_lifecycle(
  tenant_id uuid not null,
  owner_user_id uuid not null,
  branch_id uuid,
  product_id uuid not null,
  uom_id uuid,
  supplier_id uuid,
  purchase_order_id uuid,
  purchase_line_id uuid,
  receipt_id uuid
) on commit drop;

insert into sellertray_received_purchase_lifecycle(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'purchase-life-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_received_purchase_lifecycle;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Received Purchase Lifecycle','purchase-received-'||substr(tenant_id::text,1,8),'PRL','active'
from sellertray_received_purchase_lifecycle;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_received_purchase_lifecycle);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_received_purchase_lifecycle;

update sellertray_received_purchase_lifecycle f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Lifecycle Purchase Product','PRL-PRODUCT',1200,true,'Bottle',false
from sellertray_received_purchase_lifecycle;

with inserted as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_purchase
  )
  select tenant_id,product_id,'Pack',12,1200,false,true
  from sellertray_received_purchase_lifecycle
  returning id
)
update sellertray_received_purchase_lifecycle set uom_id=(select id from inserted);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_received_purchase_lifecycle),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_received_purchase_lifecycle f
set supplier_id=public.save_sellertray_supplier(
  f.tenant_id,null,'Lifecycle Delivery Supplier',null,null,null,null,true
);

update sellertray_received_purchase_lifecycle f
set purchase_order_id=public.save_sellertray_purchase_order(
  f.tenant_id,null,f.branch_id,f.supplier_id,current_date,null,null,
  jsonb_build_array(jsonb_build_object('productId',f.product_id,'uomId',f.uom_id,'quantity',1,'unitCost',900))
);

update sellertray_received_purchase_lifecycle f
set purchase_line_id=poi.id
from public.purchase_order_items poi
where poi.tenant_id=f.tenant_id and poi.purchase_order_id=f.purchase_order_id;

select public.submit_sellertray_purchase_order(tenant_id,purchase_order_id)
from sellertray_received_purchase_lifecycle;

update sellertray_received_purchase_lifecycle f
set receipt_id=(public.receive_sellertray_purchase_order(
  f.tenant_id,f.purchase_order_id,'LIFE-DN-001',null,
  jsonb_build_array(jsonb_build_object('lineId',f.purchase_line_id,'quantity',1))
)->>'receiptId')::uuid;

select extensions.is(
  (select count(*)::integer from public.purchase_receipts where tenant_id=(select tenant_id from sellertray_received_purchase_lifecycle)),
  1,'fixture contains one received Purchase receipt'
);
select extensions.is(
  (select count(*)::integer from public.purchase_receipt_items where tenant_id=(select tenant_id from sellertray_received_purchase_lifecycle)),
  1,'fixture contains one immutable Purchase receipt line'
);
select extensions.is(
  (select count(*)::integer from public.inventory_movements where tenant_id=(select tenant_id from sellertray_received_purchase_lifecycle) and movement_type='purchase_receipt'),
  1,'fixture contains the linked immutable inventory movement'
);

delete from public.tenants where id=(select tenant_id from sellertray_received_purchase_lifecycle);

select extensions.is(
  (select count(*)::integer from public.purchase_receipts where tenant_id=(select tenant_id from sellertray_received_purchase_lifecycle)),
  0,'parent Tenant deletion removes received Purchase history cleanly'
);
select extensions.is(
  (select count(*)::integer from public.inventory_movements where tenant_id=(select tenant_id from sellertray_received_purchase_lifecycle)),
  0,'parent Tenant deletion removes linked purchase inventory history cleanly'
);

select * from extensions.finish();
rollback;