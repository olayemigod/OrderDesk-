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

update optional_phone_fixture f
set id_one=public.create_sellertray_customer(f.tenant_id,'Same Customer',null,null);
update optional_phone_fixture f
set id_two=public.create_sellertray_customer(f.tenant_id,'Same Customer','  ',null);

select extensions.ok(id_one is not null and id_two is not null and id_one<>id_two,
  'Two name-only customers remain distinct') from optional_phone_fixture;
select extensions.ok((select count(*)=2 from public.customers c
  where c.tenant_id=f.tenant_id and c.id in (f.id_one,f.id_two)
  and c.phone is null and c.wa_id like 'manual:unlinked:%'),
  'Phone-less customers do not inherit a fake phone or walk-in identifier')
from optional_phone_fixture f;
select extensions.is(
  public.resolve_sellertray_pos_customer(f.tenant_id,f.id_one,null,null),f.id_one,
  'POS reuses stable id of phone-less customer') from optional_phone_fixture f;

update optional_phone_fixture f
set id_phone=public.create_sellertray_customer(
  f.tenant_id,'Telephone Customer','+2348012345678',null);
select extensions.is(
  public.create_sellertray_customer(f.tenant_id,'Telephone Customer','+2348012345678',null),
  f.id_phone,'Phone-based matching remains unchanged') from optional_phone_fixture f;

-- Read the inserted walk-in on the next SQL statement, after the
-- volatile resolver's insert is visible to the subsequent statement snapshot.
update optional_phone_fixture f
set walk_in_id=public.resolve_sellertray_pos_customer(f.tenant_id,null,null,null);
select extensions.ok(
  exists (select 1 from public.customers c where c.tenant_id=f.tenant_id
    and c.id=f.walk_in_id and c.wa_id='pos:walk-in')
  and f.walk_in_id not in (f.id_one,f.id_two),
  'Anonymous walk-in retains a separate stable identity'
) from optional_phone_fixture f;

select extensions.throws_ok(
  format('select public.create_sellertray_customer(%L,%L,%L,%L)',
   f.tenant_id,'Invalid Phone','not-a-number',null),
  '22023',null::text,'Invalid supplied phone remains rejected')
from optional_phone_fixture f;
select * from extensions.finish();
rollback;
