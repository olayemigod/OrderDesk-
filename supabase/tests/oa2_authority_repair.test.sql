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
create temp table oa2_actors as select gen_random_uuid() outsider,gen_random_uuid() support,gen_random_uuid() cashier;
insert into auth.users(id,email,aud,role) select outsider,'outsider@example.com','authenticated','authenticated' from oa2_actors
union all select support,'support@example.com','authenticated','authenticated' from oa2_actors
union all select cashier,'cashier@example.com','authenticated','authenticated' from oa2_actors;
insert into public.platform_admins(user_id,role) select support,'support' from oa2_actors;
insert into public.tenant_members(tenant_id,user_id,role) select f.tenant_id,a.cashier,'staff' from sellertray_c1b_fixture f cross join oa2_actors a;

create function pg_temp.settlement() returns jsonb language sql as $$
  select public.get_sellertray_commercial_settlement_state(tenant_id,commercial_order_id) from sellertray_c1b_fixture;
$$;
create function pg_temp.onboarding() returns jsonb language sql as $$
  select public.get_sellertray_onboarding_state_core(tenant_id) from sellertray_c1b_fixture;
$$;
select extensions.ok(exists(select 1 from public.sellertray_installment_contract_snapshots cs join sellertray_c1b_fixture f on cs.installment_obligation_id=f.installment_obligation_id),
  'legacy obligation insertion creates the immutable OA2 contract before any billing read');
select extensions.throws_ok(format('select public.get_sellertray_commercial_billing_center(%L,%L)',f.tenant_id,a.outsider),'42501',null::text,'non-member cannot read another Business billing') from sellertray_c1b_fixture f cross join oa2_actors a;
select extensions.throws_ok(format('select public.get_sellertray_commercial_billing_center(%L,%L)',f.tenant_id,a.cashier),'42501',null::text,'Cashier cannot read commercial billing') from sellertray_c1b_fixture f cross join oa2_actors a;
select extensions.throws_ok(format('select public.platform_admin_commercial_settlement_center(%L,%L)',a.outsider,f.tenant_id),'42501',null::text,'non-platform user cannot read the Admin settlement center') from sellertray_c1b_fixture f cross join oa2_actors a;
select extensions.is(public.get_sellertray_commercial_billing_center(f.tenant_id,f.owner_user_id)->>'canPay','true','Owner can read and start governed payment') from sellertray_c1b_fixture f;
select extensions.is(public.platform_admin_commercial_settlement_center(a.support,f.tenant_id)->'capabilities'->>'canAdjust','false','Support is review-only by default') from sellertray_c1b_fixture f cross join oa2_actors a;
select extensions.throws_ok(format('select public.platform_admin_record_commercial_adjustment(%L,%L,%L,%L,100,%L)',a.support,f.tenant_id,f.commercial_order_id,gen_random_uuid(),'Support denied'),'42501',null::text,'Support cannot mutate commercial prices without capability') from sellertray_c1b_fixture f cross join oa2_actors a;

select public.platform_admin_record_commercial_direct_payment(f.admin_user_id,f.tenant_id,f.commercial_order_id,f.checkout_1_command,'DIRECT-TEST','bank_transfer',100,now(),'Confirmed transfer','{}') from sellertray_c1b_fixture f;
select public.platform_admin_record_commercial_direct_payment(f.admin_user_id,f.tenant_id,f.commercial_order_id,f.checkout_1_command,'DIRECT-TEST','bank_transfer',100,now(),'Confirmed transfer','{}') from sellertray_c1b_fixture f;
select extensions.is((select count(*)::integer from public.sellertray_commercial_direct_payment_confirmations d join sellertray_c1b_fixture f on d.commercial_order_id=f.commercial_order_id),1,'direct payment replay preserves one immutable financial fact');
select extensions.is((pg_temp.onboarding()->'settlement'->>'directPaymentAmount')::numeric,100::numeric,'Mobile onboarding reads confirmed direct payment authority');
select extensions.is((pg_temp.onboarding()->'settlement'->>'outstandingAmount')::numeric,900::numeric,'onboarding and billing show the same remaining balance');
select extensions.is((select count(*)::integer from public.sellertray_commercial_installment_payment_confirmations p join sellertray_c1b_fixture f on p.commercial_order_id=f.commercial_order_id),0,'direct payment does not manufacture a provider confirmation');

