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

-- Device authority is separate from selling and is bound to both verified
-- AAL2 JWT and the same active appointment. Check both direct Mobile RPC and
-- service-only printer command boundaries.
select set_config('request.jwt.claim.sub',installer_id::text,true),
       set_config('request.jwt.claims',jsonb_build_object(
         'sub',installer_id,'role','authenticated','aal','aal1')::text,true)
from oa5_installer_fixture;
select extensions.ok(
  not public.sellertray_setup_installer_device_allowed(
    f.tenant_id,f.branch_id,f.installer_id,false),
  'Installer AAL1 cannot inspect or configure Branch devices'
) from oa5_installer_fixture f;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',installer_id,'role','authenticated','aal','aal2')::text,true)
from oa5_installer_fixture;
select extensions.ok(
  public.sellertray_setup_installer_device_allowed(
    f.tenant_id,f.branch_id,f.installer_id,false),
  'Verified installer AAL2 may prepare exactly their assigned Branch devices'
) from oa5_installer_fixture f;
select extensions.lives_ok(
  $test$select r.id from oa5_installer_fixture f
    cross join lateral public.get_sellertray_accessible_registers(
      f.tenant_id,f.branch_id) r$test$,
  'AAL2 assigned installer may list Branch setup registers without merchant membership'
);
select extensions.ok(
  not public.sellertray_setup_installer_device_allowed(
    f.tenant_id,gen_random_uuid(),f.installer_id,false),
  'AAL2 does not grant unrelated Branch hardware access'
) from oa5_installer_fixture f;

-- The assigned installer creates a setup register through the one audited
-- RPC. The same request key is safe after a lost Mobile response.
select extensions.lives_ok(
  $test$select public.save_sellertray_installer_register(
    f.tenant_id,f.branch_id,f.appointment_id,
    'OAI-SETUP-01','Front Counter Setup','oa5-installer-register-setup-01'
  ) from oa5_installer_fixture f$test$,
  'Assigned AAL2 installer creates a register through the audited command'
);
select extensions.ok(
  (public.save_sellertray_installer_register(
    f.tenant_id,f.branch_id,f.appointment_id,
    'OAI-SETUP-01','Front Counter Setup','oa5-installer-register-setup-01'
  )->>'idempotentReplay')::boolean,
  'Exact request replay returns the same register without creating another'
) from oa5_installer_fixture f;
select extensions.ok(
  (select count(*) from public.sellertray_installer_register_commands c
    where c.request_key='oa5-installer-register-setup-01')=1
  and (select count(*) from public.sellertray_installer_register_events e
    join oa5_installer_fixture f on f.installer_id=e.actor_user_id
    where e.appointment_id=f.appointment_id and e.event_type='created')=1
  and (select count(*) from public.sellertray_registers r
    join oa5_installer_fixture f on f.tenant_id=r.tenant_id
    where r.branch_id=f.branch_id and r.code='OAI-SETUP-01')=1,
  'Exactly one register and an immutable appointment-linked created event'
);
select extensions.throws_ok(
  $test$select public.save_sellertray_installer_register(
    f.tenant_id,f.branch_id,f.appointment_id,
    'OTHER-REG','Other Register','oa5-installer-register-setup-01'
  ) from oa5_installer_fixture f$test$,
  '23505',null::text,'Same command key cannot be reused for different register facts'
);
select extensions.throws_ok(
  $test$select public.save_sellertray_installer_register(
    f.tenant_id,gen_random_uuid(),f.appointment_id,
    'OAI-BAD','Out of Scope','oa5-installer-wrong-branch-01'
  ) from oa5_installer_fixture f$test$,
  '42501',null::text,'Register preparation is denied for another Branch'
);
select extensions.throws_ok(
  $test$select public.save_sellertray_register(
    f.tenant_id,null,f.branch_id,'OAI-BYPASS','Unlogged Register',false,true
  ) from oa5_installer_fixture f$test$,
  '42501',null::text,'Direct installer writes without an audited command are blocked'
);
select extensions.throws_ok(
  $test$update public.sellertray_installer_register_events
    set after_state='{}'::jsonb where event_type='created'$test$,
  '55000',null::text,'Installer register audit history cannot be rewritten'
);
select extensions.ok(
  not has_table_privilege('authenticated',
    'public.sellertray_installer_register_commands','SELECT')
  and not has_table_privilege('authenticated',
    'public.sellertray_installer_register_events','INSERT')
  and has_function_privilege('authenticated',
    'public.save_sellertray_installer_register(uuid,uuid,uuid,text,text,text)','EXECUTE'),
  'Only the audited installer command is client-callable; event records are server-protected'
);


