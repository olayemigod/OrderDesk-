begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

-- The canonical clean-schema replay intentionally includes additive C2
-- foundations. OA5 must still operate on the legacy Business subscription
-- runtime until a separately approved C2-10 cutover.
select extensions.ok(
  to_regclass('public.tenant_subscriptions') is not null,
  'pre-C2 Business-level subscription compatibility table remains installed'
);
select extensions.ok(
  to_regclass('public.sellertray_branch_subscriptions') is not null,
  'additive C2 Branch Subscription foundation can coexist on the clean schema'
);
select extensions.is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema='public'
     and table_name='tenant_subscriptions'
     and column_name='branch_id'),
  0,
  'legacy Business subscription runtime did not silently become Branch-owned'
);
select extensions.ok(
  to_regprocedure('public.sellertray_business_is_preparing(uuid)') is not null,
  'semantic pre-C2 business preparation authority still exists'
);
select extensions.ok(
  to_regprocedure('public.orderdesk_subscription_can_write(uuid)') is not null,
  'legacy governed selling write gate still exists'
);

create temp table oa5_pre_c2_coexistence_fixture(
  tenant_id uuid not null default gen_random_uuid(),
  owner_user_id uuid not null default gen_random_uuid()
) on commit drop;
insert into oa5_pre_c2_coexistence_fixture default values;

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
       'oa5-pre-c2-coexistence-'||substr(owner_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from oa5_pre_c2_coexistence_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,
       'OA5 pre-C2 canonical coexistence synthetic Business',
       'oa5-pre-c2-coexistence-'||substr(tenant_id::text,1,8),
       'P5C','trial'
from oa5_pre_c2_coexistence_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from oa5_pre_c2_coexistence_fixture;

select set_config('request.jwt.claim.sub',owner_user_id::text,true)
from oa5_pre_c2_coexistence_fixture;

select extensions.ok(
  (select count(*)=1
   from public.tenant_subscriptions s
   join oa5_pre_c2_coexistence_fixture f on f.tenant_id=s.tenant_id),
  'new Business still provisions exactly one governed legacy compatibility subscription row'
);
select extensions.ok(
  (select count(*)=1
   from public.branches b
   join oa5_pre_c2_coexistence_fixture f on f.tenant_id=b.tenant_id
   where b.is_default),
  'new Business still has one governed default Branch'
);
select extensions.ok(
  (select count(*)=0
   from public.sellertray_branch_subscriptions b
   join oa5_pre_c2_coexistence_fixture f on f.tenant_id=b.tenant_id),
  'Business/Branch provisioning does not create an unapproved C2 Branch Subscription'
);

-- Expired historical "trial" is compatibility storage, NOT a free-trial
-- entitlement. It still permits governed non-transactional setup, not sales.
update public.tenant_subscriptions s
set status='trial',trial_ends_at=now()-interval '2 days',
    current_period_start=null,current_period_end=null,grace_ends_at=null
from oa5_pre_c2_coexistence_fixture f
where s.tenant_id=f.tenant_id;

select extensions.ok(
  (select public.sellertray_business_is_preparing(f.tenant_id)
          and not public.orderdesk_subscription_can_write(f.tenant_id)
   from oa5_pre_c2_coexistence_fixture f),
  'pre-C2 preparation is allowed while selling remains blocked without governed entitlement'
);
select extensions.ok(
  (select count(*)=0
   from public.sellertray_branch_subscriptions b
   join oa5_pre_c2_coexistence_fixture f on f.tenant_id=b.tenant_id),
  'legacy preparation and access checks do not synthesize C2 subscription truth'
);

select * from extensions.finish();
rollback;
