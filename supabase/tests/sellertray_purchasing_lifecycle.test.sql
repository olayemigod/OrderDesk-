begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

create temp table sellertray_purchase_lifecycle_fixture(
  tenant_id uuid not null,
  supplier_id uuid,
  purchase_order_id uuid,
  branch_id uuid,
  supplier_delete_blocked boolean not null default false,
  order_delete_blocked boolean not null default false
) on commit drop;

insert into sellertray_purchase_lifecycle_fixture(tenant_id) values(gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Purchase Lifecycle','purchase-life-'||substr(tenant_id::text,1,8),'PLC','active'
from sellertray_purchase_lifecycle_fixture;

update sellertray_purchase_lifecycle_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

with s as (
  insert into public.suppliers(tenant_id,name,is_active)
  select tenant_id,'Lifecycle Supplier',true from sellertray_purchase_lifecycle_fixture
  returning id
)
update sellertray_purchase_lifecycle_fixture set supplier_id=(select id from s);

with po as (
  insert into public.purchase_orders(tenant_id,branch_id,supplier_id,purchase_number,status,order_date,currency,total_amount)
  select tenant_id,branch_id,supplier_id,'PO-LIFECYCLE','draft',current_date,'NGN',0
  from sellertray_purchase_lifecycle_fixture
  returning id
)
update sellertray_purchase_lifecycle_fixture set purchase_order_id=(select id from po);

do $$
begin
  begin
    delete from public.purchase_orders where id=(select purchase_order_id from sellertray_purchase_lifecycle_fixture);
  exception when sqlstate '55000' then
    update sellertray_purchase_lifecycle_fixture set order_delete_blocked=true;
  end;
end $$;
select extensions.ok((select order_delete_blocked from sellertray_purchase_lifecycle_fixture),'Purchase Order cannot be deleted directly while Tenant exists');

do $$
begin
  begin
    delete from public.suppliers where id=(select supplier_id from sellertray_purchase_lifecycle_fixture);
  exception when sqlstate '55000' then
    update sellertray_purchase_lifecycle_fixture set supplier_delete_blocked=true;
  end;
end $$;
select extensions.ok((select supplier_delete_blocked from sellertray_purchase_lifecycle_fixture),'Supplier cannot be deleted directly while Tenant exists');

select extensions.ok(
  exists(
    select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid
    where r.relname='purchase_orders' and c.conname='purchase_orders_tenant_fk' and c.confdeltype='c'
  ),'Purchase Orders cascade only through parent Tenant deletion'
);

select extensions.ok(
  exists(
    select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid
    where r.relname='purchase_receipts' and c.conname='purchase_receipts_order_same_tenant' and c.confdeltype='c'
  ),'Purchase receipt aggregate cascades with its parent Purchase Order'
);

delete from public.tenants where id=(select tenant_id from sellertray_purchase_lifecycle_fixture);

select extensions.is(
  (select count(*)::integer from public.suppliers where tenant_id=(select tenant_id from sellertray_purchase_lifecycle_fixture)),
  0,'governed parent Tenant deletion removes Supplier history'
);
select extensions.is(
  (select count(*)::integer from public.purchase_orders where tenant_id=(select tenant_id from sellertray_purchase_lifecycle_fixture)),
  0,'governed parent Tenant deletion removes Purchase Order history'
);

select * from extensions.finish();
rollback;