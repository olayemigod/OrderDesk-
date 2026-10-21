begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

create temp table c1b_acceptance_fixture (
  admin_user_id uuid not null,
  support_user_id uuid not null,
  tenant_id uuid not null,
  branch_id uuid,
  purchase jsonb,
  support_mutation_rejected boolean not null default false
) on commit drop;

insert into c1b_acceptance_fixture(admin_user_id,support_user_id,tenant_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'c1b-acceptance-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c1b_acceptance_fixture
union all
select support_user_id,'c1b-acceptance-support-'||substr(support_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from c1b_acceptance_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from c1b_acceptance_fixture
union all
select support_user_id,'support' from c1b_acceptance_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C1B Acceptance Business','c1b-acceptance-'||substr(tenant_id::text,1,8),'C1A','trial'
from c1b_acceptance_fixture;

update c1b_acceptance_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

select extensions.ok(
  to_regprocedure('public.get_sellertray_commercial_onboarding_admin(uuid,uuid)') is not null
  and to_regprocedure('public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid)') is not null
  and to_regprocedure('public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid)') is not null
  and to_regprocedure('public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)') is not null,
  'C1B first-merchant acceptance authority is installed'
);

select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_commercial_onboarding_admin(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_sellertray_commercial_onboarding_admin(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)','EXECUTE'),
  'acceptance bridge remains service-authority only'
);

select public.publish_sellertray_subscription_price_pair_admin(
  'business','NGN',1000,7.5,now()-interval '1 minute',
  'First merchant acceptance governed subscription price',admin_user_id
)
from c1b_acceptance_fixture;

select extensions.ok(
  exists (
    select 1
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription' and p.plan_code='business' and p.billing_cycle='monthly'
      and p.currency='NGN' and p.gross_amount=1000 and p.tax_rate_percent=7.5
  )
  and exists (
    select 1
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription' and p.plan_code='business' and p.billing_cycle='yearly'
      and p.currency='NGN' and p.gross_amount=10000 and p.tax_rate_percent=7.5
  ),
  'subscription publication derives the governed annual 10-for-12 price from monthly price'
);

select public.publish_sellertray_branch_setup_price_admin(
  'NGN',2500,7.5,now()-interval '1 minute',
  'First merchant acceptance governed Branch setup price',admin_user_id
)
from c1b_acceptance_fixture;

select extensions.ok(
  exists (
    select 1 from public.sellertray_commercial_price_versions p
    where p.price_kind='branch_setup' and p.currency='NGN' and p.gross_amount=2500
      and p.plan_code is null and p.billing_cycle is null
  ),
  'Branch setup remains a separate governed price authority'
);

do $$
begin
  begin
    perform public.publish_sellertray_branch_setup_price_admin(
      'NGN',2600,null,now(),'Support may not publish pricing',f.support_user_id
    ) from c1b_acceptance_fixture f;
  exception when insufficient_privilege then
    update c1b_acceptance_fixture set support_mutation_rejected=true;
  end;
end
$$;
select extensions.ok(
  (select support_mutation_rejected from c1b_acceptance_fixture),
  'Support is review-only for first-merchant commercial creation'
);

update c1b_acceptance_fixture f
set purchase=public.create_sellertray_initial_installment_purchase_admin(
  f.tenant_id,'business','NGN',array[f.branch_id],
  'two_installment_70_30','C1B-FIRST-'||upper(substr(f.tenant_id::text,1,8)),
  'Controlled first merchant annual installment acceptance order',f.admin_user_id
);

set constraints all immediate;
set constraints all deferred;

select extensions.ok(
  (purchase->>'totalGrossAmount')::numeric=12500
  and purchase->>'currency'='NGN'
  and purchase->>'idempotentReplay'='false'
  from c1b_acceptance_fixture,
  'initial purchase total is annual subscription plus setup for every selected Branch'
);

select extensions.ok(
  exists (
    select 1
    from c1b_acceptance_fixture f
    join public.sellertray_commercial_order_price_snapshots s
      on s.commercial_order_id=(f.purchase->>'commercialOrderId')::uuid
    where s.line_type='subscription' and s.billing_cycle='yearly'
      and s.plan_code='business' and s.gross_amount=10000
  )
  and exists (
    select 1
    from c1b_acceptance_fixture f
    join public.sellertray_commercial_order_price_snapshots s
      on s.commercial_order_id=(f.purchase->>'commercialOrderId')::uuid
    where s.line_type='branch_setup' and s.branch_id=f.branch_id and s.gross_amount=2500
  ),
  'initial purchase snapshots governed annual subscription and selected Branch setup price'
);

select extensions.ok(
  exists (
    select 1
    from c1b_acceptance_fixture f
    join public.sellertray_commercial_installment_schedule s
      on s.installment_obligation_id=(f.purchase->>'installmentObligationId')::uuid
    group by s.installment_obligation_id
    having count(*)=2
      and sum(s.amount_due)=12500
      and bool_and(s.due_at is null)
      and max(s.amount_due) filter (where s.sequence_no=1)=8750
      and max(s.amount_due) filter (where s.sequence_no=2)=3750
  ),
  '70/30 installment schedule is exact and introduces no unapproved due dates'
);

select extensions.ok(
  (select (public.create_sellertray_initial_installment_purchase_admin(
    f.tenant_id,'business','NGN',array[f.branch_id],
    'two_installment_70_30','C1B-FIRST-'||upper(substr(f.tenant_id::text,1,8)),
    'Controlled first merchant annual installment acceptance order',f.admin_user_id
  )->>'commercialOrderId')=(f.purchase->>'commercialOrderId')
  from c1b_acceptance_fixture f)
  and (select count(*)=1
       from c1b_acceptance_fixture f
       join public.sellertray_commercial_orders o on o.tenant_id=f.tenant_id),
  'same initial-purchase command identity replays without duplicating the commercial order'
);

select extensions.ok(
  exists (
    select 1
    from c1b_acceptance_fixture f
    cross join lateral jsonb_array_elements(
      public.get_sellertray_commercial_onboarding_admin(f.admin_user_id,f.tenant_id)->'orders'
    ) o
    where o->>'id'=f.purchase->>'commercialOrderId'
  )
  and (select public.get_sellertray_commercial_onboarding_admin(f.support_user_id,f.tenant_id)->>'canManage'='false'
       from c1b_acceptance_fixture f),
  'Admin/Support onboarding projection exposes governed facts while preserving review-only support'
);

select extensions.ok(
  (select count(*)>=3
   from public.platform_admin_audit a
   join c1b_acceptance_fixture f on a.actor_user_id=f.admin_user_id
   where a.action in (
     'sellertray_publish_subscription_price_pair',
     'sellertray_publish_branch_setup_price',
     'sellertray_create_initial_installment_purchase'
   )),
  'privileged first-merchant creation writes the existing Platform Admin audit trail'
);

select extensions.ok(
  not exists (
    select 1
    from public.sellertray_commercial_entitlement_events e
    join c1b_acceptance_fixture f on e.tenant_id=f.tenant_id
  ),
  'commercial order creation does not create entitlement before agreement/payment authority'
);

select extensions.ok(
  exists (
    select 1
    from c1b_acceptance_fixture f
    join public.tenant_subscriptions s on s.tenant_id=f.tenant_id
    where s.status='trial'
  ),
  'C1B acceptance bridge preserves tenant_subscriptions as pre-C2 runtime compatibility authority'
);

select * from extensions.finish();
rollback;
