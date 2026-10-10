begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

create temp table sellertray_purchase_lifecycle_fixture(
  tenant_id uuid not null,
  branch_id uuid,
  supplier_id uuid not null,
  purchase_order_id uuid not null,
  purchase_order_item_id uuid not null,
  purchase_receipt_id uuid not null,
  supplier_delete_blocked boolean not null default false,
  receipt_delete_blocked boolean not null default false,
  tenant_delete_succeeded boolean not null default false
) on commit drop;

insert into sellertray_purchase_lifecycle_fixture(
  tenant_id,supplier_id,purchase_order_id,purchase_order_item_id,purchase_receipt_id
) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status,currency)
select tenant_id,'Purchasing Lifecycle Test','purchase-lifecycle-'||substr(tenant_id::text,1,8),'PLC','active','NGN'
from sellertray_purchase_lifecycle_fixture;

update sellertray_purchase_lifecycle_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.suppliers(id,tenant_id,name)
select supplier_id,tenant_id,'Lifecycle Supplier'
from sellertray_purchase_lifecycle_fixture;

insert into public.purchase_orders(
  id,tenant_id,branch_id,supplier_id,purchase_order_number,status,currency,total_amount
)
select purchase_order_id,tenant_id,branch_id,supplier_id,'PO-LIFECYCLE','received','NGN',100
from sellertray_purchase_lifecycle_fixture;

insert into public.purchase_order_items(
  id,tenant_id,purchase_order_id,catalog_item_id,item_name,purchase_uom,quantity_ordered,
  conversion_factor,stock_uom,stock_quantity_ordered,allow_fractional,unit_cost,line_total
)
select purchase_order_item_id,tenant_id,purchase_order_id,gen_random_uuid(),'Lifecycle Product','Pack',1,
  12,'Bottle',12,false,100,100
from sellertray_purchase_lifecycle_fixture;

insert into public.purchase_receipts(
  id,tenant_id,branch_id,supplier_id,purchase_order_id,purchase_receipt_number,
  request_key,request_fingerprint,currency,total_cost,received_at
)
select purchase_receipt_id,tenant_id,branch_id,supplier_id,purchase_order_id,'GRN-LIFECYCLE',
  'lifecycle-request','lifecycle-fingerprint','NGN',100,now()
from sellertray_purchase_lifecycle_fixture;

insert into public.purchase_receipt_items(
  tenant_id,purchase_receipt_id,purchase_order_item_id,catalog_item_id,item_name,purchase_uom,
  quantity_received,conversion_factor,stock_uom,stock_quantity_received,unit_cost,line_total
)
select tenant_id,purchase_receipt_id,purchase_order_item_id,gen_random_uuid(),'Lifecycle Product','Pack',
  1,12,'Bottle',12,100,100
from sellertray_purchase_lifecycle_fixture;

select extensions.ok(
  exists(select 1 from public.purchase_receipts where id=(select purchase_receipt_id from sellertray_purchase_lifecycle_fixture))
  and exists(select 1 from public.purchase_receipt_items where purchase_receipt_id=(select purchase_receipt_id from sellertray_purchase_lifecycle_fixture)),
  'Purchasing lifecycle fixture contains immutable receipt history'
);

do $$
begin
  begin
    delete from public.suppliers where id=(select supplier_id from sellertray_purchase_lifecycle_fixture);
  exception when object_not_in_prerequisite_state then
    update sellertray_purchase_lifecycle_fixture set supplier_delete_blocked=true;
  end;
end $$;
select extensions.ok((select supplier_delete_blocked from sellertray_purchase_lifecycle_fixture),'direct Supplier deletion is blocked during normal operation');

do $$
begin
  begin
    delete from public.purchase_receipts where id=(select purchase_receipt_id from sellertray_purchase_lifecycle_fixture);
  exception when object_not_in_prerequisite_state then
    update sellertray_purchase_lifecycle_fixture set receipt_delete_blocked=true;
  end;
end $$;
select extensions.ok((select receipt_delete_blocked from sellertray_purchase_lifecycle_fixture),'direct posted Purchase Receipt deletion is blocked during normal operation');

do $$
begin
  begin
    delete from public.tenants where id=(select tenant_id from sellertray_purchase_lifecycle_fixture);
    update sellertray_purchase_lifecycle_fixture set tenant_delete_succeeded=true;
  exception when others then
    update sellertray_purchase_lifecycle_fixture set tenant_delete_succeeded=false;
  end;
end $$;

select extensions.ok(
  (select tenant_delete_succeeded from sellertray_purchase_lifecycle_fixture)
  and not exists(select 1 from public.suppliers where tenant_id=(select tenant_id from sellertray_purchase_lifecycle_fixture))
  and not exists(select 1 from public.purchase_orders where tenant_id=(select tenant_id from sellertray_purchase_lifecycle_fixture))
  and not exists(select 1 from public.purchase_receipts where tenant_id=(select tenant_id from sellertray_purchase_lifecycle_fixture)),
  'governed business deletion can cascade through Supplier, Purchase Order and Purchase Receipt history'
);

select * from extensions.finish();
rollback;
