begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

create temp table c1b_structure_fixture (
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
  schedule_3_id uuid,
  template_id uuid,
  agreement_id uuid,
  checkout_1_id uuid,
  checkout_2_id uuid,
  checkout_3_id uuid,
  activation_at timestamptz
) on commit drop;

insert into c1b_structure_fixture(admin_user_id,owner_user_id,tenant_id,branch_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'c1b-structure-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c1b_structure_fixture
union all
select owner_user_id,'c1b-structure-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c1b_structure_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from c1b_structure_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C1B Three Installment Tenant','c1b-three-'||substr(tenant_id::text,1,8),'C1T','trial'
from c1b_structure_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from c1b_structure_fixture;

update c1b_structure_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',80,now()-interval '1 day',
         'C1B three-part governed monthly anchor',admin_user_id,admin_user_id,now()
  from c1b_structure_fixture returning id
)
update c1b_structure_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',800,now()-interval '1 day',
         'C1B three-part annual subscription',admin_user_id,admin_user_id,now()
  from c1b_structure_fixture returning id
)
update c1b_structure_fixture set subscription_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,currency,gross_amount,effective_from,change_reason,
    created_by_user_id,approved_by_user_id,approved_at
  )
  select 'branch_setup','NGN',200,now()-interval '1 day','C1B three-part Branch setup',
         admin_user_id,admin_user_id,now()
  from c1b_structure_fixture returning id
)
update c1b_structure_fixture set setup_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,'C1B3-'||upper(substr(tenant_id::text,1,8)),'NGN',1000,now(),admin_user_id
  from c1b_structure_fixture returning id
)
update c1b_structure_fixture set commercial_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot
)
select tenant_id,commercial_order_id,1,'subscription',subscription_price_id,null,'Annual SellerTray subscription'
from c1b_structure_fixture
union all
select tenant_id,commercial_order_id,2,'branch_setup',setup_price_id,branch_id,'SellerTray Branch setup'
from c1b_structure_fixture;
set constraints all immediate;

-- SET CONSTRAINTS ALL IMMEDIATE persists for the transaction. Re-defer both
-- installment validators before creating the obligation so validation sees the
-- complete governed 60:20:20 schedule rather than empty/partial fixture state.
set constraints validate_sellertray_commercial_installment_obligation deferred;
set constraints validate_sellertray_commercial_installment_schedule_line deferred;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,commercial_order_id,'three_installment_60_20_20','NGN',1000,admin_user_id
  from c1b_structure_fixture returning id
)
update c1b_structure_fixture set installment_obligation_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  ) select tenant_id,installment_obligation_id,1,60,600 from c1b_structure_fixture returning id
)
update c1b_structure_fixture set schedule_1_id=(select id from inserted);
with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  ) select tenant_id,installment_obligation_id,2,20,200 from c1b_structure_fixture returning id
)
update c1b_structure_fixture set schedule_2_id=(select id from inserted);
with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  ) select tenant_id,installment_obligation_id,3,20,200 from c1b_structure_fixture returning id
)
update c1b_structure_fixture set schedule_3_id=(select id from inserted);
set constraints all immediate;

update c1b_structure_fixture f
set template_id=public.publish_sellertray_commercial_agreement_template_version(
  'installment_agreement','c1b-three-2026.1','SellerTray Three-Part Installment Agreement',
  'C1B three-part test agreement content',now()-interval '1 minute',f.admin_user_id
);

update c1b_structure_fixture f
set agreement_id=public.issue_sellertray_commercial_agreement(
  f.tenant_id,f.commercial_order_id,f.installment_obligation_id,f.template_id,
  'AGR-C1B3-'||upper(substr(f.tenant_id::text,1,8)),
  'Merchant-specific C1B three-part installment agreement',null,f.admin_user_id
);

select public.accept_sellertray_commercial_agreement(
  f.tenant_id,f.agreement_id,'C1B Three-Part Test Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),
  gen_random_uuid(),f.owner_user_id
) from c1b_structure_fixture f;

select public.mark_sellertray_commercial_branch_setup_ready(
  f.tenant_id,f.commercial_order_id,f.branch_id,gen_random_uuid(),
  jsonb_build_object('source','c1b_structure_test'),'C1B three-part setup completed',now(),f.admin_user_id
) from c1b_structure_fixture f;

with reserved as (
  select f.*,public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_1_id,gen_random_uuid(),f.owner_user_id,'owner@example.com'
  ) as result from c1b_structure_fixture f
)
update c1b_structure_fixture set checkout_1_id=(reserved.result->>'sessionId')::uuid from reserved;

