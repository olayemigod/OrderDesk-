begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

create temp table phase1_order_fixture (
  tenant_id uuid not null,
  customer_id uuid not null,
  message_id uuid not null,
  failing_message_id uuid not null,
  order_id uuid,
  invalid_rejected boolean not null default false
) on commit drop;

insert into phase1_order_fixture(tenant_id,customer_id,message_id,failing_message_id)
values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Phase 1 Order Integrity','phase1-order-integrity-'||substr(tenant_id::text,1,8),'OQA','active'
from phase1_order_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from phase1_order_fixture);

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'2348000000001','Phase One Customer','+2348000000001'
from phase1_order_fixture;

insert into public.inbound_messages(id,tenant_id,customer_id,provider_message_id,message_type,text_body,raw_payload)
select message_id,tenant_id,customer_id,'pgtap-main-'||message_id::text,'text','one test item','{}'::jsonb
from phase1_order_fixture;

insert into public.inbound_messages(id,tenant_id,customer_id,provider_message_id,message_type,text_body,raw_payload)
select failing_message_id,tenant_id,customer_id,'pgtap-fail-'||failing_message_id::text,'text','invalid test item','{}'::jsonb
from phase1_order_fixture;

select extensions.ok(
  public.claim_sellertray_inbound_message((select message_id from phase1_order_fixture)),
  'first inbound claim succeeds'
);
select extensions.ok(
  not public.claim_sellertray_inbound_message((select message_id from phase1_order_fixture)),
  'concurrent duplicate claim is blocked'
);

update public.inbound_messages
set processing_status='failed',processing_error='pgTAP retry'
where id=(select message_id from phase1_order_fixture);

select extensions.ok(
  public.claim_sellertray_inbound_message((select message_id from phase1_order_fixture)),
  'failed inbound message can be reclaimed'
);
select extensions.is(
  (select processing_attempts from public.inbound_messages where id=(select message_id from phase1_order_fixture)),
  2,
  'reclaim increments processing attempts exactly once'
);

update phase1_order_fixture
set order_id=public.create_sellertray_whatsapp_order_atomic(
  tenant_id,customer_id,message_id,'one test item',0.4,
  'fallback','pgtap-order-integrity',array['fallback_parser'],'NGN','[]'::jsonb
);

select extensions.ok((select order_id is not null from phase1_order_fixture),'atomic WhatsApp order creation returns an order id');

select extensions.is(
  public.create_sellertray_whatsapp_order_atomic(
    (select tenant_id from phase1_order_fixture),
    (select customer_id from phase1_order_fixture),
    (select message_id from phase1_order_fixture),
    'one test item',0.4,'fallback','pgtap-order-integrity',
    array['fallback_parser'],'NGN','[]'::jsonb
  ),
  (select order_id from phase1_order_fixture),
  'retry of the same source message returns the same order'
);

select extensions.is(
  (select count(*)::integer from public.orders where source_message_id=(select message_id from phase1_order_fixture)),
  1,
  'one WhatsApp source message persists only one order'
);

do $$
begin
  begin
    perform public.create_sellertray_whatsapp_order_atomic(
      (select tenant_id from phase1_order_fixture),
      (select customer_id from phase1_order_fixture),
      (select failing_message_id from phase1_order_fixture),
      'invalid test item',0.9,'external','pgtap-order-integrity',
      '{}'::text[],'NGN',
      jsonb_build_array(jsonb_build_object(
        'catalog_item_id',null,
        'item_name','Intentional invalid item',
        'original_item_name','Intentional invalid item',
        'quantity',1,
        'unit_price',100,
        'match_source','invalid_match_source',
        'match_confidence',1
      ))
    );
  exception when check_violation then
    update phase1_order_fixture set invalid_rejected=true;
  end;
end
$$;

select extensions.ok((select invalid_rejected from phase1_order_fixture),'invalid line causes the atomic function to reject the aggregate');
select extensions.is(
  (select count(*)::integer from public.orders where source_message_id=(select failing_message_id from phase1_order_fixture)),
  0,
  'failed atomic creation leaves no partial order'
);
select extensions.is(
  (select processing_status from public.inbound_messages where id=(select message_id from phase1_order_fixture)),
  'processing',
  'reclaimed message remains processing until worker finishes it'
);

select * from extensions.finish();
rollback;
