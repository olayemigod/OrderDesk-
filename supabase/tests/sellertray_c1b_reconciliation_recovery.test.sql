begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

create temp table c1b_reconcile_fixture (
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  tenant_id uuid not null,
  branch_id uuid not null,
  monthly_price_id uuid,
  yearly_price_id uuid,
  setup_price_id uuid,
  broken_order_id uuid,
  broken_obligation_id uuid,
  broken_schedule_1_id uuid,
  master_agreement_id uuid,
  broken_checkout_id uuid,
  valid_order_id uuid,
  valid_obligation_id uuid
) on commit drop;

insert into c1b_reconcile_fixture(admin_user_id,owner_user_id,tenant_id,branch_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'c1b-reconcile-admin-'||substr(admin_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from c1b_reconcile_fixture
union all
select owner_user_id,'c1b-reconcile-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from c1b_reconcile_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from c1b_reconcile_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C1B Reconciliation Recovery Tenant',
       'c1b-reconcile-'||substr(tenant_id::text,1,8),
       'C1R','trial'
from c1b_reconcile_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from c1b_reconcile_fixture;

update c1b_reconcile_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',80,now()-interval '1 day',
         'C1B reconciliation monthly anchor',admin_user_id,admin_user_id,now()
  from c1b_reconcile_fixture returning id
)
update c1b_reconcile_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',800,now()-interval '1 day',
         'C1B reconciliation annual price',admin_user_id,admin_user_id,now()
  from c1b_reconcile_fixture returning id
)
update c1b_reconcile_fixture set yearly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,currency,gross_amount,effective_from,change_reason,
    created_by_user_id,approved_by_user_id,approved_at
  )
  select 'branch_setup','NGN',200,now()-interval '1 day',
         'C1B reconciliation Branch setup',admin_user_id,admin_user_id,now()
  from c1b_reconcile_fixture returning id
)
update c1b_reconcile_fixture set setup_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,'C1B-REC-BROKEN-'||upper(substr(tenant_id::text,1,6)),
         'NGN',1000,now()-interval '1 minute',admin_user_id
  from c1b_reconcile_fixture returning id
)
update c1b_reconcile_fixture set broken_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot
)
select tenant_id,broken_order_id,1,'subscription',yearly_price_id,null,'Annual SellerTray subscription'
from c1b_reconcile_fixture
union all
select tenant_id,broken_order_id,2,'branch_setup',setup_price_id,branch_id,'SellerTray Branch setup'
from c1b_reconcile_fixture;
set constraints all immediate;
set constraints validate_sellertray_commercial_installment_obligation deferred;
set constraints validate_sellertray_commercial_installment_schedule_line deferred;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,broken_order_id,'two_installment_70_30','NGN',1000,admin_user_id
  from c1b_reconcile_fixture returning id
)
update c1b_reconcile_fixture set broken_obligation_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,broken_obligation_id,1,70,700 from c1b_reconcile_fixture returning id
)
update c1b_reconcile_fixture set broken_schedule_1_id=(select id from inserted);

insert into public.sellertray_commercial_installment_schedule(
  tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
)
select tenant_id,broken_obligation_id,2,30,300 from c1b_reconcile_fixture;
set constraints all immediate;

set constraints validate_sellertray_commercial_order_amounts_header deferred;
set constraints validate_sellertray_commercial_order_amounts_snapshot deferred;

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,'C1B-REC-VALID-'||upper(substr(tenant_id::text,1,6)),
         'NGN',800,now(),admin_user_id
  from c1b_reconcile_fixture returning id
)
update c1b_reconcile_fixture set valid_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select tenant_id,valid_order_id,1,'subscription',yearly_price_id,'Annual SellerTray subscription'
from c1b_reconcile_fixture;
set constraints all immediate;
set constraints validate_sellertray_commercial_installment_obligation deferred;
set constraints validate_sellertray_commercial_installment_schedule_line deferred;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,valid_order_id,'two_installment_70_30','NGN',800,admin_user_id
  from c1b_reconcile_fixture returning id
)
update c1b_reconcile_fixture set valid_obligation_id=(select id from inserted);