select set_config('request.jwt.claims','{"role":"service_role"}',true);
select extensions.ok(
  public.sellertray_setup_installer_device_allowed(
    f.tenant_id,f.branch_id,f.installer_id,true)
  and not public.sellertray_setup_installer_device_allowed(
    f.tenant_id,gen_random_uuid(),f.installer_id,true),
  'Service-only printer command uses real installer assignment and Branch scope'
) from oa5_installer_fixture f;
select extensions.ok(
  not has_function_privilege('authenticated',
    'public.save_sellertray_printer(uuid,uuid,uuid,uuid,text,text,integer,boolean,boolean,uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.request_sellertray_print_job(uuid,uuid,text,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.transition_sellertray_print_job(uuid,uuid,text,text,text,uuid)','EXECUTE'),
  'Authenticated client cannot forge the installer actor in service-only printer commands'
);
-- Existing canonical printer and test-job authorities must work under
-- service-only calls for the assigned installer; they must never allow a
-- receipt/business order print or duplicate the same print request.
alter table oa5_installer_fixture
  add column printer_id uuid,
  add column test_job_id uuid;

update oa5_installer_fixture f set printer_id=(
  public.save_sellertray_installer_printer(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,
    null,
    (select r.id from public.sellertray_registers r
      where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id
        and r.code='OAI-SETUP-01'),
    'Installer Bluetooth Test Printer','OA5-INSTALLER-HW-001',
    58,true,true,'oa5-installer-printer-save-01'
  )->>'printerId')::uuid;

select extensions.ok(
  exists(select 1 from public.sellertray_printers p
    join oa5_installer_fixture f on f.printer_id=p.id
    where p.branch_id=f.branch_id and p.tenant_id=f.tenant_id
      and p.hardware_identifier='OA5-INSTALLER-HW-001'),
  'Assigned installer configures the canonical Branch printer without merchant membership'
);

select extensions.ok(
  exists(select 1 from public.sellertray_installer_printer_commands c
    join oa5_installer_fixture f on f.appointment_id=c.appointment_id
    where c.actor_user_id=f.installer_id and c.branch_id=f.branch_id
      and c.command_type='printer_save'
      and c.command_key='oa5-installer-printer-save-01')
  and exists(select 1 from public.sellertray_installer_printer_events e
    join oa5_installer_fixture f on f.appointment_id=e.appointment_id
    where e.actor_user_id=f.installer_id and e.printer_id=f.printer_id
      and e.assignment_id=f.assignment_id and e.event_type='registered'),
  'Printer registration has immutable command, original event and exact appointment/assignment provenance'
);
select extensions.ok(
  (select count(*)=1 from public.sellertray_installer_printer_commands
    where command_key='oa5-installer-printer-save-01'),
  'Installation printer command is not duplicated by retries'
);
select extensions.throws_ok(
  $test$select public.save_sellertray_printer(
    f.tenant_id,f.printer_id,f.branch_id,
    (select r.id from public.sellertray_registers r
      where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id
        and r.code='OAI-SETUP-01'),
    'Unaudited Installer Printer','OA5-INSTALLER-HW-001',
    58,true,true,f.installer_id
  ) from oa5_installer_fixture f$test$,
  '42501',null::text,
  'Legacy printer call cannot perform unaudited staff configuration changes'
);
select extensions.ok(
  not has_function_privilege('authenticated',
    'public.save_sellertray_installer_printer(uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,boolean,boolean,text)','EXECUTE'),
  'Actor-parametrized installer printer mutation is service-role-only'
);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',installer_id,'role','authenticated','aal','aal2')::text,true)
from oa5_installer_fixture;
select extensions.lives_ok(
  $test$select public.save_sellertray_installer_receipt_settings(
    f.tenant_id,f.appointment_id,f.printer_id,
    '[{"type":"customer","label":"Customer Copy","enabled":true,"sortOrder":1},
      {"type":"store","label":"Store Copy","enabled":true,"sortOrder":2}]'::jsonb,
    'Merchant receipt footer','oa5-installer-receipt-profile-01'
  ) from oa5_installer_fixture f$test$,
  'AAL2 installer edits the shared receipt copy profile under audited appointment command'
);
select extensions.ok(
  exists(select 1 from public.sellertray_installer_printer_commands c
    join oa5_installer_fixture f on f.appointment_id=c.appointment_id
    where c.command_type='receipt_settings' and c.actor_user_id=f.installer_id
      and c.command_key='oa5-installer-receipt-profile-01')
  and exists(select 1 from public.sellertray_installer_printer_events e
    join oa5_installer_fixture f on f.appointment_id=e.appointment_id
    where e.printer_id=f.printer_id and e.actor_user_id=f.installer_id
      and e.assignment_id=f.assignment_id and e.event_type='updated'),
  'Receipt profile change preserves the same appointment/assignment and immutable before/after printer event'
);
select extensions.throws_ok(
  $test$select public.save_sellertray_printer_receipt_settings(
    f.tenant_id,f.printer_id,
    '[{"type":"customer","label":"Unaudited Copy","enabled":true,"sortOrder":1}]'::jsonb,
    'Bypass footer'
  ) from oa5_installer_fixture f$test$,
  '42501',null::text,
  'Direct installer receipt-settings RPC cannot bypass immutable appointment command'
);
select extensions.throws_ok(
  $test$update public.sellertray_installer_printer_events set after_state='{}'::jsonb$test$,
  '55000',null::text,'Installer printer before/after audit evidence cannot be rewritten'
);
-- A caller cannot set custom transaction GUCs to reuse an already recorded
-- authorized installer command for a different receipt profile mutation.
select set_config('sellertray.installer_printer_command_key',
  'oa5-installer-receipt-profile-01',true);
