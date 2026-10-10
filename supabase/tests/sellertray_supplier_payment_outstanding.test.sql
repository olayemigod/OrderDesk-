begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(19);

create temp table sellertray_supplier_payment_fixture(
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  branch_id uuid,
  product_id uuid not null,
  uom_id uuid,
  supplier_id uuid,
  purchase_order_id uuid,
  purchase_line_id uuid,
  first_payment jsonb,
  replay_payment jsonb,
  final_payment jsonb,
  staff_denied boolean not null default false,
  conflict_blocked boolean not null default false,
  overpay_blocked boolean not null default false,
  update_blocked boolean not null default false,
  delete_blocked boolean not null default false
) on commit drop;

insert into sellertray_supplier_payment_fixture(tenant_id,owner_user_id,staff_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'supplier-pay-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_supplier_payment_fixture
union all
select staff_user_id,'supplier-pay-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_supplier_payment_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Supplier Payment Test','supplier-pay-'||substr(tenant_id::text,1,8),'SPY','active'
from sellertray_supplier_payment_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_supplier_payment_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_supplier_payment_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_supplier_payment_fixture;

update sellertray_supplier_payment_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Supplier Payment Product','SPY-PRODUCT',1400,true,'Bottle',false
from sellertray_supplier_payment_fixture;

with inserted as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_purchase
  )
  select tenant_id,product_id,'Pack',12,1400,false,true from sellertray_supplier_payment_fixture
  returning id
)
update sellertray_supplier_payment_fixture set uom_id=(select id from inserted);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_supplier_payment_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_supplier_payment_fixture f
set supplier_id=public.save_sellertray_supplier(f.tenant_id,null,'Supplier Pay Test',null,null,null,null,true);

update sellertray_supplier_payment_fixture f
set purchase_order_id=public.save_sellertray_purchase_order(
  f.tenant_id,null,f.branch_id,f.supplier_id,current_date,null,null,
  jsonb_build_array(jsonb_build_object('productId',f.product_id,'uomId',f.uom_id,'quantity',1,'unitCost',1000))
);

update sellertray_supplier_payment_fixture f
set purchase_line_id=poi.id
from public.purchase_order_items poi
where poi.tenant_id=f.tenant_id and poi.purchase_order_id=f.purchase_order_id;

select public.submit_sellertray_purchase_order(tenant_id,purchase_order_id)
from sellertray_supplier_payment_fixture;

select public.receive_sellertray_purchase_order(
  tenant_id,purchase_order_id,'SPY-DN-001',null,
  jsonb_build_array(jsonb_build_object('lineId',purchase_line_id,'quantity',1))
)
from sellertray_supplier_payment_fixture;

select extensions.is(
  (select public.sellertray_purchase_order_received_value(tenant_id,purchase_order_id) from sellertray_supplier_payment_fixture),
  1000::numeric,'received Purchase value is derived from immutable receipt cost evidence'
);

select extensions.is(
  (select (public.get_sellertray_supplier_payment_summary(tenant_id,purchase_order_id)->>'outstandingAmount')::numeric from sellertray_supplier_payment_fixture),
  1000::numeric,'fully received unpaid Purchase Order starts fully outstanding'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_supplier_payment_fixture),true);
do $$
begin
  begin
    perform public.get_sellertray_supplier_payment_summary(
      (select tenant_id from sellertray_supplier_payment_fixture),
      (select purchase_order_id from sellertray_supplier_payment_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_supplier_payment_fixture set staff_denied=true;
  end;
end $$;
select extensions.ok((select staff_denied from sellertray_supplier_payment_fixture),'Staff cannot view Supplier payment management details');

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_supplier_payment_fixture),true);

update sellertray_supplier_payment_fixture f
set first_payment=public.record_sellertray_supplier_payment(
  f.tenant_id,f.purchase_order_id,400,'bank_transfer','TRF-SPY-001',current_date,'First transfer'
);

select extensions.is((select first_payment->>'idempotentReplay' from sellertray_supplier_payment_fixture),'false','first Supplier payment creates new evidence');
select extensions.is((select (first_payment->>'paidAmount')::numeric from sellertray_supplier_payment_fixture),400::numeric,'first Supplier payment updates paid amount');
select extensions.is((select (first_payment->>'outstandingAmount')::numeric from sellertray_supplier_payment_fixture),600::numeric,'first Supplier payment leaves correct outstanding amount');

