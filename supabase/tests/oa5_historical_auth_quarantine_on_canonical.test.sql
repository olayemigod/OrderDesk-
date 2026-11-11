begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

-- Both identities are disposable, randomly generated and use example.com only.
-- The "archived" actor simulates an old managed Auth identity *without* a
-- canonical tenant membership. No archived customer/session data is copied.
create temp table oa5_quarantine_fixture(
  tenant_id uuid not null default gen_random_uuid(),
  owner_id uuid not null default gen_random_uuid(),
  old_auth_id uuid not null default gen_random_uuid(),
  branch_id uuid,
  customer_id uuid not null default gen_random_uuid(),
  order_id uuid not null default gen_random_uuid()
) on commit drop;
insert into oa5_quarantine_fixture default values;

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'oa5-quarantine-owner-'||left(owner_id::text,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from oa5_quarantine_fixture
union all
select old_auth_id,'oa5-quarantine-archived-'||left(old_auth_id::text,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from oa5_quarantine_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'OA5 synthetic quarantine merchant',
       'oa5-quarantine-'||left(tenant_id::text,8),'O5Q','active'
from oa5_quarantine_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner'
from oa5_quarantine_fixture;

update oa5_quarantine_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update public.tenant_subscriptions s
set status='active',trial_ends_at=null,grace_ends_at=null
from oa5_quarantine_fixture f where s.tenant_id=f.tenant_id;

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,
       '2348000000981','OA5 Synthetic Customer','2348000000981'
from oa5_quarantine_fixture;

insert into public.orders(id,tenant_id,branch_id,customer_id,status,source,
                          customer_note,parser_source,review_reasons,currency,total_amount)
select order_id,tenant_id,branch_id,customer_id,
       'needs_review','manual','OA5 synthetic quarantine sale',
       'manual','{}'::text[],'NGN',1200
from oa5_quarantine_fixture;

-- Copy only ephemeral UUIDs into session-local settings: authenticated cannot
-- read the postgres-owned setup temp table, and postgres would bypass RLS.
select set_config('oa5.test_tenant',(select tenant_id::text from oa5_quarantine_fixture),true);
select set_config('oa5.test_branch',(select branch_id::text from oa5_quarantine_fixture),true);
select set_config('oa5.test_customer',(select customer_id::text from oa5_quarantine_fixture),true);
select set_config('oa5.test_order',(select order_id::text from oa5_quarantine_fixture),true);
select set_config('oa5.test_owner',(select owner_id::text from oa5_quarantine_fixture),true);
select set_config('oa5.test_old_auth',(select old_auth_id::text from oa5_quarantine_fixture),true);

select set_config('request.jwt.claim.sub',current_setting('oa5.test_owner'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

-- Positive controls prevent a vacuous "everyone sees zero" pass.
select extensions.is((select count(*)::integer from public.tenants
  where id=current_setting('oa5.test_tenant')::uuid),1,
  'authorized synthetic owner can see merchant');
select extensions.is((select count(*)::integer from public.branches
  where id=current_setting('oa5.test_branch')::uuid),1,
  'authorized owner can see own branch');
select extensions.is((select count(*)::integer from public.customers
  where id=current_setting('oa5.test_customer')::uuid),1,
  'authorized owner can see own customer');
select extensions.is((select count(*)::integer from public.orders
  where id=current_setting('oa5.test_order')::uuid),1,
  'authorized owner can see own order');

-- An old Test Auth identity may still exist after a user-schema reset.
-- It must not inherit a synthetic merchant or Branch merely by authenticating.
select set_config('request.jwt.claim.sub',current_setting('oa5.test_old_auth'),true);
select extensions.ok(auth.uid()=current_setting('oa5.test_old_auth')::uuid,
  'archived actor is authenticated under the intended old identity');
select extensions.is((select count(*)::integer from public.tenants
  where id=current_setting('oa5.test_tenant')::uuid),0,
  'orphan historic identity cannot read synthetic merchant');
select extensions.is((select count(*)::integer from public.branches
  where id=current_setting('oa5.test_branch')::uuid),0,
  'orphan historic identity cannot read branch');
select extensions.is((select count(*)::integer from public.customers
  where id=current_setting('oa5.test_customer')::uuid),0,
  'orphan historic identity cannot read customer');
select extensions.is((select count(*)::integer from public.orders
  where id=current_setting('oa5.test_order')::uuid),0,
  'orphan historic identity cannot read order');
select extensions.is((select count(*)::integer from public.tenant_members
  where tenant_id=current_setting('oa5.test_tenant')::uuid),0,
  'orphan historic identity cannot read canonical merchant membership');
select extensions.ok(not public.sellertray_current_user_can_read_branch(
     current_setting('oa5.test_tenant')::uuid,current_setting('oa5.test_branch')::uuid),
  'orphan historic identity has no historical Branch read');
select extensions.ok(not public.sellertray_current_user_can_access_branch(
     current_setting('oa5.test_tenant')::uuid,current_setting('oa5.test_branch')::uuid),
  'orphan historic identity has no active Branch operation access');

-- Restore original JWT identity (same connection, same role) to establish that
-- the observed denial was identity-scoped, not an accidental global lockout.
select set_config('request.jwt.claim.sub',current_setting('oa5.test_owner'),true);
select extensions.ok(auth.uid()=current_setting('oa5.test_owner')::uuid,
  'owner JWT restoration takes effect without changing SQL role');
select extensions.is((select count(*)::integer from public.orders
  where id=current_setting('oa5.test_order')::uuid),1,
  'owner regains allowed synthetic order read after orphan identity check');

reset role;
select * from extensions.finish();
rollback;
