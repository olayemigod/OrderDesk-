begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

create temp table phase1_payment_fixture (
  tenant_id uuid not null,
  customer_id uuid not null,
  order_id uuid,
  method_id uuid not null,
  p1 uuid,
  p2 uuid,
  mode_mutation_blocked boolean not null default false
) on commit drop;

insert into phase1_payment_fixture(tenant_id,customer_id,method_id)
values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Phase 1 Payment Integrity','phase1-payment-integrity-'||substr(tenant_id::text,1,8),'PQA','active'
from phase1_payment_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from phase1_payment_fixture);

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'manual:+2348000000002','Payment Test Customer','+2348000000002'
from phase1_payment_fixture;

with inserted as (
  insert into public.orders(
    tenant_id,customer_id,status,source,customer_note,parser_source,review_reasons,currency,total_amount
  )
  select tenant_id,customer_id,'needs_review','manual','pgTAP payment order','manual','{}'::text[],'NGN',100
  from phase1_payment_fixture
  returning id
)
update phase1_payment_fixture f set order_id=i.id from inserted i;

insert into public.order_items(
  tenant_id,order_id,item_name,original_item_name,quantity,unit_price,match_source,match_confidence
)
select tenant_id,order_id,'Payment Test Item','Payment Test Item',1,100,'manual',1
from phase1_payment_fixture;

update public.orders set status='accepted'
where id=(select order_id from phase1_payment_fixture);

select extensions.is(
  (select count(*)::integer from public.order_financial_documents
   where order_id=(select order_id from phase1_payment_fixture) and document_type='invoice' and status='issued'),
  1,
  'acceptance automatically issues one invoice'
);
select extensions.is(
  (select amount from public.order_financial_documents
   where order_id=(select order_id from phase1_payment_fixture) and document_type='invoice'),
  100::numeric,
  'issued invoice matches the priced order total'
);

insert into public.merchant_payment_methods(
  id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,configuration_status
)
select method_id,tenant_id,'paystack','pgTAP Paystack',true,true,1,'test','configured'
from phase1_payment_fixture;

update phase1_payment_fixture
set p1=public.create_sellertray_order_payment_for_method(
  tenant_id,order_id,method_id,'initiated','PAYTEST1','phase1-payment-1',null
);

update phase1_payment_fixture
set p2=public.create_sellertray_order_payment_for_method(
  tenant_id,order_id,method_id,'initiated','PAYTEST2','phase1-payment-2',null
);

select extensions.is(
  (select provider_mode from public.order_payments where id=(select p1 from phase1_payment_fixture)),
  'test',
  'online payment snapshots the merchant test/live mode'
);
select extensions.is(
  public.create_sellertray_order_payment_for_method(
    (select tenant_id from phase1_payment_fixture),
    (select order_id from phase1_payment_fixture),
    (select method_id from phase1_payment_fixture),
    'initiated','PAYTEST1','phase1-payment-1',null
  ),
  (select p1 from phase1_payment_fixture),
  'payment creation is idempotent for the same key'
);

do $$
begin
  begin
    update public.order_payments
    set provider_mode='live'
    where id=(select p1 from phase1_payment_fixture);
  exception when check_violation then
    update phase1_payment_fixture set mode_mutation_blocked=true;
  end;
end
$$;

select extensions.ok((select mode_mutation_blocked from phase1_payment_fixture),'provider mode snapshot is immutable');
select extensions.is(
  (select provider_mode from public.order_payments where id=(select p1 from phase1_payment_fixture)),
  'test',
  'rejected mode mutation leaves the original mode intact'
);

select public.transition_sellertray_order_payment(
  (select p1 from phase1_payment_fixture),
  'confirmed','provider_verify',null,'PAYTEST1',null
);

select extensions.is(
  (select status from public.order_payments where id=(select p2 from phase1_payment_fixture)),
  'cancelled',
  'confirming one payment cancels competing open attempts'
);
select extensions.is(
  (select payment_status from public.orders where id=(select order_id from phase1_payment_fixture)),
  'paid',
  'confirmed payment projects the order to paid'
);
select extensions.is(
  (select amount_paid from public.orders where id=(select order_id from phase1_payment_fixture)),
  100::numeric,
  'confirmed payment projects trusted paid amount'
);

select public.apply_sellertray_payment_exception(
  (select p1 from phase1_payment_fixture),'reversed','pgtap-reversal','Phase 1 reversal test'
);

select extensions.is(
  (select payment_status from public.orders where id=(select order_id from phase1_payment_fixture)),
  'payment_issue',
  'reversed confirmed payment becomes payment issue'
);
select extensions.is(
  (select amount_paid from public.orders where id=(select order_id from phase1_payment_fixture)),
  0::numeric,
  'adverse payment exception removes trusted paid amount'
);

select public.apply_sellertray_payment_exception(
  (select p1 from phase1_payment_fixture),'none',null,'Resolved'
);

select extensions.is(
  (select payment_status from public.orders where id=(select order_id from phase1_payment_fixture)),
  'paid',
  'clearing the adverse exception restores paid projection'
);
select extensions.is(
  (select amount_paid from public.orders where id=(select order_id from phase1_payment_fixture)),
  100::numeric,
  'clearing the adverse exception restores trusted paid amount'
);

select * from extensions.finish();
rollback;
