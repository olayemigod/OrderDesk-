begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

create temp table c1b_runtime_fixture(
  expired_tenant_id uuid not null,
  legacy_tenant_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null
) on commit drop;

insert into c1b_runtime_fixture(expired_tenant_id,legacy_tenant_id,period_start,period_end)
values(gen_random_uuid(),gen_random_uuid(),now()-interval '3 months',now()-interval '1 day');

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select expired_tenant_id,'C1B Expired Tenant','c1b-expired-'||substr(expired_tenant_id::text,1,8),'C1BE-'||upper(substr(expired_tenant_id::text,1,6)),'active'
from c1b_runtime_fixture
union all
select legacy_tenant_id,'C1B Legacy Active Tenant','c1b-legacy-'||substr(legacy_tenant_id::text,1,8),'C1BL-'||upper(substr(legacy_tenant_id::text,1,6)),'active'
from c1b_runtime_fixture;

update public.tenant_subscriptions s
set plan_code='business',
    status='active',
    current_period_start=f.period_start,
    current_period_end=f.period_end,
    trial_ends_at=null,
    grace_ends_at=null,
    updated_at=now()
from c1b_runtime_fixture f
where s.tenant_id in (f.expired_tenant_id,f.legacy_tenant_id);

insert into public.sellertray_commercial_entitlement_events(
  tenant_id,plan_code,event_type,idempotency_key,effective_from,effective_until,payload,reason
)
select expired_tenant_id,'business','installment.provisional_activated',
       'c1b-runtime-expiry-test:'||expired_tenant_id::text,
       period_start,period_end,
       jsonb_build_object('test','runtime_expiry'),
       'C1B runtime expiry contract test'
from c1b_runtime_fixture;

select set_config('request.jwt.claim.role','service_role',true);

select extensions.is(
  public.sellertray_c1b_runtime_period_state((select expired_tenant_id from c1b_runtime_fixture)),
  'provisional_expired'::text,
  'expired C1B provisional event is recognized as an expired commercial entitlement period'
);

select extensions.ok(
  not public.orderdesk_subscription_can_write((select expired_tenant_id from c1b_runtime_fixture)),
  'expired C1B entitlement becomes read-only even when the compatibility row still says active'
);

select extensions.ok(
  public.get_orderdesk_subscription_access((select expired_tenant_id from c1b_runtime_fixture))->>'effectiveStatus'='past_due'
  and public.get_orderdesk_subscription_access((select expired_tenant_id from c1b_runtime_fixture))->>'accessMode'='read_only',
  'expired C1B entitlement is exposed as past-due read-only access'
);

select extensions.ok(
  public.sellertray_c1b_runtime_period_state((select legacy_tenant_id from c1b_runtime_fixture))='legacy'
  and public.orderdesk_subscription_can_write((select legacy_tenant_id from c1b_runtime_fixture)),
  'unrelated legacy active subscription keeps pre-C1B runtime semantics'
);

select * from extensions.finish();
rollback;
