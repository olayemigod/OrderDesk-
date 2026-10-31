begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(18);

create temp table oa5_billing_runtime_fixture (
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  tenant_id uuid not null,
  branch_id uuid,
  agreement_version_id uuid,
  acceptance_command_id uuid not null,
  purchase_command_id uuid not null,
  purchase jsonb
) on commit drop;

insert into oa5_billing_runtime_fixture(
  admin_user_id,owner_user_id,manager_user_id,tenant_id,
  acceptance_command_id,purchase_command_id
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'oa5-billing-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from oa5_billing_runtime_fixture
union all
select owner_user_id,'oa5-billing-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from oa5_billing_runtime_fixture
union all
select manager_user_id,'oa5-billing-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from oa5_billing_runtime_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from oa5_billing_runtime_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,
       'OA5 Billing Runtime Authority Business',
       'oa5-billing-runtime-'||substr(tenant_id::text,1,8),
       'O5B',
       'trial'
from oa5_billing_runtime_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from oa5_billing_runtime_fixture
union all
select tenant_id,manager_user_id,'manager' from oa5_billing_runtime_fixture;

update oa5_billing_runtime_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

select public.publish_sellertray_subscription_price_pair_admin(
  'business','NGN',1000,7.5,now()-interval '1 minute',
  'OA5 Billing runtime authority subscription price',admin_user_id
)
from oa5_billing_runtime_fixture;

select public.publish_sellertray_branch_setup_price_admin(
  'NGN',2500,7.5,now()-interval '1 minute',
  'OA5 Billing runtime authority Branch setup price',admin_user_id
)
from oa5_billing_runtime_fixture;

update oa5_billing_runtime_fixture f
set agreement_version_id=public.publish_sellertray_master_agreement_admin(
  'oa5-billing-runtime-'||substr(f.admin_user_id::text,1,8),
  'SellerTray Master Agreement',
  'OA5 Billing runtime authority regression agreement.',
  now()-interval '30 seconds',
  'Publish OA5 Billing runtime authority regression agreement',
  f.admin_user_id
);

select public.accept_sellertray_master_agreement(
  f.tenant_id,
  f.agreement_version_id,
  'OA5 Billing Owner',
  jsonb_build_object('channel','merchant_web','authority_confirmed',true),
  f.acceptance_command_id,
  f.owner_user_id
)
from oa5_billing_runtime_fixture f;

-- First reproduce the live legacy outlier shape that motivated the status audit:
-- a manual active flag with no governed order, period or entitlement evidence.
update public.tenant_subscriptions s
set status='active',
    current_period_start=null,
    current_period_end=null,
    grace_ends_at=null,
    updated_at=now()
from oa5_billing_runtime_fixture f
where s.tenant_id=f.tenant_id;

select extensions.ok(
  (select s.status='active'
          and s.current_period_start is null
          and s.current_period_end is null
          and not exists(
            select 1 from public.sellertray_commercial_entitlement_events e
            where e.tenant_id=s.tenant_id
          )
          and not exists(
            select 1 from public.sellertray_commercial_orders o
            where o.tenant_id=s.tenant_id
          )
   from public.tenant_subscriptions s
   join oa5_billing_runtime_fixture f on f.tenant_id=s.tenant_id),
  'fixture reproduces legacy active status without governed purchase or entitlement truth'
);

select extensions.ok(
  (select public.get_sellertray_onboarding_state_core(f.tenant_id) #>> '{nextAction,code}'='select_plan'
          and public.get_sellertray_onboarding_state_core(f.tenant_id) #>> '{nextAction,surface}'='merchant_web'
   from oa5_billing_runtime_fixture f),
  'onboarding projection alone can still say select_plan for the stale active compatibility shape'
);

select extensions.ok(
  (select not public.sellertray_business_is_preparing(f.tenant_id)
   from oa5_billing_runtime_fixture f),
  'semantic preparation authority rejects the stale active compatibility shape'
);

select extensions.ok(
  (select not (public.get_sellertray_commercial_billing_center(f.tenant_id,f.owner_user_id)->>'canPurchaseInitial')::boolean
   from oa5_billing_runtime_fixture f),
  'Billing does not broaden first-purchase authority merely because onboarding projects select_plan'
);

-- Restore the actual pre-C2 preparation compatibility state. No free-trial
-- product behavior is inferred from this storage value; the semantic helper owns
-- the meaning consumed by Billing.
update public.tenant_subscriptions s
set status='trial',
    current_period_start=null,
    current_period_end=null,
    grace_ends_at=null,
    updated_at=now()
from oa5_billing_runtime_fixture f
where s.tenant_id=f.tenant_id;

select extensions.ok(
  (select public.sellertray_business_is_preparing(f.tenant_id)
   from oa5_billing_runtime_fixture f),
  'semantic preparation authority accepts the proven pre-C2 first-purchase state'
);

select extensions.ok(
  (select (public.get_sellertray_commercial_billing_center(f.tenant_id,f.owner_user_id)->>'canPurchaseInitial')::boolean
   from oa5_billing_runtime_fixture f),
  'Billing Owner eligibility consumes semantic preparation authority'
);

select extensions.ok(
  (select not (public.get_sellertray_commercial_billing_center(f.tenant_id,f.manager_user_id)->>'canPurchaseInitial')::boolean
   from oa5_billing_runtime_fixture f),
  'Billing Manager remains unable to create the initial purchase'
);

select extensions.ok(
  (select public.get_sellertray_commercial_billing_center(f.tenant_id,f.owner_user_id)->>'initialPurchaseActionCode'='select_plan'
          and public.get_sellertray_commercial_billing_center(f.tenant_id,f.owner_user_id)->>'initialPurchaseActionSurface'='merchant_web'
   from oa5_billing_runtime_fixture f),
  'Billing response contract continues to expose canonical initial-purchase action metadata'
);

update oa5_billing_runtime_fixture f
set purchase=public.create_sellertray_initial_installment_purchase_merchant(
  f.tenant_id,
  'business',
  'NGN',
  array[f.branch_id],
  'two_installment_70_30',
  f.purchase_command_id,
  f.owner_user_id
);

select extensions.ok(
  (select purchase->>'commercialOrderId' is not null
          and purchase->>'idempotentReplay'='false'
   from oa5_billing_runtime_fixture),
  'Merchant first-purchase command accepts the same semantic preparation state advertised by Billing'
);

select extensions.ok(
  (select (
    public.create_sellertray_initial_installment_purchase_merchant(
      f.tenant_id,'business','NGN',array[f.branch_id],
      'two_installment_70_30',f.purchase_command_id,f.owner_user_id
    )->>'commercialOrderId'
  )=(f.purchase->>'commercialOrderId')
  from oa5_billing_runtime_fixture f),
  'exact Merchant purchase command replay remains idempotent after onboarding advances'
);

select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_orders o
   join oa5_billing_runtime_fixture f on f.tenant_id=o.tenant_id),
  1,
  'canonical eligibility convergence never duplicates the initial commercial order'
);

