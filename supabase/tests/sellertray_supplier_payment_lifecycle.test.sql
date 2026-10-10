begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

create temp table sellertray_supplier_payment_lifecycle(
  tenant_id uuid not null,
  supplier_id uuid,
  branch_id uuid,
  purchase_order_id uuid,
  payment_id uuid,
  reversal_id uuid,
  payment_delete_blocked boolean not null default false,
  reversal_delete_blocked boolean not null default false
) on commit drop;

insert into sellertray_supplier_payment_lifecycle(tenant_id) values(gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Supplier Payment Lifecycle','supplier-payment-life-'||substr(tenant_id::text,1,8),'SPL','active'
from sellertray_supplier_payment_lifecycle;

update sellertray_supplier_payment_lifecycle f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

with s as (
  insert into public.suppliers(tenant_id,name,is_active)
  select tenant_id,'Payment Lifecycle Supplier',true from sellertray_supplier_payment_lifecycle
  returning id
)
update sellertray_supplier_payment_lifecycle set supplier_id=(select id from s);

with po as (
  insert into public.purchase_orders(
    tenant_id,branch_id,supplier_id,purchase_number,status,order_date,currency,total_amount
  )
  select tenant_id,branch_id,supplier_id,'PO-PAY-LIFE','received',current_date,'NGN',1000
  from sellertray_supplier_payment_lifecycle
  returning id
)
update sellertray_supplier_payment_lifecycle set purchase_order_id=(select id from po);

with sp as (
  insert into public.supplier_payments(
    tenant_id,supplier_id,purchase_order_id,payment_date,amount,currency,method,reference,notes
  )
  select tenant_id,supplier_id,purchase_order_id,current_date,400,'NGN','bank_transfer','PAY-LIFE-001','Lifecycle fixture'
  from sellertray_supplier_payment_lifecycle
  returning id
)
update sellertray_supplier_payment_lifecycle set payment_id=(select id from sp);

with spr as (
  insert into public.supplier_payment_reversals(
    tenant_id,supplier_payment_id,supplier_id,purchase_order_id,amount,reason
  )
  select tenant_id,payment_id,supplier_id,purchase_order_id,400,'Lifecycle reversal fixture'
  from sellertray_supplier_payment_lifecycle
  returning id
)
update sellertray_supplier_payment_lifecycle set reversal_id=(select id from spr);

select extensions.is(
  (select count(*)::integer from public.supplier_payments where tenant_id=(select tenant_id from sellertray_supplier_payment_lifecycle)),
  1,'fixture contains immutable Supplier payment evidence'
);
select extensions.is(
  (select count(*)::integer from public.supplier_payment_reversals where tenant_id=(select tenant_id from sellertray_supplier_payment_lifecycle)),
  1,'fixture contains separate immutable reversal evidence'
);

do $$
begin
  begin
    delete from public.supplier_payments
    where id=(select payment_id from sellertray_supplier_payment_lifecycle);
  exception when sqlstate '55000' then
    update sellertray_supplier_payment_lifecycle set payment_delete_blocked=true;
  end;
end $$;
select extensions.ok((select payment_delete_blocked from sellertray_supplier_payment_lifecycle),'Supplier payment cannot be deleted directly while Tenant exists');

do $$
begin
  begin
    delete from public.supplier_payment_reversals
    where id=(select reversal_id from sellertray_supplier_payment_lifecycle);
  exception when sqlstate '55000' then
    update sellertray_supplier_payment_lifecycle set reversal_delete_blocked=true;
  end;
end $$;
select extensions.ok((select reversal_delete_blocked from sellertray_supplier_payment_lifecycle),'Supplier payment reversal cannot be deleted directly while Tenant exists');

select extensions.ok(
  exists(
    select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid
    where r.relname='supplier_payment_reversals'
      and c.conname='supplier_payment_reversals_payment_same_tenant'
      and c.confdeltype='c'
  ),'reversal evidence follows the parent payment during governed Tenant deletion'
);

delete from public.tenants where id=(select tenant_id from sellertray_supplier_payment_lifecycle);

select extensions.is(
  (select count(*)::integer from public.supplier_payments where tenant_id=(select tenant_id from sellertray_supplier_payment_lifecycle)),
  0,'parent Tenant deletion removes Supplier payment evidence cleanly'
);
select extensions.is(
  (select count(*)::integer from public.supplier_payment_reversals where tenant_id=(select tenant_id from sellertray_supplier_payment_lifecycle)),
  0,'parent Tenant deletion removes Supplier payment reversal evidence cleanly'
);

select * from extensions.finish();
rollback;