insert into public.sellertray_commercial_installment_schedule(
  tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
)
select tenant_id,valid_obligation_id,1,70,560 from c1b_reconcile_fixture
union all
select tenant_id,valid_obligation_id,2,30,240 from c1b_reconcile_fixture;
set constraints all immediate;

update c1b_reconcile_fixture f
set master_agreement_id=public.publish_sellertray_master_agreement_admin(
  'test-'||substr(f.tenant_id::text,1,8),
  'SellerTray Master Agreement',
  'Universal C1B reconciliation recovery agreement',
  now()-interval '1 minute',
  'C1B reconciliation test publication',
  f.admin_user_id
);

select public.accept_sellertray_master_agreement(
  f.tenant_id,f.master_agreement_id,'C1B Reconciliation Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),
  gen_random_uuid(),f.owner_user_id
) from c1b_reconcile_fixture f;

select public.mark_sellertray_commercial_branch_setup_ready(
  f.tenant_id,f.broken_order_id,f.branch_id,gen_random_uuid(),
  jsonb_build_object('source','c1b_reconciliation_test'),
  'C1B reconciliation setup completed',now(),f.admin_user_id
) from c1b_reconcile_fixture f;

with reserved as (
  select f.*,public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.broken_schedule_1_id,gen_random_uuid(),f.owner_user_id,
    'reconcile-owner@example.com'
  ) as result from c1b_reconcile_fixture f
)
update c1b_reconcile_fixture
set broken_checkout_id=(reserved.result->>'sessionId')::uuid
from reserved;

select public.begin_sellertray_installment_checkout_initialization(f.broken_checkout_id)
from c1b_reconcile_fixture f;
select public.complete_sellertray_installment_checkout_initialization(
  f.broken_checkout_id,s.reference,'https://checkout.example/c1b-reconcile'
)
from c1b_reconcile_fixture f
join public.billing_checkout_sessions s on s.id=f.broken_checkout_id;

select public.confirm_sellertray_installment_payment_from_checkout(
  f.broken_checkout_id,s.reference,'paystack-c1b-reconcile',700,'NGN',now(),
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
)
from c1b_reconcile_fixture f
join public.billing_checkout_sessions s on s.id=f.broken_checkout_id;

update public.tenant_subscriptions s
set plan_code='business',status='active',
    current_period_start=now()-interval '10 days',
    current_period_end=now()+interval '20 days',
    trial_ends_at=null,grace_ends_at=null,updated_at=now()
from c1b_reconcile_fixture f
where s.tenant_id=f.tenant_id;

select extensions.ok(
  has_function_privilege(
    'service_role','public.reconcile_sellertray_installment_entitlements_for_tenant(uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.reconcile_sellertray_installment_entitlements_for_tenant(uuid)','EXECUTE'
  ),
  'tenant-wide C1B reconciliation remains service-authority only'
);

create temp table c1b_reconcile_result as
select public.reconcile_sellertray_installment_entitlements_for_tenant(tenant_id) as result
from c1b_reconcile_fixture;

select extensions.is(
  (select jsonb_array_length(result)::integer from c1b_reconcile_result),
  2,
  'tenant-wide reconciliation reports every installment obligation even when one fails'
);

select extensions.ok(
  exists (
    select 1
    from c1b_reconcile_result r,
         lateral jsonb_array_elements(r.result) item
    join c1b_reconcile_fixture f on true
    where item->>'installmentObligationId'=f.broken_obligation_id::text
      and item->>'ok'='false'
      and item->>'errorCode'='23505'
  ),
  'a conflicting runtime obligation is isolated as a structured reconciliation failure'
);

select extensions.ok(
  exists (
    select 1
    from c1b_reconcile_result r,
         lateral jsonb_array_elements(r.result) item
    join c1b_reconcile_fixture f on true
    where item->>'installmentObligationId'=f.valid_obligation_id::text
      and item->>'ok'='true'
      and item#>>'{billingState,entitlementState}'='pending_setup'
  ),
  'a later valid obligation still reconciles after another obligation fails and reuses the Business-level Master Agreement acceptance'
);

select * from extensions.finish();
rollback;
