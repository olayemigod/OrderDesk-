begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

create temp table sellertray_supplier_reversal_fixture(
  tenant_id uuid not null,
  owner_user_id uuid not null,
  branch_id uuid,
  product_id uuid not null,
  uom_id uuid,
  supplier_id uuid,
  purchase_order_id uuid,
  purchase_line_id uuid,
  payment_id uuid,
  reversal jsonb,
  replay jsonb,
  different_reason_blocked boolean not null default false,
  future_date_blocked boolean not null default false,
  reversal_update_blocked boolean not null default false
) on commit drop;

insert into sellertray_supplier_reversal_fixture(tenant_id,owner_user_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'supplier-reversal-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_supplier_reversal_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Supplier Reversal Test','supplier-reversal-'||substr(tenant_id::text,1,8),'SRV','active'
from sellertray_supplier_reversal_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_supplier_reversal_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_supplier_reversal_fixture;

update sellertray_supplier_reversal_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Reversal Product','SRV-PRODUCT',1500,true,'Bottle',false
from sellertray_supplier_reversal_fixture;

with inserted as (
  insert into public.catalog_item_uoms(
    tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_purchase
  )
  select tenant_id,product_id,'Pack',12,1500,false,true from sellertray_supplier_reversal_fixture
  returning id
)
update sellertray_supplier_reversal_fixture set uom_id=(select id from inserted);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_supplier_reversal_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_supplier_reversal_fixture f
set supplier_id=public.save_sellertray_supplier(f.tenant_id,null,'Reversal Supplier',null,null,null,null,true);

update sellertray_supplier_reversal_fixture f
set purchase_order_id=public.save_sellertray_purchase_order(
  f.tenant_id,null,f.branch_id,f.supplier_id,current_date,null,null,
  jsonb_build_array(jsonb_build_object('productId',f.product_id,'uomId',f.uom_id,'quantity',1,'unitCost',1000))
);
update sellertray_supplier_reversal_fixture f
set purchase_line_id=poi.id
from public.purchase_order_items poi
where poi.tenant_id=f.tenant_id and poi.purchase_order_id=f.purchase_order_id;
select public.submit_sellertray_purchase_order(tenant_id,purchase_order_id) from sellertray_supplier_reversal_fixture;
select public.receive_sellertray_purchase_order(
  tenant_id,purchase_order_id,'SRV-DN-1',null,
  jsonb_build_array(jsonb_build_object('lineId',purchase_line_id,'quantity',1))
) from sellertray_supplier_reversal_fixture;

update sellertray_supplier_reversal_fixture f
set payment_id=(public.record_sellertray_supplier_payment(
  f.tenant_id,f.purchase_order_id,400,'bank_transfer','SRV-PAY-1',current_date,'Mistaken transfer entry'
)->>'paymentId')::uuid;

select extensions.is(
  (select public.sellertray_supplier_paid_amount(tenant_id,purchase_order_id) from sellertray_supplier_reversal_fixture),
  400::numeric,'payment contributes to Supplier paid amount before reversal'
);

update sellertray_supplier_reversal_fixture f
set reversal=public.reverse_sellertray_supplier_payment(f.tenant_id,f.payment_id,'Entered against the wrong bank statement');

select extensions.is((select reversal->>'idempotentReplay' from sellertray_supplier_reversal_fixture),'false','first reversal creates new immutable evidence');
select extensions.is((select (reversal->>'paidAmount')::numeric from sellertray_supplier_reversal_fixture),0::numeric,'reversal removes original payment from net paid amount');
select extensions.is((select (reversal->>'outstandingAmount')::numeric from sellertray_supplier_reversal_fixture),1000::numeric,'reversal restores Purchase outstanding value');
select extensions.is((select count(*)::integer from public.supplier_payments where tenant_id=(select tenant_id from sellertray_supplier_reversal_fixture)),1,'original Supplier payment remains preserved');
select extensions.is((select count(*)::integer from public.supplier_payment_reversals where tenant_id=(select tenant_id from sellertray_supplier_reversal_fixture)),1,'reversal is separate compensating evidence');

update sellertray_supplier_reversal_fixture f
set replay=public.reverse_sellertray_supplier_payment(f.tenant_id,f.payment_id,'Entered against the wrong bank statement');
select extensions.is((select replay->>'idempotentReplay' from sellertray_supplier_reversal_fixture),'true','exact reversal retry is idempotent');

do $$
begin
  begin
    perform public.reverse_sellertray_supplier_payment(
      (select tenant_id from sellertray_supplier_reversal_fixture),
      (select payment_id from sellertray_supplier_reversal_fixture),
      'Different reason'
    );
  exception when sqlstate '23505' then
    update sellertray_supplier_reversal_fixture set different_reason_blocked=true;
  end;
end $$;
select extensions.ok((select different_reason_blocked from sellertray_supplier_reversal_fixture),'already reversed payment rejects a conflicting reversal reason');

do $$
begin
  begin
    perform public.record_sellertray_supplier_payment(
      (select tenant_id from sellertray_supplier_reversal_fixture),
      (select purchase_order_id from sellertray_supplier_reversal_fixture),
      100,'card','SRV-FUTURE',current_date+1,null
    );
  exception when sqlstate '22023' then
    update sellertray_supplier_reversal_fixture set future_date_blocked=true;
  end;
end $$;
select extensions.ok((select future_date_blocked from sellertray_supplier_reversal_fixture),'future-dated Supplier payment evidence is rejected');

do $$
begin
  begin
    update public.supplier_payment_reversals set reason='tamper'
    where supplier_payment_id=(select payment_id from sellertray_supplier_reversal_fixture);
  exception when sqlstate '55000' then
    update sellertray_supplier_reversal_fixture set reversal_update_blocked=true;
  end;
end $$;
select extensions.ok((select reversal_update_blocked from sellertray_supplier_reversal_fixture),'Supplier payment reversal history is immutable');

select extensions.ok(
  has_function_privilege('authenticated','public.reverse_sellertray_supplier_payment(uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.reverse_sellertray_supplier_payment(uuid,uuid,text)','EXECUTE'),
  'payment reversal is governed through authenticated command access'
);

select extensions.is(
  (select (public.get_sellertray_supplier_payment_summary(tenant_id,purchase_order_id)->'payments'->0->>'reversed')::boolean from sellertray_supplier_reversal_fixture),
  true,'payment summary exposes reversal state without rewriting original payment'
);

select * from extensions.finish();
rollback;