select public.complete_sellertray_installment_checkout_initialization(
  f.checkout_1_id,s.reference,'https://checkout.example/c1b-three-first'
)
from c1b_structure_fixture f
join public.billing_checkout_sessions s on s.id=f.checkout_1_id;

select public.confirm_sellertray_installment_payment_from_checkout(
  f.checkout_1_id,s.reference,'paystack-c1b-three-first',600,'NGN',now(),
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
)
from c1b_structure_fixture f
join public.billing_checkout_sessions s on s.id=f.checkout_1_id;

select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from c1b_structure_fixture;

update c1b_structure_fixture f
set activation_at=(
  select e.effective_from
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=f.tenant_id
    and e.installment_obligation_id=f.installment_obligation_id
    and e.event_type='installment.provisional_activated'
  order by e.recorded_at desc limit 1
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_commercial_entitlement_events e
    join c1b_structure_fixture f on f.installment_obligation_id=e.installment_obligation_id
    where e.event_type='installment.provisional_activated'
      and e.effective_until=e.effective_from+interval '3 months'
  ),
  '60:20:20 first payment releases exactly three months of provisional entitlement'
);

select extensions.ok(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from c1b_structure_fixture),
    (select installment_obligation_id from c1b_structure_fixture)
  )->>'entitlementState'='provisional'
  and (public.get_sellertray_installment_billing_state(
    (select tenant_id from c1b_structure_fixture),
    (select installment_obligation_id from c1b_structure_fixture)
  )->>'paidInstallmentCount')::integer=1,
  'three-part billing state remains provisional after only the first installment'
);

with reserved as (
  select f.*,public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_2_id,gen_random_uuid(),f.owner_user_id,'owner@example.com'
  ) as result from c1b_structure_fixture f
)
update c1b_structure_fixture set checkout_2_id=(reserved.result->>'sessionId')::uuid from reserved;
select public.complete_sellertray_installment_checkout_initialization(
  f.checkout_2_id,s.reference,'https://checkout.example/c1b-three-second'
) from c1b_structure_fixture f join public.billing_checkout_sessions s on s.id=f.checkout_2_id;
select public.confirm_sellertray_installment_payment_from_checkout(
  f.checkout_2_id,s.reference,'paystack-c1b-three-second',200,'NGN',now(),
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
) from c1b_structure_fixture f join public.billing_checkout_sessions s on s.id=f.checkout_2_id;

select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from c1b_structure_fixture;

select extensions.ok(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from c1b_structure_fixture),
    (select installment_obligation_id from c1b_structure_fixture)
  )->>'entitlementState'='provisional',
  'second 20 percent payment alone does not release the full annual entitlement'
);

with reserved as (
  select f.*,public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_3_id,gen_random_uuid(),f.owner_user_id,'owner@example.com'
  ) as result from c1b_structure_fixture f
)
update c1b_structure_fixture set checkout_3_id=(reserved.result->>'sessionId')::uuid from reserved;
select public.complete_sellertray_installment_checkout_initialization(
  f.checkout_3_id,s.reference,'https://checkout.example/c1b-three-third'
) from c1b_structure_fixture f join public.billing_checkout_sessions s on s.id=f.checkout_3_id;
select public.confirm_sellertray_installment_payment_from_checkout(
  f.checkout_3_id,s.reference,'paystack-c1b-three-third',200,'NGN',now(),
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
) from c1b_structure_fixture f join public.billing_checkout_sessions s on s.id=f.checkout_3_id;

select public.reconcile_sellertray_installment_entitlement(tenant_id,installment_obligation_id)
from c1b_structure_fixture;

select extensions.ok(
  exists(
    select 1 from public.sellertray_commercial_entitlement_events full_event
    join c1b_structure_fixture f on f.installment_obligation_id=full_event.installment_obligation_id
    where full_event.event_type='installment.full_entitlement_released'
      and full_event.effective_from=f.activation_at
      and full_event.effective_until=f.activation_at+interval '12 months'
  ),
  '60:20:20 full settlement releases one fixed twelve-month term from original activation'
);

select extensions.ok(
  public.get_sellertray_installment_billing_state(
    (select tenant_id from c1b_structure_fixture),
    (select installment_obligation_id from c1b_structure_fixture)
  )->>'entitlementState'='full'
  and (public.get_sellertray_installment_billing_state(
    (select tenant_id from c1b_structure_fixture),
    (select installment_obligation_id from c1b_structure_fixture)
  )->>'paidInstallmentCount')::integer=3,
  'three-part billing state becomes full only after all three provider-confirmed payments'
);

select extensions.ok(
  position('tenant_subscriptions' in pg_get_functiondef(
    'public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)'::regprocedure
  ))=0,
  'provider payment confirmation remains transactionally separate from runtime entitlement reconciliation conflicts'
);

select * from extensions.finish();
rollback;
