begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(25);

select extensions.has_column('public','tenants','retired_at','Business retirement marker exists');
select extensions.has_column('public','tenants','retirement_reason','Business retirement reason is retained');
select extensions.has_column('public','tenants','retirement_command_id','Business retirement is command-idempotent');
select extensions.has_function('public','retire_sellertray_tenant_admin',array['uuid','uuid','text','uuid'],'governed Platform Admin retirement command exists');
select extensions.ok(has_function_privilege('service_role','public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid)','EXECUTE'),'service boundary can execute retirement');
select extensions.ok(not has_function_privilege('authenticated','public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid)','EXECUTE'),'merchant clients cannot execute Business retirement');
select extensions.ok(position('retired_at is null' in pg_get_functiondef('public.sellertray_list_businesses_for_current_user()'::regprocedure))>0,'merchant Business selector excludes retired Businesses');
select extensions.ok(position('retired_at is not null' in pg_get_functiondef('public.orderdesk_subscription_can_write(uuid)'::regprocedure))>0,'retired Businesses fail the compatibility write gate');
select extensions.ok(position('retired_at is null' in pg_get_functiondef('public.platform_admin_merchant_portfolio(uuid,text,text,text,uuid,integer)'::regprocedure))>0,'Admin merchant portfolio excludes retired Businesses');
select extensions.ok(position('retired_at is null' in pg_get_functiondef('public.platform_admin_business_summary_pre_oa5b(uuid,integer)'::regprocedure))>0,'Business/Revenue summary excludes retired Businesses');
select extensions.ok(position('retired_at is null' in pg_get_functiondef('public.platform_admin_onboarding_commercial_report(uuid,integer)'::regprocedure))>0,'Onboarding report excludes retired Businesses');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.tenants'::regclass and tgname='guard_sellertray_tenant_retirement' and not tgisinternal),'retirement evidence is guarded against mutation');
select extensions.ok(
  exists(
    select 1
    from pg_constraint
    where conname='platform_admin_capability_code_check'
      and conrelid='public.platform_admin_capability_grant_versions'::regclass
      and position('admin.merchants.retire' in pg_get_constraintdef(oid))>0
  ),
  'Business retirement capability is registrable for scoped grant or denial'
);

create temp table retirement_fixture(
  actor uuid,
  tenant uuid,
  branch uuid,
  order_one uuid,
  order_two uuid,
  worker uuid,
  area uuid,
  appointment_one uuid,
  appointment_two uuid,
  request_id uuid,
  command_id uuid
);
insert into retirement_fixture
select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

insert into auth.users(id,email,aud,role)
select actor,'retirement-setup-'||actor||'@example.com','authenticated','authenticated'
from retirement_fixture;
insert into public.platform_admins(user_id,role)
select actor,'admin' from retirement_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant,'Retirement Setup Fixture','retirement-setup-'||tenant,'RTA','active'
from retirement_fixture;
insert into public.branches(id,tenant_id,code,name,is_default,is_active)
select branch,tenant,'MAIN','Main Branch',true,true
from retirement_fixture;

insert into public.sellertray_commercial_orders(
  id,tenant_id,order_reference,currency,total_gross_amount,created_by_user_id
)
select order_one,tenant,'ST/RTA/000001','NGN',5000,actor from retirement_fixture
union all
select order_two,tenant,'ST/RTA/000002','NGN',5000,actor from retirement_fixture;

insert into public.sellertray_setup_service_areas(id,code,name)
select area,'RET-LAG','Retirement Lagos' from retirement_fixture;
insert into public.sellertray_setup_workers(id,worker_code,display_name,max_concurrent_setups,travel_buffer_minutes)
select worker,'RET-WORKER','Retirement Worker',1,0 from retirement_fixture;

