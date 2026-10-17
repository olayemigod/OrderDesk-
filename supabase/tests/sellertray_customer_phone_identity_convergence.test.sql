begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

create temp table sellertray_customer_identity_fixture (
  tenant_id uuid not null,
  whatsapp_customer_id uuid not null,
  manual_customer_id uuid,
  plus_resolved_id uuid,
  digits_resolved_id uuid,
  whatsapp_resolved_id uuid,
  whatsapp_replay_id uuid,
  invalid_whatsapp_rejected boolean not null default false
) on commit drop;

insert into sellertray_customer_identity_fixture(tenant_id,whatsapp_customer_id)
values(gen_random_uuid(),gen_random_uuid());

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Identity Convergence','sellertray-identity-'||substr(tenant_id::text,1,8),'CID','active'
from sellertray_customer_identity_fixture;

insert into public.customers(id,tenant_id,wa_id,display_name,phone,updated_at)
select whatsapp_customer_id,tenant_id,'2348011111111','Existing WhatsApp Customer','2348011111111',now()
from sellertray_customer_identity_fixture;

update sellertray_customer_identity_fixture
set plus_resolved_id=public.resolve_sellertray_pos_customer(
  tenant_id,null,'Existing WhatsApp Customer','+2348011111111'
);

select extensions.is(
  (select plus_resolved_id from sellertray_customer_identity_fixture),
  (select whatsapp_customer_id from sellertray_customer_identity_fixture),
  'POS +international formatting reuses the existing WhatsApp customer'
);

select extensions.is(
  (
    select count(*)::integer
    from public.customers c
    join sellertray_customer_identity_fixture f on f.tenant_id=c.tenant_id
    where regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')='2348011111111'
  ),
  1,
  'Superficial phone formatting does not create a duplicate customer'
);

update sellertray_customer_identity_fixture
set manual_customer_id=public.resolve_sellertray_pos_customer(
  tenant_id,null,'Counter First Customer','+2348022222222'
);

update sellertray_customer_identity_fixture
set digits_resolved_id=public.resolve_sellertray_pos_customer(
  tenant_id,null,'Counter First Customer','2348022222222'
);

select extensions.is(
  (select digits_resolved_id from sellertray_customer_identity_fixture),
  (select manual_customer_id from sellertray_customer_identity_fixture),
  'POS reuses the same manual customer when only the leading plus formatting changes'
);

update sellertray_customer_identity_fixture
set whatsapp_resolved_id=public.resolve_sellertray_whatsapp_customer(
  tenant_id,'2348022222222','WhatsApp Profile Name'
);

select extensions.is(
  (select whatsapp_resolved_id from sellertray_customer_identity_fixture),
  (select manual_customer_id from sellertray_customer_identity_fixture),
  'First WhatsApp contact upgrades the POS manual customer in place'
);

select extensions.is(
  (
    select c.wa_id
    from public.customers c
    join sellertray_customer_identity_fixture f on f.manual_customer_id=c.id
  ),
  '2348022222222',
  'Upgraded customer now owns the exact WhatsApp sender identity'
);

update sellertray_customer_identity_fixture
set whatsapp_replay_id=public.resolve_sellertray_whatsapp_customer(
  tenant_id,'2348022222222','Updated WhatsApp Name'
);

select extensions.is(
  (select whatsapp_replay_id from sellertray_customer_identity_fixture),
  (select manual_customer_id from sellertray_customer_identity_fixture),
  'Repeated WhatsApp delivery resolves idempotently to the same customer'
);

select extensions.is(
  (
    select c.display_name
    from public.customers c
    join sellertray_customer_identity_fixture f on f.manual_customer_id=c.id
  ),
  'Updated WhatsApp Name',
  'WhatsApp profile refresh updates the shared customer without changing identity'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.resolve_sellertray_whatsapp_customer(uuid,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.resolve_sellertray_whatsapp_customer(uuid,text,text)','EXECUTE'),
  'WhatsApp customer resolver remains service-only'
);

do $$
begin
  begin
    perform public.resolve_sellertray_whatsapp_customer(
      (select tenant_id from sellertray_customer_identity_fixture),
      '+2348033333333',
      'Invalid WhatsApp Sender'
    );
  exception when sqlstate '22023' then
    update sellertray_customer_identity_fixture set invalid_whatsapp_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select invalid_whatsapp_rejected from sellertray_customer_identity_fixture),
  'WhatsApp resolver accepts provider digits only and rejects formatted sender IDs'
);

select * from extensions.finish();
rollback;
