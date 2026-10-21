begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

create temp table c1b_reconcile_fixture (
  admin_user_id uuid not null,
  tenant_id uuid not null,
  monthly_price_id uuid,
  yearly_price_id uuid,
  broken_order_id uuid,
  broken_obligation_id uuid,
  valid_order_id uuid,
  valid_obligation_id uuid
) on commit drop;

insert into c1b_reconcile_fixture(admin_user_id,tenant_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'c1b-reconcile-'||substr(admin_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from c1b_reconcile_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from c1b_reconcile_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C1B Reconciliation Recovery Tenant',
       'c1b-reconcile-'||substr(tenant_id::text,1,8),
       'C1R-'||upper(substr(tenant_id::text,1,6)),'trial'
from c1b_reconcile_fixture;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',80,now()-interval '1 day',
         'C1B reconciliation monthly anchor',admin_user_id,admin_user_id,now()
  from c1b_reconcile_fixture
  returning id
)
update c1b_reconcile_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',800,now()-interval '1 day',
         'C1B reconciliation annual price',admin_user_id,admin_user_id,now()
  from c1b_reconcile_fixture
  returning id
)
update c1b_reconcile_fixture set yearly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,'C1B-REC-BROKEN-'||upper(substr(tenant_id::text,1,6)),
         'NGN',800,now(),admin_user_id
  from c1b_reconcile_fixture
  returning id
)
update c1b_reconcile_fixture set broken_order_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,broken_order_id,'two_installment_70_30','NGN',800,admin_user_id
  from c1b_reconcile_fixture
  returning id
)
update c1b_reconcile_fixture set broken_obligation_id=(select id from inserted);

insert into public.sellertray_commercial_installment_schedule(
  tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
)
select tenant_id,broken_obligation_id,1,70,560 from c1b_reconcile_fixture
union all
select tenant_id,broken_obligation_id,2,30,240 from c1b_reconcile_fixture;

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,'C1B-REC-VALID-'||upper(substr(tenant_id::text,1,6)),
         'NGN',800,now()+interval '1 second',admin_user_id
  from c1b_reconcile_fixture
  returning id
)
update c1b_reconcile_fixture set valid_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select tenant_id,valid_order_id,1,'subscription',yearly_price_id,'Annual SellerTray subscription'
from c1b_reconcile_fixture;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,valid_order_id,'two_installment_70_30','NGN',800,admin_user_id
  from c1b_reconcile_fixture
  returning id
)
update c1b_reconcile_fixture set valid_obligation_id=(select id from inserted);

insert into public.sellertray_commercial_installment_schedule(
  tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
)
select tenant_id,valid_obligation_id,1,70,560 from c1b_reconcile_fixture
union all
select tenant_id,valid_obligation_id,2,30,240 from c1b_reconcile_fixture;

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
      and nullif(item->>'errorCode','') is not null
  ),
  'a conflicting/broken obligation is isolated as a structured reconciliation failure'
);

select extensions.ok(
  exists (
    select 1
    from c1b_reconcile_result r,
         lateral jsonb_array_elements(r.result) item
    join c1b_reconcile_fixture f on true
    where item->>'installmentObligationId'=f.valid_obligation_id::text
      and item->>'ok'='true'
      and item#>>'{billingState,entitlementState}'='pending_agreement'
  ),
  'a later valid obligation still reconciles after another obligation fails'
);

select * from extensions.finish();
rollback;