insert into public.sellertray_commercial_setup_appointments(
  id,tenant_id,commercial_order_id,branch_id,worker_id,service_area_id,
  scheduled_start_at,scheduled_end_at,travel_buffer_minutes_snapshot,status,created_by_user_id
)
select appointment_one,tenant,order_one,branch,worker,area,
       now()+interval '7 days',now()+interval '7 days 2 hours',0,'scheduled',actor
from retirement_fixture
union all
select appointment_two,tenant,order_two,branch,worker,area,
       now()+interval '8 days',now()+interval '8 days 2 hours',0,'in_progress',actor
from retirement_fixture;

insert into public.sellertray_setup_reschedule_requests(
  id,appointment_id,tenant_id,branch_id,command_id,requested_by_user_id,
  requested_start_at,requested_end_at,merchant_note,status
)
select request_id,appointment_one,tenant,branch,gen_random_uuid(),actor,
       now()+interval '9 days',now()+interval '9 days 2 hours',
       'Please move this setup appointment','pending'
from retirement_fixture;

create temp table retirement_result as
select public.retire_sellertray_tenant_admin(
  actor,tenant,'Regression fixture retirement cleanup',command_id
) result
from retirement_fixture;

select extensions.is(
  result->>'setupAppointmentsCancelled','2',
  'retirement reports both active setup appointments cancelled'
) from retirement_result;
select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_setup_appointments a
   join retirement_fixture f on f.tenant=a.tenant_id
   where a.status='cancelled'),
  2,
  'scheduled and in-progress setup appointments are cancelled'
);
select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_setup_appointments a
   join retirement_fixture f on f.tenant=a.tenant_id
   where a.cancelled_at is not null),
  2,
  'retirement stamps setup cancellation time'
);
select extensions.is(
  (select r.status
   from public.sellertray_setup_reschedule_requests r
   join retirement_fixture f on f.request_id=r.id),
  'withdrawn',
  'pending setup reschedule request is withdrawn'
);
select extensions.is(
  (select r.resolved_by_user_id
   from public.sellertray_setup_reschedule_requests r
   join retirement_fixture f on f.request_id=r.id),
  (select actor from retirement_fixture),
  'withdrawn setup reschedule records the retirement actor'
);
select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_setup_appointment_events e
   join retirement_fixture f on f.tenant=e.tenant_id
   where e.event_type='cancelled'
     and e.details->>'source'='business_retirement'),
  2,
  'retirement appends one cancellation event for each active setup appointment'
);
select extensions.is(
  (select count(distinct e.details->>'previousStatus')::integer
   from public.sellertray_commercial_setup_appointment_events e
   join retirement_fixture f on f.tenant=e.tenant_id
   where e.event_type='cancelled'
     and e.details->>'source'='business_retirement'),
  2,
  'retirement cancellation evidence preserves scheduled and in-progress prior states'
);
select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_setup_appointments a
   join retirement_fixture f on f.tenant=a.tenant_id
   where a.status in ('scheduled','in_progress')),
  0,
  'retired Business no longer consumes setup capacity'
);
select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_setup_appointments a
   join retirement_fixture f on f.tenant=a.tenant_id),
  2,
  'setup appointment history is retained after retirement'
);

create temp table retirement_replay as
select public.retire_sellertray_tenant_admin(
  actor,tenant,'Regression fixture retirement cleanup',command_id
) result
from retirement_fixture;

select extensions.is(
  result->>'alreadyRetired','true',
  'same retirement command replays idempotently'
) from retirement_replay;
select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_setup_appointment_events e
   join retirement_fixture f on f.tenant=e.tenant_id
   where e.event_type='cancelled'
     and e.details->>'source'='business_retirement'),
  2,
  'retirement replay does not duplicate setup cancellation evidence'
);
select extensions.is(
  (select detail->>'setupAppointmentsCancelled'
   from public.platform_admin_audit a
   join retirement_fixture f on f.tenant=a.tenant_id
   where a.action='tenant_retired'
   order by a.created_at desc
   limit 1),
  '2',
  'retirement audit records setup-capacity cleanup count'
);

select * from extensions.finish();
rollback;
