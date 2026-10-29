begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create temp table sellertray_c1b_fixture (
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  tenant_id uuid not null,
  branch_id uuid not null,
  branch_2_id uuid,
  area_id uuid,
  worker_id uuid,
  appointment_1_id uuid,
  appointment_2_id uuid,
  completion_command uuid default gen_random_uuid(),
  monthly_price_id uuid,
  subscription_price_id uuid,
  setup_price_id uuid,
  commercial_order_id uuid,
  installment_obligation_id uuid,
  schedule_1_id uuid,
  schedule_2_id uuid,
  agreement_id uuid,
  checkout_1_command uuid not null,
  checkout_2_command uuid not null,
  checkout_1_id uuid,
  checkout_2_id uuid,
  payment_1_id uuid,
  payment_2_id uuid,
  first_paid_at timestamptz,
  second_paid_at timestamptz,
  second_before_first_rejected boolean not null default false
) on commit drop;

insert into sellertray_c1b_fixture(
  admin_user_id,owner_user_id,tenant_id,branch_id,checkout_1_command,checkout_2_command
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'c1b-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_c1b_fixture
union all
select owner_user_id,'c1b-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_c1b_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from sellertray_c1b_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C1B Installment Tenant','c1b-'||substr(tenant_id::text,1,8),'C1B','trial'
from sellertray_c1b_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_c1b_fixture;

update sellertray_c1b_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

with branch as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'LEKKI','Lekki',false,false from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set branch_2_id=(select id from branch);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',80,now()-interval '1 day',
         'C1B governed monthly anchor',admin_user_id,admin_user_id,now()
  from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',800,now()-interval '1 day',
         'C1B annual subscription',admin_user_id,admin_user_id,now()
  from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set subscription_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,currency,gross_amount,effective_from,change_reason,
    created_by_user_id,approved_by_user_id,approved_at
  )
  select 'branch_setup','NGN',200,now()-interval '1 day','C1B Branch setup',
         admin_user_id,admin_user_id,now()
  from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set setup_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,'C1B-'||upper(substr(tenant_id::text,1,8)),'NGN',1200,now(),admin_user_id
  from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set commercial_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot
)
select tenant_id,commercial_order_id,1,'subscription',subscription_price_id,null,'Annual SellerTray subscription'
from sellertray_c1b_fixture
union all
select tenant_id,commercial_order_id,2,'branch_setup',setup_price_id,branch_id,'SellerTray Branch setup'
from sellertray_c1b_fixture
union all
select tenant_id,commercial_order_id,3,'branch_setup',setup_price_id,branch_2_id,'Second Branch setup'
from sellertray_c1b_fixture;
set constraints all immediate;

set constraints validate_sellertray_commercial_installment_obligation deferred;
set constraints validate_sellertray_commercial_installment_schedule_line deferred;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,commercial_order_id,'two_installment_70_30','NGN',1200,admin_user_id
  from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set installment_obligation_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,installment_obligation_id,1,70,840 from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set schedule_1_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,installment_obligation_id,2,30,360 from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set schedule_2_id=(select id from inserted);
set constraints all immediate;

update sellertray_c1b_fixture f
set agreement_id=public.publish_sellertray_master_agreement_admin(
  'test-'||substr(f.tenant_id::text,1,8),
  'SellerTray Master Agreement',
  'Universal OA4 setup and activation agreement content',
  now()-interval '1 minute',
  'OA4 universal agreement publication',
  f.admin_user_id
);

