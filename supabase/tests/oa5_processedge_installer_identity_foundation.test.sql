begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create temp table oa5_installer_fixture (
 admin_id uuid not null default gen_random_uuid(),
 support_id uuid not null default gen_random_uuid(),
 installer_id uuid not null default gen_random_uuid(),
 unverified_id uuid not null default gen_random_uuid(),
 tenant_id uuid not null default gen_random_uuid(),
 branch_id uuid,
 worker_id uuid,
 area_id uuid,
 price_id uuid,
 commercial_order_id uuid,
 appointment_id uuid,
 assignment_id uuid,
 command_link uuid not null default gen_random_uuid(),
 command_status uuid not null default gen_random_uuid(),
 command_assign uuid not null default gen_random_uuid(),
 command_revoke uuid not null default gen_random_uuid(),
 valid_until timestamptz not null default (now()+interval '2 days')
) on commit drop;
insert into oa5_installer_fixture default values;

insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at)
select admin_id,'oa5-installer-admin-'||left(admin_id::text,8)||'@example.com',
'authenticated','authenticated',now(),now(),now()
from oa5_installer_fixture
union all
select support_id,'oa5-installer-support-'||left(support_id::text,8)||'@example.com',
'authenticated','authenticated',now(),now(),now()
from oa5_installer_fixture
union all
select installer_id,'oa5-installer-staff-'||left(installer_id::text,8)||'@example.com',
'authenticated','authenticated',now(),now(),now()
from oa5_installer_fixture
union all
select unverified_id,'oa5-installer-unverified-'||left(unverified_id::text,8)||'@example.com',
'authenticated','authenticated',null,now(),now()
from oa5_installer_fixture;

insert into public.platform_admins(user_id,role)
select admin_id,'admin' from oa5_installer_fixture
union all
select support_id,'support' from oa5_installer_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'OA5 Installer Authorization Test',
  'oa5-install-'||left(tenant_id::text,8),'OAI','trial'
from oa5_installer_fixture;

update oa5_installer_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.sellertray_setup_workers(worker_code,display_name,active,max_concurrent_setups,travel_buffer_minutes)
select 'OAI-W-'||left(installer_id::text,8),'ProcessEdge Test Installer',true,1,0
from oa5_installer_fixture f;
-- Capture the exact worker created for this test.
update oa5_installer_fixture f set worker_id=w.id
from public.sellertray_setup_workers w where w.worker_code='OAI-W-'||left(f.installer_id::text,8);

insert into public.sellertray_setup_service_areas(code,name,active)
select 'OAI-A-'||left(tenant_id::text,8),'OA5 Installer Service Area',true
from oa5_installer_fixture;
update oa5_installer_fixture f set area_id=a.id
from public.sellertray_setup_service_areas a where a.code='OAI-A-'||left(f.tenant_id::text,8);

with created as (
 insert into public.sellertray_commercial_price_versions(
   price_kind,currency,gross_amount,effective_from,change_reason,
   created_by_user_id,approved_by_user_id,approved_at
 )
 select 'branch_setup','NGN',200,now()-interval '1 day',
 'ProcessEdge installer test Branch setup price',admin_id,admin_id,now()
 from oa5_installer_fixture
 returning id
)
update oa5_installer_fixture set price_id=(select id from created);

with created as (
 insert into public.sellertray_commercial_orders(
   tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
 )
 select tenant_id,'OAI-'||upper(left(tenant_id::text,8)),'NGN',200,now(),admin_id
 from oa5_installer_fixture returning id
)
update oa5_installer_fixture set commercial_order_id=(select id from created);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,
  source_price_version_id,branch_id,description_snapshot
)
select tenant_id,commercial_order_id,1,'branch_setup',price_id,branch_id,
  'ProcessEdge controlled installer Branch setup'
from oa5_installer_fixture;

with created as (
 insert into public.sellertray_commercial_setup_appointments(
   tenant_id,commercial_order_id,branch_id,worker_id,service_area_id,
   scheduled_start_at,scheduled_end_at,travel_buffer_minutes_snapshot,
   status,created_by_user_id
 )
 select tenant_id,commercial_order_id,branch_id,worker_id,area_id,
  now()+interval '6 hours',now()+interval '8 hours',0,'scheduled',admin_id
 from oa5_installer_fixture returning id
)
update oa5_installer_fixture set appointment_id=(select id from created);

select extensions.ok(
  not public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,now()
  ),'Scheduling worker does not confer installation privilege without an account and assignment'
) from oa5_installer_fixture f;

select extensions.throws_ok(
  $test$select public.platform_admin_link_setup_installer(
    f.support_id,f.installer_id,f.worker_id,gen_random_uuid(),
    'Support must not create internal role') from oa5_installer_fixture f$test$,
  '42501',null::text,'Support cannot create ProcessEdge installer accounts'
);

select extensions.is(
  public.platform_admin_link_setup_installer(
    f.admin_id,f.installer_id,f.worker_id,f.command_link,
    'Approved dedicated ProcessEdge staff account'
  ),f.installer_id,'Platform Admin links verified staff to exact setup worker'
) from oa5_installer_fixture f;