select set_config('sellertray.installer_printer_appointment_id',
  appointment_id::text,true) from oa5_installer_fixture;
select set_config('sellertray.installer_printer_assignment_id',
  assignment_id::text,true) from oa5_installer_fixture;
select extensions.throws_ok(
  $test$select public.save_sellertray_printer_receipt_settings(
    f.tenant_id,f.printer_id,
    '[{"type":"customer","label":"Forged Audit Copy","enabled":true,"sortOrder":1}]'::jsonb,
    'Forged printer footer'
  ) from oa5_installer_fixture f$test$,
  '23505',null::text,
  'A forged reuse of an earlier installer command cannot disguise a receipt-profile change'
);
select set_config('sellertray.installer_printer_command_key','',true);
select set_config('sellertray.installer_printer_appointment_id','',true);
select set_config('sellertray.installer_printer_assignment_id','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);


-- Creating a new default printer must audit the displaced default, too:
-- changing a printer indirectly cannot lose the authorizing appointment.
select extensions.lives_ok(
  $test$select public.save_sellertray_installer_printer(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,
    null,
    (select r.id from public.sellertray_registers r
      where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id
        and r.code='OAI-SETUP-01'),
    'Second Default Setup Printer','OA5-INSTALLER-HW-002',
    58,true,true,'oa5-installer-printer-default-02'
  ) from oa5_installer_fixture f$test$,
  'Installer can configure a second same-register default under a distinct command'
);
select extensions.ok(
  (select count(*) from public.sellertray_installer_printer_events e
    join oa5_installer_fixture f on f.appointment_id=e.appointment_id
    where e.command_key='oa5-installer-printer-default-02'
      and e.actor_user_id=f.installer_id
      and e.assignment_id=f.assignment_id
      and e.event_type in ('registered','default_removed'))>=2,
  'Both new printer registration and displaced-default side effect are appointment-audited'
);

update oa5_installer_fixture f set test_job_id=(
  public.request_sellertray_installer_test_print_job(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,f.printer_id,
    'oa5-installer-physical-test-01'
  )->>'jobId')::uuid;

select extensions.ok(
  (public.request_sellertray_installer_test_print_job(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,f.printer_id,
    'oa5-installer-physical-test-01'
  )->>'idempotentReplay')::boolean,
  'Installer test print request cannot duplicate job on retry'
) from oa5_installer_fixture f;
select extensions.ok(
  exists(select 1 from public.sellertray_installer_test_print_bindings b
    join oa5_installer_fixture f on f.test_job_id=b.job_id
    where b.appointment_id=f.appointment_id and b.actor_user_id=f.installer_id
      and b.printer_id=f.printer_id and b.branch_id=f.branch_id),
  'Print job records immutable authorization provenance for the exact appointment'
);
select extensions.throws_ok(
  $test$select public.request_sellertray_installer_test_print_job(
    f.installer_id,f.tenant_id,f.branch_id,gen_random_uuid(),f.printer_id,
    'oa5-installer-physical-test-01'
  ) from oa5_installer_fixture f$test$,
  '42501',null::text,
  'Another appointment cannot reuse the same installer print request identity'
);
select extensions.ok(
  not has_function_privilege('authenticated',
    'public.request_sellertray_installer_test_print_job(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE')
  and not has_table_privilege('authenticated',
    'public.sellertray_installer_test_print_bindings','SELECT'),
  'Installer print provenance cannot be forged by a merchant or Mobile client'
);


select extensions.throws_ok(
  $test$select public.request_sellertray_print_job(
    f.tenant_id,f.printer_id,'receipt',gen_random_uuid(),
    'oa5-installer-forbidden-receipt-01',f.installer_id
  ) from oa5_installer_fixture f$test$,
  '42501',null::text,
  'Assigned installer cannot request any order receipt or merchant financial print'
);

select public.transition_sellertray_print_job(
  f.tenant_id,f.test_job_id,'printing',null,null,f.installer_id
) from oa5_installer_fixture f;
select public.transition_sellertray_print_job(
  f.tenant_id,f.test_job_id,'printed',null,null,f.installer_id
) from oa5_installer_fixture f;

select extensions.ok(
  exists(select 1 from public.sellertray_print_jobs j
    join oa5_installer_fixture f on f.test_job_id=j.id
    where j.status='printed' and j.job_type='test'
      and j.order_id is null and j.financial_document_id is null
      and j.requested_by_user_id=f.installer_id),
  'Installer native test uses the canonical printed-job evidence state machine'
);
select extensions.lives_ok(
  $test$select public.assert_sellertray_setup_printer_proof(
    f.tenant_id,f.branch_id,
    jsonb_build_object('equipment',jsonb_build_array(
      jsonb_build_object('kind','bluetooth_printer','identifier','OA5-INSTALLER-HW-001'))),
    now()
  ) from oa5_installer_fixture f$test$,
  'OA4 readiness hardware proof recognises a real printed installer test job'
);

-- Installer handover is immutable reported evidence, not activation.
-- The canonical same-Branch printer and test job must already exist.
select extensions.lives_ok(
  $test$select public.platform_installer_submit_handover(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,
    f.printer_id,f.test_job_id,'New and functional','Receiving Manager',
    'SIGNED-HANDOVER-REF-001','Merchant walkthrough and hardware handover',
    'oa5-installer-handover-setup-01'
  ) from oa5_installer_fixture f$test$,
  'Assigned installer can record verified printer/test and merchant handover evidence'
);
select extensions.ok(
  (public.platform_installer_submit_handover(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,
    f.printer_id,f.test_job_id,'New and functional','Receiving Manager',
    'SIGNED-HANDOVER-REF-001','Merchant walkthrough and hardware handover',
    'oa5-installer-handover-setup-01'
  )->>'idempotentReplay')::boolean,
  'Replaying an identical handover command does not duplicate evidence'
) from oa5_installer_fixture f;
select extensions.ok(
  (select count(*)=1 from public.sellertray_installer_handover_submissions h
    join oa5_installer_fixture f
      on f.tenant_id=h.tenant_id and f.appointment_id=h.appointment_id
    where h.actor_user_id=f.installer_id
      and h.test_job_id=f.test_job_id
      and h.evidence->'equipment'->0->>'identifier'='OA5-INSTALLER-HW-001'
      and h.evidence#>>'{checklist,branchConfigured}'='false'
      and h.evidence#>>'{checklist,merchantWalkthrough}'='false')
  and not exists(select 1 from public.sellertray_commercial_branch_setup_readiness r
    join oa5_installer_fixture f on r.tenant_id=f.tenant_id
    where r.branch_id=f.branch_id),
  'Handover evidence is retained but cannot independently create readiness'
);
select extensions.throws_ok(
  $test$select public.platform_installer_submit_handover(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,
    f.printer_id,f.test_job_id,'Damaged','Different recipient',
    'SIGNED-HANDOVER-REF-001','Merchant walkthrough and hardware handover',
    'oa5-installer-handover-setup-01'
  ) from oa5_installer_fixture f$test$,
  '23505',null::text,'Handover idempotency rejects different evidence for one command'
);
select extensions.throws_ok(
  $test$select public.platform_installer_submit_handover(
    f.installer_id,f.tenant_id,gen_random_uuid(),f.appointment_id,
    f.printer_id,f.test_job_id,'New and functional','Receiving Manager',
    'SIGNED-HANDOVER-REF-001','Merchant walkthrough and hardware handover',
    'oa5-installer-handover-wrong-branch'
  ) from oa5_installer_fixture f$test$,
  '42501',null::text,'Installer handover cannot cross Branch boundaries'
);
select extensions.throws_ok(
  $test$update public.sellertray_installer_handover_submissions
    set reason='Overwritten' where command_key='oa5-installer-handover-setup-01'$test$,
  '55000',null::text,'Installer handover evidence cannot be rewritten'
);
-- Regression: one worker has two legitimate purchased setup appointments in
-- the *same* Branch. A print from appointment A cannot serve appointment B.
create temp table oa5_second_installer_appointment(
  commercial_order_id uuid, appointment_id uuid, assignment_id uuid
) on commit drop;
with next_order as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,
    ordered_at,created_by_user_id
  )
  select tenant_id,'OAI-SECOND-'||upper(left(tenant_id::text,8)),
    'NGN',200,now(),admin_id
  from oa5_installer_fixture returning id
)
insert into oa5_second_installer_appointment(commercial_order_id)
select id from next_order;

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,
  source_price_version_id,branch_id,description_snapshot
)
select f.tenant_id,a.commercial_order_id,1,'branch_setup',
  f.price_id,f.branch_id,'Second purchased setup of same Branch'
