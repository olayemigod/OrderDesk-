begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

create temp table c1b_checkout_fixture (
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  tenant_id uuid not null,
  monthly_price_id uuid,
  yearly_price_id uuid,
  order_id uuid,
  obligation_id uuid,
  schedule_1_id uuid,
  schedule_2_id uuid,
  checkout_id uuid
) on commit drop;

insert into c1b_checkout_fixture(admin_user_id,owner_user_id,tenant_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'checkout-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c1b_checkout_fixture
union all
select owner_user_id,'checkout-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c1b_checkout_fixture;
insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from c1b_checkout_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Checkout Independence Tenant','checkout-independent-'||substr(tenant_id::text,1,8),'CIT','trial'
from c1b_checkout_fixture;
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from c1b_checkout_fixture;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',80,now()-interval '1 day',
         'Checkout independence monthly anchor',admin_user_id,admin_user_id,now()
  from c1b_checkout_fixture returning id
)
update c1b_checkout_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',800,now()-interval '1 day',
         'Checkout independence annual price',admin_user_id,admin_user_id,now()
  from c1b_checkout_fixture returning id
)
update c1b_checkout_fixture set yearly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,'CHECKOUT-'||upper(substr(tenant_id::text,1,6)),'NGN',800,now(),admin_user_id
  from c1b_checkout_fixture returning id
)
update c1b_checkout_fixture set order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select tenant_id,order_id,1,'subscription',yearly_price_id,'Annual SellerTray subscription'
from c1b_checkout_fixture;
set constraints all immediate;
set constraints validate_sellertray_commercial_installment_obligation deferred;
set constraints validate_sellertray_commercial_installment_schedule_line deferred;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,order_id,'two_installment_70_30','NGN',800,admin_user_id
  from c1b_checkout_fixture returning id
)
update c1b_checkout_fixture set obligation_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,obligation_id,1,70,560 from c1b_checkout_fixture returning id
)
update c1b_checkout_fixture set schedule_1_id=(select id from inserted);
with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,obligation_id,2,30,240 from c1b_checkout_fixture returning id
)
update c1b_checkout_fixture set schedule_2_id=(select id from inserted);
set constraints all immediate;

select extensions.ok(
  to_regprocedure('public.guard_sellertray_initial_purchase_installment_checkout()') is not null
  and exists(
    select 1 from pg_trigger
    where tgrelid='public.billing_checkout_sessions'::regclass
      and tgname='guard_sellertray_initial_purchase_installment_checkout'
      and not tgisinternal
  ),
  'installment checkout persistence guard remains installed'
);

select extensions.ok(
  position('agreementaccepted' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure)))=0
  and position('master_agreement' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure)))=0,
  'checkout reservation has no Master Agreement dependency'
);

select extensions.ok(
  position('agreementaccepted' in lower(pg_get_functiondef('public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure)))=0
  and position('master_agreement' in lower(pg_get_functiondef('public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure)))=0,
  'checkout persistence guard has no Master Agreement dependency'
);

select extensions.ok(
  (public.get_sellertray_installment_contract_checkout_policy(tenant_id,obligation_id)->>'checkoutEligible')::boolean
  and not (public.get_sellertray_installment_contract_checkout_policy(tenant_id,obligation_id)->>'masterAgreementPublished')::boolean
  and not (public.get_sellertray_installment_contract_checkout_policy(tenant_id,obligation_id)->>'masterAgreementAccepted')::boolean,
  'commercial checkout stays eligible while Master Agreement service-delivery acceptance is still absent'
) from c1b_checkout_fixture;

with reserved as (
  select f.*,public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_1_id,gen_random_uuid(),f.owner_user_id,'owner@example.com'
  ) as result from c1b_checkout_fixture f
)
update c1b_checkout_fixture set checkout_id=(reserved.result->>'sessionId')::uuid from reserved;

select extensions.ok(
  exists(
    select 1 from public.billing_checkout_sessions s
    join c1b_checkout_fixture f on s.id=f.checkout_id
    where s.status='preparing' and s.checkout_kind='installment' and s.amount=560
  ),
  'Owner may reserve the authoritative installment payment before Master Agreement acceptance'
);

select public.reconcile_sellertray_installment_entitlement(tenant_id,obligation_id)
from c1b_checkout_fixture;
select extensions.ok(
  public.get_sellertray_installment_billing_state(tenant_id,obligation_id)->>'entitlementState'='pending_agreement'
  and not exists(
    select 1 from public.sellertray_commercial_entitlement_events e
    join c1b_checkout_fixture f on e.installment_obligation_id=f.obligation_id
  ),
  'missing Master Agreement acceptance blocks service delivery/activation without blocking payment'
) from c1b_checkout_fixture;

select * from extensions.finish();
rollback;