select extensions.ok(
  (select not (public.get_sellertray_commercial_billing_center(f.tenant_id,f.owner_user_id)->>'canPurchaseInitial')::boolean
   from oa5_billing_runtime_fixture f),
  'Billing closes initial-purchase eligibility after the governed order exists'
);

select extensions.ok(
  strpos(
    lower(pg_get_functiondef('public.get_sellertray_commercial_billing_center(uuid,uuid)'::regprocedure)),
    'sellertray_business_is_preparing(p_tenant_id)'
  )>0
  and strpos(
    replace(lower(pg_get_functiondef('public.get_sellertray_commercial_billing_center(uuid,uuid)'::regprocedure)),' ',''),
    's.status=''trial'''
  )=0,
  'Billing Center uses semantic preparation authority instead of a raw trial predicate'
);

select extensions.ok(
  strpos(
    replace(lower(pg_get_functiondef('public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure)),' ',''),
    's.status=''trial'''
  )>0
  and strpos(
    lower(pg_get_functiondef('public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure)),
    'pre-c2 runtime compatibility state'
  )>0
  and strpos(
    lower(pg_get_functiondef('public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure)),
    'get_sellertray_onboarding_state_core'
  )=0,
  'shared first-purchase core remains unchanged as the pre-C2 write compatibility guard'
);

select extensions.ok(
  (select p.prosecdef
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.oid='public.get_sellertray_commercial_billing_center(uuid,uuid)'::regprocedure)
  and not (select p.prosecdef
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.oid='public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure),
  'Billing SECURITY DEFINER and shared-core invoker boundaries remain unchanged'
);

select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_commercial_billing_center(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_sellertray_commercial_billing_center(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_commercial_billing_center(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid)','EXECUTE'),
  'Billing and shared first-purchase grants remain service-role only'
);

select extensions.ok(
  to_regprocedure('public.sellertray_business_is_preparing(uuid)') is not null
  and to_regprocedure('public.get_sellertray_commercial_billing_center(uuid,uuid)') is not null
  and to_regprocedure('public.create_sellertray_initial_installment_purchase_core(uuid,text,text,uuid[],text,text,text,uuid)') is not null
  and to_regprocedure('public.create_sellertray_initial_installment_purchase_merchant(uuid,text,text,uuid[],text,uuid,uuid)') is not null,
  'semantic preparation, Billing and first-purchase function signatures remain intact'
);

select extensions.ok(
  (select count(*)=1
   from public.tenant_subscriptions s
   join oa5_billing_runtime_fixture f on f.tenant_id=s.tenant_id),
  'regression leaves one compatibility subscription row and creates no competing subscription truth'
);

select * from extensions.finish();
rollback;