create temp table oa4_evidence(e jsonb);
insert into oa4_evidence values ('{"schemaVersion":1,"checklist":{"branchConfigured":true,"merchantWalkthrough":true},"equipment":[{"kind":"bluetooth_printer","provisioning":"supplied","identifier":"BT-123456","pairingTestResult":"passed","testReceiptPrinted":true,"handoverCondition":"New and undamaged"}],"receivedBy":"Merchant Owner","acknowledgement":"Signed handover receipt H123"}');
select extensions.lives_ok('select public.assert_sellertray_setup_completion_evidence(e) from oa4_evidence','complete structured evidence is accepted');
select extensions.throws_ok($test$select public.assert_sellertray_setup_completion_evidence('{}')$test$,'22023',null,'generic evidence fails closed');
select extensions.throws_ok($test$select public.assert_sellertray_setup_completion_evidence(jsonb_set(e,'{checklist,branchConfigured}','false')) from oa4_evidence$test$,'22023',null,'incomplete checklist fails closed');
select extensions.throws_ok($test$select public.assert_sellertray_setup_completion_evidence(jsonb_set(e,'{equipment,0,pairingTestResult}','"failed"')) from oa4_evidence$test$,'22023',null,'failed pairing fails closed');
select extensions.throws_ok($test$select public.assert_sellertray_setup_completion_evidence(jsonb_set(e,'{equipment,0,identifier}','null')) from oa4_evidence$test$,'22023',null,'missing device identity fails closed');
select extensions.throws_ok($test$select public.assert_sellertray_setup_completion_evidence(e-'receivedBy') from oa4_evidence$test$,'22023',null,'missing receiving representative fails closed');
select extensions.throws_ok($test$select public.assert_sellertray_setup_completion_evidence(e-'acknowledgement') from oa4_evidence$test$,'22023',null,'missing acknowledgement fails closed');

select extensions.is(public.get_orderdesk_subscription_access(tenant_id)->>'effectiveStatus','pending_setup','new Business receives preparation access') from sellertray_c1b_fixture;
select extensions.ok(not public.orderdesk_subscription_can_write(tenant_id),'new Business cannot sell before activation') from sellertray_c1b_fixture;
select set_config('request.jwt.claim.sub',owner_user_id::text,true) from sellertray_c1b_fixture;
select extensions.lives_ok($test$select public.save_sellertray_branch(tenant_id,null,'PREP','Prepared Branch',false,true) from sellertray_c1b_fixture$test$,'Owner can prepare an additional Branch without selling entitlement');
select extensions.lives_ok($test$select public.save_sellertray_business_profile(tenant_id,'Prepared Business',null,null,null,null,'NGN','Africa/Lagos') from sellertray_c1b_fixture$test$,'Owner can finish Business profile in preparation mode');
select set_config('request.jwt.claim.role','service_role',true);
select public.platform_admin_record_commercial_adjustment(f.admin_user_id,f.tenant_id,f.commercial_order_id,gen_random_uuid(),1200,'Approved full discount','{}') from sellertray_c1b_fixture f;
select public.accept_sellertray_master_agreement(f.tenant_id,f.agreement_id,'OA4 Owner','{}',f.checkout_1_command,f.owner_user_id) from sellertray_c1b_fixture f;

update sellertray_c1b_fixture set area_id=public.platform_admin_upsert_setup_service_area(admin_user_id,tenant_id,null,'OA4','Lagos',true,'Test coverage');
update sellertray_c1b_fixture set worker_id=public.platform_admin_upsert_setup_worker(admin_user_id,tenant_id,null,'OA4-W','Installer One',true,1,0,array[area_id],'Test installer');
select public.platform_admin_assign_branch_setup_service_area(admin_user_id,tenant_id,branch_id,area_id,'Assign coverage') from sellertray_c1b_fixture;
select public.platform_admin_assign_branch_setup_service_area(admin_user_id,tenant_id,branch_2_id,area_id,'Assign coverage') from sellertray_c1b_fixture;
update sellertray_c1b_fixture set appointment_1_id=public.platform_admin_schedule_branch_setup(admin_user_id,tenant_id,commercial_order_id,branch_id,worker_id,area_id,now()+interval '1 day',now()+interval '1 day 1 hour',null,null,gen_random_uuid(),'Schedule first Branch');
update sellertray_c1b_fixture set appointment_2_id=public.platform_admin_schedule_branch_setup(admin_user_id,tenant_id,commercial_order_id,branch_2_id,worker_id,area_id,now()+interval '2 days',now()+interval '2 days 1 hour',null,null,gen_random_uuid(),'Schedule Lekki Branch');

