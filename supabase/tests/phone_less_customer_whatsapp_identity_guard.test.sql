begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create temp table optional_phone_fixture (
  tenant_id uuid default gen_random_uuid(),
  owner_id uuid default gen_random_uuid(),
  id_one uuid,
  id_two uuid,
  id_phone uuid,
  walk_in_id uuid
) on commit drop;
insert into optional_phone_fixture default values;

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'optional-phone-'||left(owner_id::text,8)||'@example.com',
  'authenticated','authenticated',now(),now() from optional_phone_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Optional phone test','opc-'||left(tenant_id::text,8),
 'OPC','active' from optional_phone_fixture;
update public.tenant_subscriptions s set status='active',trial_ends_at=null,grace_ends_at=null
from optional_phone_fixture f where f.tenant_id=s.tenant_id;
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from optional_phone_fixture;
select set_config('request.jwt.claim.sub',owner_id::text,true) from optional_phone_fixture;

-- A reserved internal key must never be interpreted as a WhatsApp sender.
insert into public.customers(tenant_id,wa_id,display_name,phone,updated_at)
select tenant_id,'manual:unlinked:abcd2348-0123-4567-8abc-abcdefabcdef','Unlinked collision fixture',null,now()
from optional_phone_fixture;
update optional_phone_fixture f set id_phone=public.resolve_sellertray_whatsapp_customer(f.tenant_id,'2348012345678','WhatsApp sender');
select extensions.ok(exists (
  select 1 from public.customers c where c.tenant_id=f.tenant_id
  and c.wa_id='manual:unlinked:abcd2348-0123-4567-8abc-abcdefabcdef' and c.phone is null
), 'WhatsApp must not reinterpret internal manual UUID digits') from optional_phone_fixture f;
-- Use a second numeric sender not already associated with the existing phone fixture.
insert into public.customers(tenant_id,wa_id,display_name,phone,updated_at)
select tenant_id,'manual:unlinked:abcd2348-0999-9999-9abc-abcdefabcdef','Unlinked unique collision fixture',null,now()
from optional_phone_fixture;
update optional_phone_fixture f set id_phone=public.resolve_sellertray_whatsapp_customer(f.tenant_id,'2348099999999','New WhatsApp sender');
select extensions.ok(exists (
  select 1 from public.customers c where c.tenant_id=f.tenant_id
  and c.wa_id='manual:unlinked:abcd2348-0999-9999-9abc-abcdefabcdef' and c.phone is null and c.id<>f.id_phone
), 'New WhatsApp sender cannot claim a name-only customer by internal key digits') from optional_phone_fixture f;
select extensions.ok(not has_function_privilege('authenticated','public.resolve_sellertray_pos_customer(uuid,uuid,text,text)','EXECUTE'),'Internal POS resolver remains private');
select extensions.ok(not has_function_privilege('authenticated','public.resolve_sellertray_whatsapp_customer(uuid,text,text)','EXECUTE'),'Internal WhatsApp resolver remains private');
select * from extensions.finish();
rollback;
