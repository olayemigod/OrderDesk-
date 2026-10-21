begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

create temp table sellertray_c1a_role_fixture (
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  tenant_id uuid not null
) on commit drop;

insert into sellertray_c1a_role_fixture(owner_user_id,manager_user_id,tenant_id)
values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'c1a-role-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_c1a_role_fixture
union all
select manager_user_id,'c1a-role-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_c1a_role_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C1A Role Lifecycle Tenant','c1a-role-'||substr(tenant_id::text,1,8),'C1AR-'||upper(substr(tenant_id::text,1,6)),'trial'
from sellertray_c1a_role_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_c1a_role_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_c1a_role_fixture;

select public.set_sellertray_member_capability(
  tenant_id,manager_user_id,'can_accept_commercial_agreements',true,owner_user_id
) from sellertray_c1a_role_fixture;

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_c1a_role_fixture),
    (select manager_user_id from sellertray_c1a_role_fixture),
    'can_accept_commercial_agreements'
  ),
  'Manager begins with explicit Owner-delegated commercial signing authority'
);

select public.change_orderdesk_team_member(
  tenant_id,owner_user_id,manager_user_id,'set_role','staff'
) from sellertray_c1a_role_fixture;

select extensions.is(
  (select tm.role from public.tenant_members tm join sellertray_c1a_role_fixture f
    on tm.tenant_id=f.tenant_id and tm.user_id=f.manager_user_id),
  'staff'::text,
  'demotion changes the Manager to Cashier/Staff'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_c1a_role_fixture),
    (select manager_user_id from sellertray_c1a_role_fixture),
    'can_accept_commercial_agreements'
  )
  and exists(
    select 1 from public.tenant_member_capabilities c join sellertray_c1a_role_fixture f
      on c.tenant_id=f.tenant_id and c.user_id=f.manager_user_id
    where c.capability='can_accept_commercial_agreements' and c.allowed=false
  ),
  'demotion revokes the stored commercial signing override'
);

select extensions.ok(
  exists(
    select 1 from public.tenant_member_capability_events e join sellertray_c1a_role_fixture f
      on e.tenant_id=f.tenant_id and e.user_id=f.manager_user_id
    where e.capability='can_accept_commercial_agreements'
      and e.previous_allowed=true
      and e.new_allowed=false
      and e.actor_user_id=f.owner_user_id
  ),
  'demotion revocation is immutably audited to the Owner actor'
);

select public.change_orderdesk_team_member(
  tenant_id,owner_user_id,manager_user_id,'set_role','manager'
) from sellertray_c1a_role_fixture;

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_c1a_role_fixture),
    (select manager_user_id from sellertray_c1a_role_fixture),
    'can_accept_commercial_agreements'
  ),
  're-promotion does not silently restore the old signing delegation'
);

select public.set_sellertray_member_capability(
  tenant_id,manager_user_id,'can_accept_commercial_agreements',true,owner_user_id
) from sellertray_c1a_role_fixture;

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_c1a_role_fixture),
    (select manager_user_id from sellertray_c1a_role_fixture),
    'can_accept_commercial_agreements'
  ),
  'Owner can explicitly delegate signing authority again after re-promotion'
);

select public.change_orderdesk_team_member(
  tenant_id,owner_user_id,manager_user_id,'remove',null
) from sellertray_c1a_role_fixture;

select extensions.ok(
  not exists(
    select 1 from public.tenant_members tm join sellertray_c1a_role_fixture f
      on tm.tenant_id=f.tenant_id and tm.user_id=f.manager_user_id
  )
  and exists(
    select 1 from public.tenant_member_capabilities c join sellertray_c1a_role_fixture f
      on c.tenant_id=f.tenant_id and c.user_id=f.manager_user_id
    where c.capability='can_accept_commercial_agreements' and c.allowed=false
  )
  and (
    select count(*) from public.tenant_member_capability_events e join sellertray_c1a_role_fixture f
      on e.tenant_id=f.tenant_id and e.user_id=f.manager_user_id
    where e.capability='can_accept_commercial_agreements'
      and e.previous_allowed=true and e.new_allowed=false
      and e.actor_user_id=f.owner_user_id
  ) >= 2,
  'removal revokes and audits any active signing delegation before membership deletion'
);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,manager_user_id,'manager' from sellertray_c1a_role_fixture;

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_c1a_role_fixture),
    (select manager_user_id from sellertray_c1a_role_fixture),
    'can_accept_commercial_agreements'
  ),
  're-added Manager requires a fresh Owner signing delegation'
);

select * from extensions.finish();
rollback;