from oa5_installer_fixture f cross join oa5_second_installer_appointment a;

with second_appointment as (
  insert into public.sellertray_commercial_setup_appointments(
    tenant_id,commercial_order_id,branch_id,worker_id,service_area_id,
    scheduled_start_at,scheduled_end_at,travel_buffer_minutes_snapshot,
    status,created_by_user_id
  )
  select f.tenant_id,a.commercial_order_id,f.branch_id,f.worker_id,f.area_id,
    now()+interval '12 hours',now()+interval '14 hours',0,'scheduled',f.admin_id
  from oa5_installer_fixture f cross join oa5_second_installer_appointment a
  returning id
)
update oa5_second_installer_appointment
set appointment_id=(select id from second_appointment);

update oa5_second_installer_appointment a set assignment_id=(
  select public.platform_admin_assign_setup_installer(
    f.admin_id,f.installer_id,f.tenant_id,a.appointment_id,
    now()+interval '2 days',gen_random_uuid(),
    'Second active appointment to test same-Branch print provenance'
  )
  from oa5_installer_fixture f
);

select extensions.ok(
  public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,a.appointment_id,now()),
  'Installer legitimately holds another appointment for the exact same Branch'
) from oa5_installer_fixture f cross join oa5_second_installer_appointment a;

select extensions.throws_ok(
  $test$select public.platform_installer_submit_handover(
    f.installer_id,f.tenant_id,f.branch_id,a.appointment_id,
    f.printer_id,f.test_job_id,'New and functional','Receiving Manager',
    'SIGNED-HANDOVER-REF-002','Attempt cross-appointment test reuse',
    'oa5-installer-second-appointment-reuse'
  ) from oa5_installer_fixture f cross join oa5_second_installer_appointment a$test$,
  '23514',null::text,
  'Another active same-Branch appointment cannot reuse the first appointment test'
);
select extensions.ok(
  public.platform_admin_revoke_setup_installer_assignment(
    f.admin_id,a.assignment_id,gen_random_uuid(),
    'Close same-Branch test fixture second appointment assignment'
  ),
  'Second assignment is revoked so original expiry/revocation tests remain isolated'
) from oa5_installer_fixture f cross join oa5_second_installer_appointment a;

