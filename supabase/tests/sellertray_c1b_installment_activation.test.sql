begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

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

select extensions.ok(
  to_regclass('public.sellertray_commercial_branch_setup_readiness') is not null
  and to_regclass('public.sellertray_commercial_installment_payment_confirmations') is not null
  and to_regprocedure('public.reconcile_sellertray_installment_entitlement(uuid,uuid)') is not null
  and not has_function_privilege('authenticated','public.reconcile_sellertray_installment_entitlement(uuid,uuid)','EXECUTE'),
  'C1B persistence and reconciliation exist behind service authority'
);

select extensions.ok(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState'='pending_agreement'
  and (public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'setupRequiredCount')::integer=1,
  'C1B starts pending agreement and derives Branch setup from the commercial order'
);

do $$
begin
  begin
    perform public.reserve_sellertray_installment_checkout(
      f.tenant_id,f.schedule_2_id,f.checkout_2_command,f.owner_user_id,'owner@example.com'
    ) from sellertray_c1b_fixture f;
  exception when sqlstate '23514' then
    update sellertray_c1b_fixture set second_before_first_rejected=true;
  end;
end
$$;
select extensions.ok(
  (select second_before_first_rejected from sellertray_c1b_fixture),
  'later installment cannot bypass an unpaid earlier installment'
);

select public.accept_sellertray_commercial_agreement(
  f.tenant_id,f.agreement_id,'C1B Test Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),
  gen_random_uuid(),f.owner_user_id
) from sellertray_c1b_fixture f;

select extensions.is(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState','pending_setup'::text,
  'agreement acceptance alone does not activate entitlement'
);

select public.mark_sellertray_commercial_branch_setup_ready(
  f.tenant_id,f.commercial_order_id,f.branch_id,gen_random_uuid(),
  jsonb_build_object('source','c1b_test'),'C1B setup completed',now(),f.admin_user_id
) from sellertray_c1b_fixture f;

select extensions.is(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState','awaiting_first_payment'::text,
  'agreement plus setup readiness still waits for confirmed payment'
);

with reserved as (
  select f.*,public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_1_id,f.checkout_1_command,f.owner_user_id,'owner@example.com'
  ) as result from sellertray_c1b_fixture f
)
update sellertray_c1b_fixture set checkout_1_id=(reserved.result->>'sessionId')::uuid from reserved;

select extensions.ok(
  exists(
    select 1 from public.billing_checkout_sessions s
    join sellertray_c1b_fixture f on s.id=f.checkout_1_id
    where s.checkout_kind='installment' and s.status='preparing'
      and s.amount=700 and s.currency='NGN' and s.installment_schedule_id=f.schedule_1_id
  )
  and (select (public.reserve_sellertray_installment_checkout(
    tenant_id,schedule_1_id,checkout_1_command,owner_user_id,'owner@example.com'
  )->>'sessionId')::uuid=checkout_1_id from sellertray_c1b_fixture),
  'first checkout snapshots schedule money and replays by command identity'
);

select public.begin_sellertray_installment_checkout_initialization(f.checkout_1_id)
from sellertray_c1b_fixture f;
select public.complete_sellertray_installment_checkout_initialization(
  f.checkout_1_id,s.reference,'https://checkout.example/c1b-first'
)
from sellertray_c1b_fixture f
join public.billing_checkout_sessions s on s.id=f.checkout_1_id;

update sellertray_c1b_fixture set first_paid_at=now();
update sellertray_c1b_fixture f
set payment_1_id=public.confirm_sellertray_installment_payment_from_checkout(
  f.checkout_1_id,s.reference,'paystack-c1b-first',700,'NGN',f.first_paid_at,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
)
from public.billing_checkout_sessions s where s.id=f.checkout_1_id;

select extensions.is(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState','ready_for_activation'::text,
  'provider payment confirmation remains separate until entitlement reconciliation'
);

select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from sellertray_c1b_fixture;

