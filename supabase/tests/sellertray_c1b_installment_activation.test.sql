begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

create temp table sellertray_c1b_fixture (
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  tenant_id uuid not null,
  branch_id uuid not null,
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
select tenant_id,'C1B Installment Tenant','c1b-'||substr(tenant_id::text,1,8),'C1B-'||upper(substr(tenant_id::text,1,6)),'trial'
from sellertray_c1b_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_c1b_fixture;

insert into public.branches(id,tenant_id,code,name,is_default,is_active)
select branch_id,tenant_id,'HQ','C1B HQ',true,true from sellertray_c1b_fixture;

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
  select tenant_id,installment_obligation_id,1,70,700 from sellertray_c1b_fixture
  returning id
)
update sellertray_c1b_fixture set schedule_1_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,installment_obligation_id,2,30,300 from sellertray_c1b_fixture
  returning id
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
  and to_regprocedure('public.reconcile_sellertray_installment_entitlement(uuid,uuid)') is not null,
  'C1B persistence and reconciliation authority exist'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_commercial_installment_payment_confirmations','SELECT')
  and not has_function_privilege('authenticated','public.reconcile_sellertray_installment_entitlement(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.reconcile_sellertray_installment_entitlement(uuid,uuid)','EXECUTE'),
  'C1B payment and entitlement authority stays service-only'
);

select extensions.is(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState',
  'pending_agreement'::text,
  'installment entitlement initially waits for the current agreement'
);

select extensions.is(
  (public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'setupRequiredCount')::integer,
  1,
  'required Branch setup derives from the governed order'
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
  )->>'entitlementState',
  'pending_setup'::text,
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
  )->>'entitlementState',
  'awaiting_first_payment'::text,
  'agreement plus setup readiness still waits for confirmed payment'
);

with reserved as (
  select f.checkout_1_command,f.tenant_id,f.schedule_1_id,f.owner_user_id,
         public.reserve_sellertray_installment_checkout(
           f.tenant_id,f.schedule_1_id,f.checkout_1_command,f.owner_user_id,'owner@example.com'
         ) as result
  from sellertray_c1b_fixture f
)
update sellertray_c1b_fixture f
set checkout_1_id=(reserved.result->>'sessionId')::uuid
from reserved;

select extensions.ok(
  exists(
    select 1 from public.billing_checkout_sessions s
    join sellertray_c1b_fixture f on s.id=f.checkout_1_id
    where s.checkout_kind='installment' and s.status='preparing'
      and s.amount=700 and s.currency='NGN'
      and s.installment_schedule_id=f.schedule_1_id
  ),
  'first checkout reserves immutable installment amount and currency'
);

select extensions.is(
  (public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_1_id,f.checkout_1_command,f.owner_user_id,'owner@example.com'
  )->>'sessionId')::uuid,
  f.checkout_1_id,
  'identical checkout command replays to the same reservation'
) from sellertray_c1b_fixture f;

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
from public.billing_checkout_sessions s
where s.id=f.checkout_1_id;

select extensions.is(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState',
  'ready_for_activation'::text,
  'confirmed payment remains separate until reconciliation'
);

select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from sellertray_c1b_fixture;

select extensions.is(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState',
  'provisional'::text,
  'qualifying 70 percent first payment activates provisional entitlement'
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_commercial_entitlement_events e
    join sellertray_c1b_fixture f on e.installment_obligation_id=f.installment_obligation_id
    where e.event_type='installment.provisional_activated'
      and e.effective_until=e.effective_from+interval '2 months'
  ),
  '70:30 provisional entitlement is exactly two months'
);

with reserved as (
  select f.*,public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_2_id,f.checkout_2_command,f.owner_user_id,'owner@example.com'
  ) as result
  from sellertray_c1b_fixture f
)
update sellertray_c1b_fixture f
set checkout_2_id=(reserved.result->>'sessionId')::uuid
from reserved;

select extensions.ok(
  (select checkout_2_id is not null from sellertray_c1b_fixture),
  'second installment becomes payable after the first is confirmed'
);

update sellertray_c1b_fixture set second_paid_at=now();
update sellertray_c1b_fixture f
set payment_2_id=public.confirm_sellertray_installment_payment_from_checkout(
  f.checkout_2_id,s.reference,'paystack-c1b-second',300,'NGN',f.second_paid_at,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
)
from public.billing_checkout_sessions s
where s.id=f.checkout_2_id;

select extensions.is(
  public.confirm_sellertray_installment_payment_from_checkout(
    f.checkout_2_id,s.reference,'paystack-c1b-second',300,'NGN',f.second_paid_at,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ),
  f.payment_2_id,
  'confirmed provider payment replays idempotently'
)
from sellertray_c1b_fixture f
join public.billing_checkout_sessions s on s.id=f.checkout_2_id;

select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from sellertray_c1b_fixture;

select extensions.is(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'entitlementState',
  'full'::text,
  'full settlement releases full entitlement'
);

select extensions.ok(
  exists(
    select 1
    from public.sellertray_commercial_entitlement_events provisional
    join public.sellertray_commercial_entitlement_events full
      on full.tenant_id=provisional.tenant_id
     and full.installment_obligation_id=provisional.installment_obligation_id
    join sellertray_c1b_fixture f on f.installment_obligation_id=provisional.installment_obligation_id
    where provisional.event_type='installment.provisional_activated'
      and full.event_type='installment.full_entitlement_released'
      and full.effective_from=provisional.effective_from
      and full.effective_until=provisional.effective_from+interval '12 months'
  ),
  'full settlement keeps original activation and a fixed twelve-month term'
);

select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from sellertray_c1b_fixture;
select extensions.is(
  (select count(*)::integer from public.sellertray_commercial_entitlement_events e
   join sellertray_c1b_fixture f on e.installment_obligation_id=f.installment_obligation_id
   where e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')),
  2,
  'reconciliation retry never duplicates entitlement events'
);

select extensions.is(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from sellertray_c1b_fixture),
    (select installment_obligation_id from sellertray_c1b_fixture)
  )->>'dueEnforcementMode',
  'informational_only'::text,
  'due-state enforcement stays informational until timing policy is approved'
);

select extensions.ok(
  not exists(
    select 1 from public.sellertray_commercial_installment_schedule s
    join sellertray_c1b_fixture f on s.installment_obligation_id=f.installment_obligation_id
    where s.due_at is not null
  ),
  'C1B does not invent installment due dates'
);

select extensions.ok(
  position('tenant_subscriptions' in pg_get_functiondef(
    'public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)'::regprocedure
  ))=0,
  'payment confirmation contains no hidden entitlement mutation'
);

select extensions.ok(
  position('sellertray_c1b_runtime_period_state' in pg_get_functiondef(
    'public.orderdesk_subscription_can_write(uuid)'::regprocedure
  ))>0
  and position('provisional_expired' in pg_get_functiondef(
    'public.orderdesk_subscription_can_write(uuid)'::regprocedure
  ))>0,
  'legacy runtime write gate enforces C1B-owned entitlement expiry'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'Branch setup readiness is service-authority only'
);

select * from extensions.finish();
rollback;
