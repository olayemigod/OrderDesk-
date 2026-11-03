begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create temp table sellertray_c1b_fixture (
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  tenant_id uuid not null,
  branch_id uuid not null,
  monthly_price_id uuid,
  subscription_price_id uuid,
  setup_price_id uuid,
  commercial_order_id uuid,
  installment_obligation_id uuid,
  schedule_1_id uuid,
  schedule_2_id uuid,
  agreement_id uuid,
  checkout_1_command uuid not null
) on commit drop;

insert into sellertray_c1b_fixture(
  admin_user_id,owner_user_id,tenant_id,branch_id,checkout_1_command
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
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
  select tenant_id,'C1B-'||upper(substr(tenant_id::text,1,8)),'NGN',1000,now(),admin_user_id
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
from sellertray_c1b_fixture;
set constraints all immediate;

set constraints validate_sellertray_commercial_installment_obligation deferred;
set constraints validate_sellertray_commercial_installment_schedule_line deferred;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,commercial_order_id,'two_installment_70_30','NGN',1000,admin_user_id
  from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set installment_obligation_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,installment_obligation_id,1,70,700 from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set schedule_1_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,installment_obligation_id,2,30,300 from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set schedule_2_id=(select id from inserted);
set constraints all immediate;

update sellertray_c1b_fixture f
set agreement_id=public.publish_sellertray_master_agreement_admin(
  'test-'||substr(f.tenant_id::text,1,8),
  'SellerTray Master Agreement',
  'Universal zero-payable test agreement content',
  now()-interval '1 minute',
  'Test universal agreement publication',
  f.admin_user_id
);

select set_config('request.jwt.claim.role','service_role',true);
select public.platform_admin_record_commercial_adjustment(
  f.admin_user_id,f.tenant_id,f.commercial_order_id,gen_random_uuid(),1000,
  'Approved full discount','{}'
) from sellertray_c1b_fixture f;

select extensions.is(
  public.get_sellertray_onboarding_state_core(tenant_id)->>'currentStage',
  'agreement',
  'zero payable still waits for the current Master Agreement before service delivery'
) from sellertray_c1b_fixture;

select public.accept_sellertray_master_agreement(
  f.tenant_id,f.agreement_id,'Full Discount Owner','{}',f.checkout_1_command,f.owner_user_id
) from sellertray_c1b_fixture f;

-- OA5: preceding setup proof is a real canonical native test-job fixture,
-- not a claim in the old C1/OA2 readiness JSON. Historical authority is unchanged.
insert into public.sellertray_registers(
  tenant_id,branch_id,code,name,is_default,is_active)
select f.tenant_id,f.branch_id,'OA5NATIVE','OA5 proof register',false,true
from sellertray_c1b_fixture f;
insert into public.sellertray_printers(
  tenant_id,branch_id,register_id,display_name,transport,hardware_identifier,
  paper_width_mm,is_default,is_active,created_by_user_id)
select f.tenant_id,f.branch_id,r.id,'OA5 proof printer','bluetooth',
  'OA5-NATIVE-PROOF',58,false,true,f.admin_user_id
from sellertray_c1b_fixture f join public.sellertray_registers r
  on r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.code='OA5NATIVE';
insert into public.sellertray_print_jobs(
  tenant_id,branch_id,register_id,printer_id,job_type,request_key,status,
  transport,printer_name,hardware_identifier,paper_width_mm,content_snapshot,
  requested_by_user_id,requested_at,started_at,completed_at)
select p.tenant_id,p.branch_id,p.register_id,p.id,'test',
  'oa5-c1b-proof-'||p.id::text,'printed','bluetooth',p.display_name,
  p.hardware_identifier,p.paper_width_mm,
  jsonb_build_object('formatVersion',1,'documentType','test'),
  f.admin_user_id,now(),now(),now()
from sellertray_c1b_fixture f join public.sellertray_printers p
  on p.tenant_id=f.tenant_id and p.branch_id=f.branch_id
  and p.hardware_identifier='OA5-NATIVE-PROOF';

select public.mark_sellertray_commercial_branch_setup_ready(
  f.tenant_id,f.commercial_order_id,f.branch_id,gen_random_uuid(),jsonb_build_object('equipment',jsonb_build_array(jsonb_build_object('kind','bluetooth_printer','identifier','OA5-NATIVE-PROOF'))),'Setup verified',now(),f.admin_user_id
) from sellertray_c1b_fixture f;
select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from sellertray_c1b_fixture;

select extensions.is(
  public.get_sellertray_onboarding_state_core(tenant_id)->'settlement'->>'qualifyingSettlementSatisfied',
  'true',
  '100 percent discount satisfies settlement without a payment'
) from sellertray_c1b_fixture;
select extensions.is(
  public.get_sellertray_onboarding_state_core(tenant_id)->'activation'->>'entitlementState',
  'full',
  'zero payable activates only after current Master Agreement acceptance and required setup'
) from sellertray_c1b_fixture;
select extensions.is(
  (select count(*)::integer from public.sellertray_commercial_direct_payment_confirmations p join sellertray_c1b_fixture f on p.commercial_order_id=f.commercial_order_id),
  0,
  'full discount creates no direct payment'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_commercial_installment_payment_confirmations p join sellertray_c1b_fixture f on p.commercial_order_id=f.commercial_order_id),
  0,
  'full discount creates no provider payment'
);
select extensions.is(
  (public.get_sellertray_commercial_settlement_state(tenant_id,commercial_order_id)->>'nextPayableAmount')::numeric,
  0::numeric,
  'zero payable never creates a checkout amount'
) from sellertray_c1b_fixture;
select extensions.is(
  public.accept_sellertray_master_agreement(f.tenant_id,f.agreement_id,'Full Discount Owner','{}',f.checkout_1_command,f.owner_user_id),
  (select ac.id from public.sellertray_master_agreement_acceptances ac where ac.tenant_id=f.tenant_id and ac.agreement_version_id=f.agreement_id),
  'exact committed Master Agreement acceptance replay remains stable'
) from sellertray_c1b_fixture f;
select * from extensions.finish();
rollback;
