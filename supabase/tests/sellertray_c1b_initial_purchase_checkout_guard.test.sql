begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

create temp table c1b_initial_purchase_fixture (
  admin_user_id uuid not null,
  initial_owner_id uuid not null,
  legacy_owner_id uuid not null,
  initial_tenant_id uuid not null,
  legacy_tenant_id uuid not null,
  monthly_price_id uuid,
  yearly_price_id uuid,
  initial_order_id uuid,
  initial_obligation_id uuid,
  initial_schedule_1_id uuid,
  initial_schedule_2_id uuid,
  later_order_id uuid,
  later_obligation_id uuid,
  later_schedule_1_id uuid,
  later_schedule_2_id uuid,
  legacy_order_id uuid,
  legacy_obligation_id uuid,
  legacy_schedule_1_id uuid,
  legacy_schedule_2_id uuid,
  later_order_rejected boolean not null default false,
  legacy_active_rejected boolean not null default false
) on commit drop;

insert into c1b_initial_purchase_fixture(
  admin_user_id,initial_owner_id,legacy_owner_id,initial_tenant_id,legacy_tenant_id
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'c1b-initial-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c1b_initial_purchase_fixture
union all
select initial_owner_id,'c1b-initial-owner-'||substr(initial_owner_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c1b_initial_purchase_fixture
union all
select legacy_owner_id,'c1b-legacy-owner-'||substr(legacy_owner_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c1b_initial_purchase_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from c1b_initial_purchase_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select initial_tenant_id,'C1B Initial Purchase Tenant',
       'c1b-initial-'||substr(initial_tenant_id::text,1,8),
       'C1I','trial'
from c1b_initial_purchase_fixture
union all
select legacy_tenant_id,'C1B Legacy Active Purchase Tenant',
       'c1b-legacy-purchase-'||substr(legacy_tenant_id::text,1,8),
       'C1L','active'
from c1b_initial_purchase_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select initial_tenant_id,initial_owner_id,'owner' from c1b_initial_purchase_fixture
union all
select legacy_tenant_id,legacy_owner_id,'owner' from c1b_initial_purchase_fixture;

-- Keep the legacy Business explicitly active without a governed C1B period.
update public.tenant_subscriptions s
set plan_code='business',status='active',current_period_start=null,current_period_end=null,
    trial_ends_at=null,grace_ends_at=null,updated_at=now()
from c1b_initial_purchase_fixture f
where s.tenant_id=f.legacy_tenant_id;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',80,now()-interval '1 day',
         'C1B initial-purchase monthly anchor',admin_user_id,admin_user_id,now()
  from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',800,now()-interval '1 day',
         'C1B initial-purchase annual price',admin_user_id,admin_user_id,now()
  from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set yearly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select initial_tenant_id,'C1B-INITIAL-'||upper(substr(initial_tenant_id::text,1,6)),
         'NGN',800,now(),admin_user_id
  from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set initial_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select initial_tenant_id,initial_order_id,1,'subscription',yearly_price_id,'Initial annual SellerTray subscription'
from c1b_initial_purchase_fixture;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select initial_tenant_id,initial_order_id,'two_installment_70_30','NGN',800,admin_user_id
  from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set initial_obligation_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select initial_tenant_id,initial_obligation_id,1,70,560 from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set initial_schedule_1_id=(select id from inserted);
with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select initial_tenant_id,initial_obligation_id,2,30,240 from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set initial_schedule_2_id=(select id from inserted);

-- A later annual order for the same Business is a renewal/later purchase and is
-- therefore not eligible for the initial-purchase installment facility.
with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select initial_tenant_id,'C1B-LATER-'||upper(substr(initial_tenant_id::text,1,6)),
         'NGN',800,now()+interval '1 second',admin_user_id
  from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set later_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select initial_tenant_id,later_order_id,1,'subscription',yearly_price_id,'Later annual SellerTray subscription'
from c1b_initial_purchase_fixture;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select initial_tenant_id,later_order_id,'two_installment_70_30','NGN',800,admin_user_id
  from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set later_obligation_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select initial_tenant_id,later_obligation_id,1,70,560 from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set later_schedule_1_id=(select id from inserted);
with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select initial_tenant_id,later_obligation_id,2,30,240 from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set later_schedule_2_id=(select id from inserted);

-- A legacy-active Business with no same-order C1B entitlement evidence is also
-- not an initial SellerTray purchase merely because a new annual order exists.
with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select legacy_tenant_id,'C1B-LEGACY-'||upper(substr(legacy_tenant_id::text,1,6)),
         'NGN',800,now(),admin_user_id
  from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set legacy_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select legacy_tenant_id,legacy_order_id,1,'subscription',yearly_price_id,'Legacy active annual SellerTray subscription'
from c1b_initial_purchase_fixture;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select legacy_tenant_id,legacy_order_id,'two_installment_70_30','NGN',800,admin_user_id
  from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set legacy_obligation_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select legacy_tenant_id,legacy_obligation_id,1,70,560 from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set legacy_schedule_1_id=(select id from inserted);
with inserted as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select legacy_tenant_id,legacy_obligation_id,2,30,240 from c1b_initial_purchase_fixture
  returning id
)
update c1b_initial_purchase_fixture set legacy_schedule_2_id=(select id from inserted);

set constraints all immediate;

select extensions.ok(
  to_regprocedure('public.guard_sellertray_initial_purchase_installment_checkout()') is not null
  and exists (
    select 1 from pg_trigger
    where tgrelid='public.billing_checkout_sessions'::regclass
      and tgname='guard_sellertray_initial_purchase_installment_checkout'
      and not tgisinternal
  ),
  'C1B initial-purchase installment guard is installed on shared checkout persistence'
);

select extensions.ok(
  (public.reserve_sellertray_installment_checkout(
    f.initial_tenant_id,f.initial_schedule_1_id,gen_random_uuid(),f.initial_owner_id,
    'initial-owner@example.com'
  )->>'status')='preparing'
  from c1b_initial_purchase_fixture f,
  'trial Business may reserve the first installment of its initial annual commercial order'
);

do $$
begin
  begin
    perform public.reserve_sellertray_installment_checkout(
      f.initial_tenant_id,f.later_schedule_1_id,gen_random_uuid(),f.initial_owner_id,
      'initial-owner@example.com'
    ) from c1b_initial_purchase_fixture f;
  exception when sqlstate '23514' then
    update c1b_initial_purchase_fixture set later_order_rejected=true;
  end;
end
$$;
select extensions.ok(
  (select later_order_rejected from c1b_initial_purchase_fixture),
  'later annual commercial order cannot use initial-purchase installment billing'
);

do $$
begin
  begin
    perform public.reserve_sellertray_installment_checkout(
      f.legacy_tenant_id,f.legacy_schedule_1_id,gen_random_uuid(),f.legacy_owner_id,
      'legacy-owner@example.com'
    ) from c1b_initial_purchase_fixture f;
  exception when sqlstate '23514' then
    update c1b_initial_purchase_fixture set legacy_active_rejected=true;
  end;
end
$$;
select extensions.ok(
  (select legacy_active_rejected from c1b_initial_purchase_fixture),
  'legacy active Business without same-order C1B entitlement cannot start an initial-purchase installment'
);

select extensions.ok(
  position('sellertray_commercial_entitlement_events' in pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ))>0
  and position('current commercial order' in lower(pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  )))=0
  and position('commercial_order_id' in pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ))>0,
  'C1B guard permits later installments only through same-order governed entitlement ownership rather than role/client state'
);

select * from extensions.finish();
rollback;
