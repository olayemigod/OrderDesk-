begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create temp table oa5_invite_fixture (
  admin_id uuid not null default gen_random_uuid(),
  installer_id uuid not null default gen_random_uuid(),
  normal_user_id uuid not null default gen_random_uuid(),
  tenant_id uuid not null default gen_random_uuid(),
  worker_id uuid,
  invite_command_id uuid not null default gen_random_uuid(),
  reconcile_command_id uuid not null default gen_random_uuid(),
  email text
) on commit drop;
insert into oa5_invite_fixture default values;
update oa5_invite_fixture
  set email='oa5-reserved-'||left(installer_id::text,8)||'@example.com';

insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at)
select admin_id,'oa5-reserve-admin-'||left(admin_id::text,8)||'@example.com',
  'authenticated','authenticated',now(),now(),now()
  from oa5_invite_fixture
union all
select installer_id,email,'authenticated','authenticated',now(),now(),now()
  from oa5_invite_fixture
union all
select normal_user_id,'oa5-normal-'||left(normal_user_id::text,8)||'@example.com',
  'authenticated','authenticated',now(),now(),now()
  from oa5_invite_fixture;
insert into public.platform_admins(user_id,role)
  select admin_id,'admin' from oa5_invite_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'OA5 Installer Reservation Test',
  'oa5-reserve-'||left(tenant_id::text,8),'OIR','trial'
from oa5_invite_fixture;
insert into public.sellertray_setup_workers(
  worker_code,display_name,active,max_concurrent_setups,travel_buffer_minutes)
select 'OIR-W-'||left(installer_id::text,8),'Reserved Setup Worker',true,1,0
from oa5_invite_fixture;
update oa5_invite_fixture f set worker_id=w.id
from public.sellertray_setup_workers w
where w.worker_code='OIR-W-'||left(f.installer_id::text,8);

select extensions.is(
  public.platform_admin_reserve_setup_installer_invitation(
    f.admin_id,f.email,f.worker_id,f.invite_command_id,'Approved installer invitation setup'
  ),f.invite_command_id,'Admin reserves the exact ProcessEdge installer identity'
) from oa5_invite_fixture f;

select extensions.is(
  public.platform_admin_reserve_setup_installer_invitation(
    f.admin_id,f.email,f.worker_id,f.invite_command_id,'Approved installer invitation setup'
  ),f.invite_command_id,'Reservation retries are idempotent for exact command facts'
) from oa5_invite_fixture f;

select extensions.throws_ok(
  $test$select public.platform_admin_reserve_setup_installer_invitation(
    f.admin_id,'other-'||f.email,f.worker_id,f.invite_command_id,
    'Approved installer invitation setup'
  ) from oa5_invite_fixture f$test$,
  '23505',null::text,'A reused invitation command cannot change the reserved email'
);

select extensions.ok(
  public.get_sellertray_setup_installer_profile(f.installer_id)->>'isInstaller'='true'
  and public.get_sellertray_setup_installer_profile(f.installer_id)->>'status'='pending',
  'Reserved and unlinked Auth recipient remains an internal installer at first login'
) from oa5_invite_fixture f;

select extensions.throws_ok(
  $test$insert into public.tenant_members(tenant_id,user_id,role)
    select tenant_id,installer_id,'owner' from oa5_invite_fixture$test$,
  '42501',null::text,'Reserved installer cannot provision or join a merchant Business'
);

select extensions.throws_ok(
  $test$insert into public.platform_admins(user_id,role)
    select installer_id,'admin' from oa5_invite_fixture$test$,
  '42501',null::text,'Reserved installer cannot escalate to Platform Admin'
);

select extensions.ok(
  public.platform_admin_begin_setup_installer_delivery(
    f.admin_id,f.invite_command_id),
  'First delivery attempt is durably marked before external email'
) from oa5_invite_fixture f;

select extensions.ok(
  not public.platform_admin_begin_setup_installer_delivery(
    f.admin_id,f.invite_command_id),
  'Retry of attempted invitation does not authorize a second email'
) from oa5_invite_fixture f;

select extensions.ok(
  public.platform_admin_bind_setup_installer_invitation(
    f.admin_id,f.invite_command_id,f.installer_id),
  'Auth user is bound to reserved installer identity independently of worker linkage'
) from oa5_invite_fixture f;

select extensions.is(
  public.platform_admin_reconcile_setup_installer_invitation(
    f.admin_id,f.invite_command_id,f.reconcile_command_id,
    'Reconcile ProcessEdge installer after email delivery'
  ),f.installer_id,'Admin can reconcile without resending mail'
) from oa5_invite_fixture f;

select extensions.ok(
  exists(select 1 from public.sellertray_internal_setup_staff s
    join oa5_invite_fixture f on f.installer_id=s.user_id
    where s.status='pending' and s.worker_id=f.worker_id)
  and exists(select 1 from public.sellertray_internal_setup_invitation_reservations r
    join oa5_invite_fixture f on f.invite_command_id=r.command_id
    where r.auth_user_id=f.installer_id and r.linked_at is not null),
  'Reconciliation links pending internal staff and retains invitation evidence'
);

select extensions.is(
  public.platform_admin_reconcile_setup_installer_invitation(
    f.admin_id,f.invite_command_id,f.reconcile_command_id,
    'Reconcile ProcessEdge installer after email delivery'
  ),f.installer_id,'Reconciliation replay does not duplicate staff registration'
) from oa5_invite_fixture f;

select extensions.throws_ok(
  $test$insert into public.tenant_members(tenant_id,user_id,role)
    select tenant_id,installer_id,'staff' from oa5_invite_fixture$test$,
  '42501',null::text,'Linked installer also cannot accept Team invitations'
);

select extensions.ok(
  not has_table_privilege('authenticated',
    'public.sellertray_internal_setup_invitation_reservations','SELECT')
  and not has_function_privilege('authenticated',
    'public.platform_admin_reserve_setup_installer_invitation(uuid,text,uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.platform_admin_reconcile_setup_installer_invitation(uuid,uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.sellertray_user_is_reserved_setup_installer(uuid)','EXECUTE'),
  'Invitation identity authority is server-only, not exposed to merchant JWTs'
);

select extensions.ok(
  public.get_sellertray_setup_installer_profile(f.normal_user_id)->>'isInstaller'='false',
  'Ordinary non-installer users are not incorrectly classified as internal staff'
) from oa5_invite_fixture f;

select * from extensions.finish();
rollback;