select public.platform_admin_record_commercial_adjustment(f.admin_user_id,f.tenant_id,f.commercial_order_id,f.checkout_2_command,200,'Approved discount','{}') from sellertray_c1b_fixture f;
select extensions.is((pg_temp.settlement()->>'grossAmount')::numeric,1000::numeric,'discount preserves immutable gross order');
select extensions.is((pg_temp.settlement()->>'netAmountDue')::numeric,800::numeric,'discount derives the authoritative adjusted amount');
select extensions.is((pg_temp.settlement()->'schedule'->0->>'amountDue')::numeric,560::numeric,'70 percent is derived from adjusted 800 rather than credited against original 700');
select extensions.is((pg_temp.settlement()->'schedule'->1->>'amountDue')::numeric,240::numeric,'remaining 30 percent reconciles exactly to adjusted purchase');
select extensions.is((pg_temp.settlement()->>'nextPayableAmount')::numeric,460::numeric,'confirmed direct payment reduces only the current adjusted installment');
select extensions.is((pg_temp.onboarding()->'settlement'->>'approvedAdjustmentAmount')::numeric,200::numeric,'onboarding exposes authoritative adjustments');
select extensions.throws_ok(format('select public.accept_sellertray_commercial_agreement(%L,%L,%L,%L,%L,%L)',f.tenant_id,f.agreement_id,'Test Owner','{}',gen_random_uuid(),f.owner_user_id),'23514',null::text,'stale unaccepted agreement cannot be accepted after amounts change') from sellertray_c1b_fixture f;
update sellertray_c1b_fixture f set agreement_id=public.issue_sellertray_commercial_agreement(f.tenant_id,f.commercial_order_id,f.installment_obligation_id,f.template_id,'AGR-OA2-REPLACEMENT','Replacement test agreement',f.agreement_id,f.admin_user_id);
select public.accept_sellertray_commercial_agreement(f.tenant_id,f.agreement_id,'Test Owner','{}',gen_random_uuid(),f.owner_user_id) from sellertray_c1b_fixture f;
select extensions.is((select (a.commercial_snapshot->'installment'->'schedule'->0->>'amount_due')::numeric from public.sellertray_commercial_agreements a join sellertray_c1b_fixture f on a.id=f.agreement_id),560::numeric,'replacement agreement snapshots adjusted server schedule');
select extensions.ok((select public.sellertray_installment_agreement_is_accepted(f.tenant_id,f.commercial_order_id,f.installment_obligation_id) from sellertray_c1b_fixture f),'replacement acceptance satisfies current contractual authority');

