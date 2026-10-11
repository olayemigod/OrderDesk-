begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

create temp table sellertray_inventory_capability_audit_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  mutation_rejected boolean not null default false
) on commit drop;

insert into sellertray_inventory_capability_audit_fixture(
  tenant_id,owner_user_id,staff_user_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'inventory-audit-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_inventory_capability_audit_fixture
union all
select staff_user_id,
  'inventory-audit-staff-'||substr(staff_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_inventory_capability_audit_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Inventory Permission Audit Test',
  'sellertray-inventory-audit-'||substr(tenant_id::text,1,8),'IPA','active'
from sellertray_inventory_capability_audit_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_inventory_capability_audit_fixture
union all
select tenant_id,staff_user_id,'staff'
from sellertray_inventory_capability_audit_fixture;

select extensions.ok(
  not has_table_privilege(
    'authenticated','public.tenant_member_capability_events','SELECT'
  ),
  'merchant clients cannot read raw permission audit rows directly'
);

select extensions.ok(
  public.set_sellertray_member_capability(
    (select tenant_id from sellertray_inventory_capability_audit_fixture),
    (select staff_user_id from sellertray_inventory_capability_audit_fixture),
    'can_receive_stock',true,
    (select owner_user_id from sellertray_inventory_capability_audit_fixture)
  ),
  'Owner can grant Staff receiving authority'
);

select extensions.is(
  (
    select count(*)::integer
    from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_inventory_capability_audit_fixture)
      and e.user_id=(select staff_user_id from sellertray_inventory_capability_audit_fixture)
      and e.capability='can_receive_stock'
  ),
  1,
  'first effective permission change creates one immutable audit event'
);

select extensions.ok(
  exists(
    select 1
    from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_inventory_capability_audit_fixture)
      and e.user_id=(select staff_user_id from sellertray_inventory_capability_audit_fixture)
      and e.capability='can_receive_stock'
      and e.previous_allowed=false
      and e.new_allowed=true
      and e.actor_user_id=(select owner_user_id from sellertray_inventory_capability_audit_fixture)
  ),
  'permission audit preserves previous/new authority and accountable actor'
);

select public.set_sellertray_member_capability(
  (select tenant_id from sellertray_inventory_capability_audit_fixture),
  (select staff_user_id from sellertray_inventory_capability_audit_fixture),
  'can_receive_stock',true,
  (select owner_user_id from sellertray_inventory_capability_audit_fixture)
);

select extensions.is(
  (
    select count(*)::integer
    from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_inventory_capability_audit_fixture)
      and e.user_id=(select staff_user_id from sellertray_inventory_capability_audit_fixture)
      and e.capability='can_receive_stock'
  ),
  1,
  'repeating the same permission decision does not fabricate another audit event'
);

select extensions.ok(
  not public.set_sellertray_member_capability(
    (select tenant_id from sellertray_inventory_capability_audit_fixture),
    (select staff_user_id from sellertray_inventory_capability_audit_fixture),
    'can_receive_stock',false,
    (select owner_user_id from sellertray_inventory_capability_audit_fixture)
  ),
  'Owner can revoke Staff receiving authority'
);

select extensions.ok(
  exists(
    select 1
    from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_inventory_capability_audit_fixture)
      and e.user_id=(select staff_user_id from sellertray_inventory_capability_audit_fixture)
      and e.capability='can_receive_stock'
      and e.previous_allowed=true
      and e.new_allowed=false
  ),
  'revocation audit preserves the effective before/after decision'
);

do $$
begin
  begin
    update public.tenant_member_capability_events
    set new_allowed=true
    where tenant_id=(select tenant_id from sellertray_inventory_capability_audit_fixture)
      and user_id=(select staff_user_id from sellertray_inventory_capability_audit_fixture);
  exception when sqlstate '55000' then
    update sellertray_inventory_capability_audit_fixture set mutation_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select mutation_rejected from sellertray_inventory_capability_audit_fixture),
  'permission audit events cannot be rewritten'
);

delete from public.tenant_members
where tenant_id=(select tenant_id from sellertray_inventory_capability_audit_fixture)
  and user_id=(select staff_user_id from sellertray_inventory_capability_audit_fixture);

select extensions.is(
  (
    select count(*)::integer
    from public.tenant_member_capabilities c
    where c.tenant_id=(select tenant_id from sellertray_inventory_capability_audit_fixture)
      and c.user_id=(select staff_user_id from sellertray_inventory_capability_audit_fixture)
  ),
  0,
  'current permission overrides are removed when Staff membership is removed'
);

select extensions.is(
  (
    select count(*)::integer
    from public.tenant_member_capability_events e
    where e.tenant_id=(select tenant_id from sellertray_inventory_capability_audit_fixture)
      and e.user_id=(select staff_user_id from sellertray_inventory_capability_audit_fixture)
      and e.capability='can_receive_stock'
  ),
  2,
  'historical permission audit remains reviewable after Staff membership removal'
);

select * from extensions.finish();
rollback;