select extensions.ok(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState'='provisional'
  and exists(
    select 1 from public.sellertray_commercial_entitlement_events e
    join sellertray_c1b_fixture f on e.installment_obligation_id=f.installment_obligation_id
    where e.event_type='installment.provisional_activated'
      and e.effective_until=e.effective_from+interval '2 months'
  ),
  '70:30 first payment releases exactly two months of provisional entitlement'
);

with reserved as (
  select f.*,public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_2_id,f.checkout_2_command,f.owner_user_id,'owner@example.com'
  ) as result from sellertray_c1b_fixture f
)
update sellertray_c1b_fixture set checkout_2_id=(reserved.result->>'sessionId')::uuid from reserved;

select extensions.ok((select checkout_2_id is not null from sellertray_c1b_fixture),
  'second installment becomes payable only after the first is confirmed');

-- Exercise the crash/lost-response recovery path: the provider attempt has
-- started, but the authorization URL was never persisted before the signed
-- provider confirmation arrives. The leased `preparing` checkout is valid.
select public.begin_sellertray_installment_checkout_initialization(f.checkout_2_id)
from sellertray_c1b_fixture f;
update sellertray_c1b_fixture set second_paid_at=now();
update sellertray_c1b_fixture f
set payment_2_id=public.confirm_sellertray_installment_payment_from_checkout(
  f.checkout_2_id,s.reference,'paystack-c1b-second',300,'NGN',f.second_paid_at,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
)
from public.billing_checkout_sessions s where s.id=f.checkout_2_id;

select extensions.is(
  public.confirm_sellertray_installment_payment_from_checkout(
    f.checkout_2_id,s.reference,'paystack-c1b-second',300,'NGN',f.second_paid_at,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ),f.payment_2_id,
  'provider-confirmed payment retry is idempotent'
)
from sellertray_c1b_fixture f
join public.billing_checkout_sessions s on s.id=f.checkout_2_id;

select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from sellertray_c1b_fixture;

select extensions.ok(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState'='full'
  and exists(
    select 1 from public.sellertray_commercial_entitlement_events provisional
    join public.sellertray_commercial_entitlement_events full
      on full.tenant_id=provisional.tenant_id
     and full.installment_obligation_id=provisional.installment_obligation_id
    join sellertray_c1b_fixture f on f.installment_obligation_id=provisional.installment_obligation_id
    where provisional.event_type='installment.provisional_activated'
      and full.event_type='installment.full_entitlement_released'
      and full.effective_from=provisional.effective_from
      and full.effective_until=provisional.effective_from+interval '12 months'
  ),
  'full settlement keeps original activation and releases one fixed twelve-month term'
);

select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from sellertray_c1b_fixture;
select extensions.is(
  (select count(*)::integer from public.sellertray_commercial_entitlement_events e
   join sellertray_c1b_fixture f on e.installment_obligation_id=f.installment_obligation_id
   where e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')),
  2,'reconciliation retry does not duplicate entitlement effects'
);

select extensions.ok(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'dueEnforcementMode'='informational_only'
  and not exists(
    select 1 from public.sellertray_commercial_installment_schedule s
    join sellertray_c1b_fixture f on s.installment_obligation_id=f.installment_obligation_id
    where s.due_at is not null
  ),
  'C1B keeps due timing informational and invents no installment dates'
);

select extensions.ok(
  position('tenant_subscriptions' in pg_get_functiondef(
    'public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)'::regprocedure
  ))=0
  and position('sellertray_c1b_runtime_period_state' in pg_get_functiondef(
    'public.orderdesk_subscription_can_write(uuid)'::regprocedure
  ))>0,
  'payment confirmation has no hidden entitlement mutation and runtime access enforces C1B periods separately'
);

select extensions.ok(
  not has_function_privilege('authenticated',
    'public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)','EXECUTE')
  and not has_table_privilege('authenticated','public.sellertray_commercial_branch_setup_readiness','SELECT'),
  'Branch setup readiness stays behind service authority'
);

select * from extensions.finish();
rollback;
