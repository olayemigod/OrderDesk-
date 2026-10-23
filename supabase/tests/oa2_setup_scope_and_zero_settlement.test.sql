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
  template_id uuid,
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
  select tenant_id,'C1B-'||upper(substr(tenant_id::text,1,8)),'NGN',800,now(),admin_user_id
  from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set commercial_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot
)
select tenant_id,commercial_order_id,1,'subscription',subscription_price_id,null,'Annual SellerTray subscription'
from sellertray_c1b_fixture;
set constraints all immediate;

-- SET CONSTRAINTS ALL IMMEDIATE persists for the transaction. Re-defer both
-- installment validators before creating the obligation so validation sees the
-- complete governed 70:30 schedule rather than the empty/partial fixture state.
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
  select tenant_id,installment_obligation_id,1,70,560 from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set schedule_1_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,installment_obligation_id,2,30,240 from sellertray_c1b_fixture returning id
)
update sellertray_c1b_fixture set schedule_2_id=(select id from inserted);
set constraints all immediate;

update sellertray_c1b_fixture f
set template_id=public.publish_sellertray_commercial_agreement_template_version(
  'installment_agreement','c1b-2026.1','SellerTray Installment Agreement',
  'C1B test agreement content',now()-interval '1 minute',f.admin_user_id
);

update sellertray_c1b_fixture f
set agreement_id=public.issue_sellertray_commercial_agreement(
  f.tenant_id,f.commercial_order_id,f.installment_obligation_id,f.template_id,
  'AGR-C1B-'||upper(substr(f.tenant_id::text,1,8)),
  'Merchant-specific C1B installment agreement',null,f.admin_user_id
);



select set_config('request.jwt.claim.role','service_role',true);
select public.accept_sellertray_commercial_agreement(f.tenant_id,f.agreement_id,'Zero Setup Owner','{}',gen_random_uuid(),f.owner_user_id) from sellertray_c1b_fixture f;
select public.platform_admin_record_commercial_direct_payment(f.admin_user_id,f.tenant_id,f.commercial_order_id,gen_random_uuid(),'ZERO-SETUP-DIRECT','bank_transfer',560,now(),'Qualifying real transfer','{}') from sellertray_c1b_fixture f;
select extensions.is(public.get_sellertray_installment_billing_state(tenant_id,installment_obligation_id)->>'entitlementState','pending_setup','zero setup lines remain blocked despite accepted agreement and qualifying settlement') from sellertray_c1b_fixture;
select extensions.is(public.get_sellertray_installment_billing_state(tenant_id,installment_obligation_id)->>'setupReady','false','zero of zero setup lines is not readiness') from sellertray_c1b_fixture;
select extensions.is((select count(*)::integer from public.sellertray_commercial_entitlement_events e join sellertray_c1b_fixture f on e.commercial_order_id=f.commercial_order_id),0,'missing setup scope creates no entitlement events');
select * from extensions.finish(); rollback;