update sellertray_supplier_payment_fixture f
set replay_payment=public.record_sellertray_supplier_payment(
  f.tenant_id,f.purchase_order_id,400,'bank_transfer','TRF-SPY-001',current_date,'First transfer'
);
select extensions.is((select replay_payment->>'idempotentReplay' from sellertray_supplier_payment_fixture),'true','exact Supplier payment retry replays idempotently');
select extensions.is((select count(*)::integer from public.supplier_payments where tenant_id=(select tenant_id from sellertray_supplier_payment_fixture)),1,'payment retry does not duplicate evidence');

do $$
begin
  begin
    perform public.record_sellertray_supplier_payment(
      (select tenant_id from sellertray_supplier_payment_fixture),
      (select purchase_order_id from sellertray_supplier_payment_fixture),
      300,'bank_transfer','TRF-SPY-001',current_date,'Changed amount'
    );
  exception when sqlstate '23505' then
    update sellertray_supplier_payment_fixture set conflict_blocked=true;
  end;
end $$;
select extensions.ok((select conflict_blocked from sellertray_supplier_payment_fixture),'same Supplier reference with different payment details is rejected');

do $$
begin
  begin
    perform public.record_sellertray_supplier_payment(
      (select tenant_id from sellertray_supplier_payment_fixture),
      (select purchase_order_id from sellertray_supplier_payment_fixture),
      700,'card','CARD-SPY-OVER',current_date,null
    );
  exception when sqlstate '23514' then
    update sellertray_supplier_payment_fixture set overpay_blocked=true;
  end;
end $$;
select extensions.ok((select overpay_blocked from sellertray_supplier_payment_fixture),'Supplier payment cannot exceed received outstanding value');

update sellertray_supplier_payment_fixture f
set final_payment=public.record_sellertray_supplier_payment(
  f.tenant_id,f.purchase_order_id,600,'card','CARD-SPY-002',current_date,null
);

select extensions.is((select (final_payment->>'outstandingAmount')::numeric from sellertray_supplier_payment_fixture),0::numeric,'final Supplier payment clears Purchase outstanding');

select extensions.is(
  (select (public.get_sellertray_supplier_payment_summary(tenant_id,purchase_order_id)->>'paidAmount')::numeric from sellertray_supplier_payment_fixture),
  1000::numeric,'Purchase payment summary totals immutable payment evidence'
);
select extensions.is(
  (select (public.get_sellertray_supplier_payment_summary(tenant_id,purchase_order_id)->>'outstandingAmount')::numeric from sellertray_supplier_payment_fixture),
  0::numeric,'Purchase payment summary reports zero outstanding after full payment'
);

select extensions.is(
  (select outstanding_amount from public.get_sellertray_supplier_balances((select tenant_id from sellertray_supplier_payment_fixture)) where supplier_id=(select supplier_id from sellertray_supplier_payment_fixture)),
  0::numeric,'Supplier balance aggregates received and paid value'
);
select extensions.is(
  (select paid_amount from public.get_sellertray_supplier_balances((select tenant_id from sellertray_supplier_payment_fixture)) where supplier_id=(select supplier_id from sellertray_supplier_payment_fixture)),
  1000::numeric,'Supplier balance shows total paid amount'
);

do $$
begin
  begin
    update public.supplier_payments set notes='tamper'
    where id=(select (first_payment->>'paymentId')::uuid from sellertray_supplier_payment_fixture);
  exception when sqlstate '55000' then
    update sellertray_supplier_payment_fixture set update_blocked=true;
  end;
end $$;
select extensions.ok((select update_blocked from sellertray_supplier_payment_fixture),'Supplier payment history cannot be edited');

do $$
begin
  begin
    delete from public.supplier_payments
    where id=(select (first_payment->>'paymentId')::uuid from sellertray_supplier_payment_fixture);
  exception when sqlstate '55000' then
    update sellertray_supplier_payment_fixture set delete_blocked=true;
  end;
end $$;
select extensions.ok((select delete_blocked from sellertray_supplier_payment_fixture),'Supplier payment history cannot be deleted during business life');

select extensions.ok(
  not has_table_privilege('authenticated','public.supplier_payments','INSERT')
  and not has_table_privilege('authenticated','public.supplier_payments','UPDATE')
  and not has_table_privilege('authenticated','public.supplier_payments','DELETE'),
  'browser sessions cannot bypass Supplier payment commands with raw writes'
);

select extensions.ok(
  has_function_privilege('authenticated','public.record_sellertray_supplier_payment(uuid,uuid,numeric,text,text,date,text)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_supplier_payment_summary(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_supplier_balances(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.record_sellertray_supplier_payment(uuid,uuid,numeric,text,text,date,text)','EXECUTE'),
  'Supplier payment commands are available only through authenticated governance'
);

select * from extensions.finish();
rollback;