select extensions.ok(
  not has_table_privilege('authenticated',
    'public.sellertray_installer_handover_submissions','SELECT')
  and not has_function_privilege('authenticated',
    'public.platform_installer_submit_handover(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)','EXECUTE'),
  'Handover evidence remains server-only until verified installer transport is wired'
);

select extensions.ok(
  jsonb_array_length(public.platform_admin_list_installer_handovers(
    f.admin_id,f.tenant_id))=1,
  'Admin handover review returns bounded real evidence for the selected Business'
) from oa5_installer_fixture f;
select extensions.throws_ok(
  $test$select public.platform_admin_list_installer_handovers(
    f.support_id,f.tenant_id) from oa5_installer_fixture f$test$,
  '42501',null::text,'ProcessEdge Support cannot bypass Admin installer evidence review'
);

-- The final completion event must not be allowed to attach a different
-- installer submission, or silently rewrite merchant receipt of equipment.
select extensions.throws_ok(
  $test$insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,
    event_type,actor_user_id,actor_kind,reason,details
  )
  select f.appointment_id,f.tenant_id,f.commercial_order_id,f.branch_id,
    gen_random_uuid(),'completed',f.admin_id,'platform',
    'Confirm hardware handover from ProcessEdge staff',
    jsonb_build_object('evidence',jsonb_build_object(
      'installerHandoverSubmissionId',gen_random_uuid()))
  from oa5_installer_fixture f$test$,
  '23514',null::text,
  'Admin cannot attach a handover from a different Branch or appointment'
);
select extensions.throws_ok(
  $test$insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,
    event_type,actor_user_id,actor_kind,reason,details
  )
  select f.appointment_id,f.tenant_id,f.commercial_order_id,f.branch_id,
    gen_random_uuid(),'completed',f.admin_id,'platform',
    'Confirm hardware handover from ProcessEdge staff',
    jsonb_build_object('evidence',jsonb_build_object(
      'installerHandoverSubmissionId',h.id,
      'receivedBy','Different Representative',
      'acknowledgement',h.evidence->>'acknowledgement',
      'equipment',h.evidence->'equipment'))
  from oa5_installer_fixture f
  join public.sellertray_installer_handover_submissions h
    on h.tenant_id=f.tenant_id and h.appointment_id=f.appointment_id$test$,
  '23514',null::text,
  'Admin cannot change merchant recipient while claiming a signed installer handover'
);