grant select,update on sellertray_c1b_fixture to service_role;
revoke update on public.sellertray_commercial_orders from service_role;
set local role service_role;
update sellertray_c1b_fixture f set checkout_1_id=(public.reserve_sellertray_installment_checkout(f.tenant_id,f.schedule_1_id,gen_random_uuid(),f.owner_user_id,'owner@example.com')->>'sessionId')::uuid;
select public.begin_sellertray_installment_checkout_initialization(checkout_1_id) from sellertray_c1b_fixture;
select public.complete_sellertray_installment_checkout_initialization(f.checkout_1_id,s.reference,'https://checkout.example/oa2') from sellertray_c1b_fixture f join public.billing_checkout_sessions s on s.id=f.checkout_1_id;
reset role;
select extensions.ok((select checkout_1_id is not null from sellertray_c1b_fixture),'service-role checkout initializes without UPDATE permission on immutable orders');
select extensions.ok(not has_function_privilege('authenticated','public.lock_sellertray_commercial_order(uuid,uuid)','EXECUTE'),'merchant clients cannot invoke internal commercial locks');
select public.platform_admin_record_commercial_direct_payment(f.admin_user_id,f.tenant_id,f.commercial_order_id,gen_random_uuid(),'DIRECT-REMAINDER','bank_transfer',460,now(),'Confirmed remainder','{}') from sellertray_c1b_fixture f;
select extensions.is((select s.status from public.billing_checkout_sessions s join sellertray_c1b_fixture f on s.id=f.checkout_1_id),'superseded','direct payment retires stale provider checkout');
select extensions.throws_ok(format('select public.confirm_sellertray_installment_payment_from_checkout(%L,%L,%L,460,%L,now(),%L)',f.checkout_1_id,s.reference,'delayed-provider','NGN',repeat('a',64)),'23514',null::text,'delayed callback cannot revive superseded checkout') from sellertray_c1b_fixture f join public.billing_checkout_sessions s on s.id=f.checkout_1_id;
select extensions.ok((pg_temp.onboarding()->'settlement'->>'qualifyingSettlementSatisfied')::boolean,'direct payments can satisfy qualifying settlement without provider events');
select extensions.is(pg_temp.onboarding()->>'currentStage','setup','Mobile onboarding progresses to setup on direct settlement');
select extensions.is((select count(*)::integer from public.sellertray_commercial_entitlement_events e join sellertray_c1b_fixture f on e.commercial_order_id=f.commercial_order_id),0,'qualifying settlement cannot activate before setup');
select public.mark_sellertray_commercial_branch_setup_ready(f.tenant_id,f.commercial_order_id,f.branch_id,gen_random_uuid(),'{}','Setup verified',now(),f.admin_user_id) from sellertray_c1b_fixture f;
select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id) from sellertray_c1b_fixture;
select extensions.is(pg_temp.onboarding()->'activation'->>'entitlementState','provisional','agreement plus setup and qualifying direct settlement activates provisionally');
select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id) from sellertray_c1b_fixture;
select extensions.is((select count(*)::integer from public.sellertray_commercial_entitlement_events e join sellertray_c1b_fixture f on e.commercial_order_id=f.commercial_order_id and e.event_type='installment.provisional_activated'),1,'reconciliation replay cannot duplicate provisional entitlement');

-- A new material discount after acceptance invalidates the old terms; no
-- existing accepted document or acceptance is changed or removed.
select public.platform_admin_record_commercial_adjustment(f.admin_user_id,f.tenant_id,f.commercial_order_id,gen_random_uuid(),10,'Post acceptance adjustment','{}') from sellertray_c1b_fixture f;
select extensions.ok(not (select public.sellertray_installment_agreement_is_accepted(f.tenant_id,f.commercial_order_id,f.installment_obligation_id) from sellertray_c1b_fixture f),'material post-acceptance discount requires replacement acceptance');
select extensions.is(pg_temp.onboarding()->'agreement'->>'accepted','false','Mobile and shared reconciliation agree that old terms need replacement');
select extensions.is((select count(*)::integer from public.sellertray_commercial_agreement_acceptances ac join sellertray_c1b_fixture f on ac.agreement_id=f.agreement_id),1,'discount preserves original immutable accepted evidence');
select extensions.throws_ok(format('select public.platform_admin_record_commercial_adjustment(%L,%L,%L,%L,999,%L)',f.admin_user_id,f.tenant_id,f.commercial_order_id,gen_random_uuid(),'Excessive discount'),'23514',null::text,'adjustment cannot reduce net due below confirmed payments') from sellertray_c1b_fixture f;

-- Explicit Admin denials take precedence over the compatibility Admin bundle.
insert into public.platform_admin_capability_grant_versions(grantee_user_id,capability_code,scope_kind,tenant_id,enabled,created_by_user_id,reason)
select admin_user_id,'admin.pricing.manage','tenant',tenant_id,false,admin_user_id,'Scoped Admin denial' from sellertray_c1b_fixture;
select extensions.ok(not public.platform_admin_has_capability(f.admin_user_id,'admin.pricing.manage',f.tenant_id),'explicit scoped denial applies to Platform Admin') from sellertray_c1b_fixture f;
select extensions.throws_ok(format('select public.platform_admin_record_commercial_adjustment(%L,%L,%L,%L,1,%L)',f.admin_user_id,f.tenant_id,f.commercial_order_id,gen_random_uuid(),'Denied Admin adjustment'),'42501',null::text,'denied Admin mutation fails at server authority') from sellertray_c1b_fixture f;
select * from extensions.finish();
rollback;