select extensions.throws_ok($test$select public.platform_admin_transition_branch_setup(owner_user_id,tenant_id,appointment_1_id,'completed',completion_command,'Setup complete',e) from sellertray_c1b_fixture,oa4_evidence$test$,'42501',null,'merchant cannot complete setup');
select extensions.throws_ok($test$select public.platform_admin_transition_branch_setup(admin_user_id,tenant_id,appointment_1_id,'completed',completion_command,'Setup complete','{}') from sellertray_c1b_fixture$test$,'22023',null,'generic completion cannot change state');
select extensions.is((select a.status from public.sellertray_commercial_setup_appointments a join sellertray_c1b_fixture f on f.appointment_1_id=a.id),'scheduled','invalid evidence leaves appointment scheduled');
select extensions.is((select count(*)::integer from public.sellertray_commercial_branch_setup_readiness r join sellertray_c1b_fixture f on f.tenant_id=r.tenant_id),0,'invalid evidence writes no readiness');
select public.platform_admin_transition_branch_setup(admin_user_id,tenant_id,appointment_1_id,'completed',completion_command,'Setup complete',e) from sellertray_c1b_fixture,oa4_evidence;
select extensions.throws_ok($test$update public.sellertray_commercial_setup_appointment_events set reason='Rewrite evidence' where command_id=(select completion_command from sellertray_c1b_fixture)$test$,'55000',null,'completion history cannot be edited');
select extensions.throws_ok($test$delete from public.sellertray_commercial_branch_setup_readiness where tenant_id=(select tenant_id from sellertray_c1b_fixture)$test$,'55000',null,'readiness history cannot be deleted');
select extensions.throws_ok($test$select public.platform_admin_transition_branch_setup(admin_user_id,gen_random_uuid(),appointment_1_id,'completed',completion_command,'Setup complete',e) from sellertray_c1b_fixture,oa4_evidence$test$,'23505',null,'completion retry cannot cross Business scope');
select extensions.lives_ok($test$select public.platform_admin_transition_branch_setup(admin_user_id,tenant_id,appointment_1_id,'completed',completion_command,'Setup complete',e) from sellertray_c1b_fixture,oa4_evidence$test$,'exact completion replay succeeds');
select extensions.throws_ok($test$select public.platform_admin_transition_branch_setup(admin_user_id,tenant_id,appointment_1_id,'completed',completion_command,'Changed reason',e) from sellertray_c1b_fixture,oa4_evidence$test$,'23505',null,'changed replay facts are rejected');
select extensions.is(public.get_sellertray_onboarding_state_core(tenant_id)#>>'{branchSetup,readyCount}','1','only exact completed Branch becomes ready') from sellertray_c1b_fixture;
select extensions.ok(exists(select 1 from jsonb_array_elements(public.get_sellertray_onboarding_state_core(tenant_id)->'blockers') b where b->>'branchId'=branch_2_id::text and b->>'message' like 'Lekki%Setup scheduled%'),'blocking Branch is named with appointment status') from sellertray_c1b_fixture;
select extensions.is(public.get_sellertray_onboarding_state_core(tenant_id)#>>'{activation,entitlementState}','not_active','one ready Branch cannot activate a multi-Branch purchase') from sellertray_c1b_fixture;
select extensions.ok(exists(select 1 from public.sellertray_commercial_setup_appointment_events a where a.command_id=completion_command and a.details->>'workerId'=worker_id::text and a.details->>'actorUserId'=admin_user_id::text and a.details->>'completedAt' is not null),'installer actor and server completion time are immutable evidence') from sellertray_c1b_fixture;

update public.tenant_subscriptions s set status='active',current_period_start=now()-interval '1 month',current_period_end=now()+interval '1 month' from sellertray_c1b_fixture f where f.tenant_id=s.tenant_id;
select public.platform_admin_transition_branch_setup(admin_user_id,tenant_id,appointment_2_id,'completed',gen_random_uuid(),'Lekki setup complete',e) from sellertray_c1b_fixture,oa4_evidence;
select extensions.is(public.get_sellertray_onboarding_state_core(tenant_id)#>>'{branchSetup,readyCount}','2','readiness persists even when entitlement reconciliation fails') from sellertray_c1b_fixture;
select extensions.is((select count(*)::integer from public.sellertray_commercial_entitlement_events e join sellertray_c1b_fixture f on f.commercial_order_id=e.commercial_order_id),0,'runtime conflict cannot create entitlement');
select extensions.ok(exists(select 1 from public.platform_admin_audit a where a.tenant_id=tenant_id and a.action='setup_activation_reconciliation_failed'),'reconciliation failure is audited') from sellertray_c1b_fixture;
select extensions.is(public.platform_admin_retry_setup_activation(admin_user_id,tenant_id,installment_obligation_id,'Retry conflicting runtime')->>'retryRequired','true','unresolved recovery reports failure') from sellertray_c1b_fixture;
update public.tenant_subscriptions s set status='trial',current_period_start=null,current_period_end=null from sellertray_c1b_fixture f where f.tenant_id=s.tenant_id;
select extensions.throws_ok($test$select public.platform_admin_retry_setup_activation(owner_user_id,tenant_id,installment_obligation_id,'Unauthorized recovery') from sellertray_c1b_fixture$test$,'42501',null,'merchant cannot invoke Admin recovery');
select public.platform_admin_retry_setup_activation(admin_user_id,tenant_id,installment_obligation_id,'Retry after prerequisite repair') from sellertray_c1b_fixture;
select extensions.is(public.get_sellertray_onboarding_state_core(tenant_id)#>>'{activation,entitlementState}','full','recovery invokes existing full entitlement authority') from sellertray_c1b_fixture;
select extensions.ok(public.orderdesk_subscription_can_write(tenant_id),'authoritative activation enables operational writes') from sellertray_c1b_fixture;
create temp table oa4_activation as select public.get_sellertray_onboarding_state_core(tenant_id)->'activation' a from sellertray_c1b_fixture;
select public.platform_admin_retry_setup_activation(admin_user_id,tenant_id,installment_obligation_id,'Repeat recovery check') from sellertray_c1b_fixture;
select extensions.is(public.get_sellertray_onboarding_state_core(tenant_id)->'activation',(select a from oa4_activation),'recovery replay preserves activation entitlement and guarantee boundaries') from sellertray_c1b_fixture;
select extensions.is((public.get_sellertray_onboarding_state_core(tenant_id)#>>'{activation,guaranteeEnd}')::timestamptz,(public.get_sellertray_onboarding_state_core(tenant_id)#>>'{activation,effectiveFrom}')::timestamptz+interval '1 month','guarantee begins at original activation and lasts one month') from sellertray_c1b_fixture;
select extensions.ok(not has_function_privilege('authenticated','public.platform_admin_retry_setup_activation(uuid,uuid,uuid,text)','execute'),'recovery has no direct client grant');
select extensions.is((select count(*)::integer from public.sellertray_commercial_branch_setup_readiness r join sellertray_c1b_fixture f on f.tenant_id=r.tenant_id),2,'replay never duplicates Branch readiness');

create temp table oa4_support(id uuid default gen_random_uuid()); insert into oa4_support default values;
insert into auth.users(id,email) select id,'oa4-support@example.com' from oa4_support;
insert into public.platform_admins(user_id,role) select id,'support' from oa4_support;
select extensions.throws_ok($test$select public.platform_admin_retry_setup_activation(s.id,f.tenant_id,f.installment_obligation_id,'Support without capability') from sellertray_c1b_fixture f,oa4_support s$test$,'42501',null,'read-only Support cannot recover activation');
insert into public.platform_admin_capability_grant_versions(grantee_user_id,capability_code,scope_kind,tenant_id,enabled,created_by_user_id,reason)
select s.id,'admin.branch_setup.manage','tenant',f.tenant_id,true,f.admin_user_id,'Scoped setup recovery delegation' from sellertray_c1b_fixture f,oa4_support s;
select extensions.lives_ok($test$select public.platform_admin_retry_setup_activation(s.id,f.tenant_id,f.installment_obligation_id,'Scoped support recovery') from sellertray_c1b_fixture f,oa4_support s$test$,'Support with explicit scoped setup capability can recover');
select extensions.throws_ok($test$select public.platform_admin_retry_setup_activation(s.id,gen_random_uuid(),f.installment_obligation_id,'Wrong Business recovery') from sellertray_c1b_fixture f,oa4_support s$test$,'42501',null,'scoped setup capability cannot recover a different Business');
select * from extensions.finish(); rollback;