select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','',true);

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
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select extensions.ok(
  not public.sellertray_setup_installer_device_allowed(
    f.tenant_id,f.branch_id,f.installer_id,true),
  'Revocation also blocks device/printer commands immediately'
) from oa5_installer_fixture f;
select set_config('request.jwt.claims','',true);

select extensions.ok(
  public.platform_admin_revoke_setup_installer_assignment(
    f.admin_id,f.assignment_id,f.command_revoke,'Setup staff assignment cancelled'
  ),'Exact assignment revocation replay is safe'
) from oa5_installer_fixture f;

-- A suspended account must revoke its current appointment permissions and
-- reactivation must not resurrect a previously approved assignment.
update oa5_installer_fixture f set assignment_id=public.platform_admin_assign_setup_installer(
  f.admin_id,f.installer_id,f.tenant_id,f.appointment_id,now()+interval '2 days',
  gen_random_uuid(),'New ProcessEdge appointment access after previous revocation'
);
select extensions.ok(
  public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,now()
  ),'New explicit assignment can restore access to an active installer'
) from oa5_installer_fixture f;

select extensions.is(
  public.platform_admin_set_setup_installer_status(
    f.admin_id,f.installer_id,'suspended',gen_random_uuid(),
    'Security review temporarily suspended staff account'
  ),'suspended','Suspending staff also retires active appointment permissions'
) from oa5_installer_fixture f;

select extensions.ok(
  not public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,now()
  ) and exists (
    select 1 from public.sellertray_internal_setup_staff_assignments a
    where a.id=f.assignment_id and a.revoked_at is not null
  ),'A suspended installer loses all active assignments immediately'
) from oa5_installer_fixture f;

select extensions.is(
  public.platform_admin_set_setup_installer_status(
    f.admin_id,f.installer_id,'active',gen_random_uuid(),
    'Security review complete; restore staff identity only'
  ),'active','Reactivation may restore account but not appointment permissions'
) from oa5_installer_fixture f;

select extensions.ok(
  not public.sellertray_setup_installer_has_assignment(
    f.installer_id,f.tenant_id,f.branch_id,f.appointment_id,now()
  ),'Old appointment authority does not silently revive after staff reactivation'
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