select extensions.is(
  public.platform_admin_link_setup_installer(
    f.admin_id,f.installer_id,f.worker_id,f.command_link,
    'Approved dedicated ProcessEdge staff account'
  ),f.installer_id,'Exact account-link command replay is idempotent'
) from oa5_installer_fixture f;

select extensions.ok(
  exists(select 1 from public.sellertray_internal_setup_staff s
   join oa5_installer_fixture f on f.installer_id=s.user_id
   where s.staff_role='setup_installer' and s.status='pending'
      and s.worker_id=f.worker_id)
  and not exists(select 1 from public.platform_admins pa
   join oa5_installer_fixture f on f.installer_id=pa.user_id),
  'Pending installer account remains separate from Platform Admin and Merchant membership'
);

select extensions.ok(
  not public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,now()
  ),'Pending installer role grants no Branch setup authority'
) from oa5_installer_fixture f;

select extensions.throws_ok(
  $test$select public.platform_admin_set_setup_installer_status(
    f.support_id,f.installer_id,'active',gen_random_uuid(),
    'Support elevation prohibited') from oa5_installer_fixture f$test$,
  '42501',null::text,'Support cannot activate an installer'
);

select extensions.is(
 public.platform_admin_set_setup_installer_status(
   f.admin_id,f.installer_id,'active',f.command_status,
   'Identity verified; approve internal setup installer'
 ),'active','Platform Admin activates verified installer'
) from oa5_installer_fixture f;

select extensions.is(
  public.platform_admin_set_setup_installer_status(
    f.admin_id,f.installer_id,'active',f.command_status,
    'Identity verified; approve internal setup installer'
  ),'active','Exact installer-status command replay does not duplicate events'
) from oa5_installer_fixture f;

update oa5_installer_fixture f set assignment_id=public.platform_admin_assign_setup_installer(
  f.admin_id,f.installer_id,f.tenant_id,f.appointment_id,f.valid_until,
  f.command_assign,'Assigned to controlled Branch setup appointment'
);

select extensions.ok(
  public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,now()
  ),'Active installer may access only their assigned purchased Branch appointment'
) from oa5_installer_fixture f;

select extensions.ok(
  not public.sellertray_setup_installer_has_assignment(
    f.installer_id,gen_random_uuid(),f.branch_id,f.appointment_id,now()
  )
  and not public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,gen_random_uuid(),f.appointment_id,now()
  )
  and not public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,gen_random_uuid(),now()
  ),'Wrong Business, Branch or appointment never matches ProcessEdge installer assignment'
) from oa5_installer_fixture f;

select extensions.ok(
  not public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,now()+interval '3 days'
  ),'Expired appointment assignment fails closed without cached permission'
) from oa5_installer_fixture f;

select extensions.throws_ok(
  $test$select public.platform_admin_assign_setup_installer(
    f.support_id,f.installer_id,f.tenant_id,f.appointment_id,
    f.valid_until,gen_random_uuid(),'Unauthorized assignment attempt'
  ) from oa5_installer_fixture f$test$,'42501',null::text,
  'Support cannot assign installer to an appointment'
);

select extensions.ok(
  public.platform_admin_revoke_setup_installer_assignment(
    f.admin_id,f.assignment_id,f.command_revoke,'Setup staff assignment cancelled'
  ),'Admin may revoke assigned installer access with reason'
) from oa5_installer_fixture f;

select extensions.ok(
  not public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,now()
  ),'Revoked installer assignment loses Branch access immediately'
) from oa5_installer_fixture f;

select extensions.ok(
  public.platform_admin_revoke_setup_installer_assignment(
    f.admin_id,f.assignment_id,f.command_revoke,'Setup staff assignment cancelled'
  ),'Exact assignment revocation replay is safe'
) from oa5_installer_fixture f;

select extensions.throws_ok(
  $test$update public.sellertray_internal_setup_staff_events
    set reason='Rewrite' where event_type='registered'$test$,
  '55000',null::text,'Staff identity and assignment history is append-only'
);

select extensions.ok(
  not has_table_privilege('authenticated',
    'public.sellertray_internal_setup_staff','SELECT')
  and not has_table_privilege('authenticated',
    'public.sellertray_internal_setup_staff_assignments','SELECT')
  and not has_function_privilege('authenticated',
    'public.platform_admin_link_setup_installer(uuid,uuid,uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.platform_admin_assign_setup_installer(uuid,uuid,uuid,uuid,timestamptz,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.sellertray_setup_installer_has_assignment(uuid,uuid,uuid,uuid,timestamptz)','EXECUTE'),
  'New internal staff and assignment authority is not directly exposed to merchant/mobile JWT'
);

select extensions.ok(
  not exists(select 1 from public.tenant_members tm
    join oa5_installer_fixture f on f.installer_id=tm.user_id),
  'Setup installer identity never creates merchant Team membership or selling authority'
);

select * from extensions.finish();
rollback;
