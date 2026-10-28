begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamp with time zone,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('admin.pricing.manage' in body)>0
  and position('p_actor_user_id,''admin.pricing.manage'',null,now()' in body)>0,
  'standard subscription pricing requires platform-scoped admin.pricing.manage authority'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamp with time zone,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('admin.pricing.manage' in body)>0
  and position('p_actor_user_id,''admin.pricing.manage'',null,now()' in body)>0,
  'standard Branch setup pricing requires platform-scoped admin.pricing.manage authority'
)
from definition;

select extensions.ok(
  not has_function_privilege('authenticated',
    'public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamp with time zone,text,uuid)',
    'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamp with time zone,text,uuid)',
    'EXECUTE')
  and not has_function_privilege('anon',
    'public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamp with time zone,text,uuid)',
    'EXECUTE')
  and not has_function_privilege('anon',
    'public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamp with time zone,text,uuid)',
    'EXECUTE'),
  'standard pricing mutation remains unavailable to merchant and anonymous database roles'
);

select extensions.ok(
  has_function_privilege('service_role',
    'public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamp with time zone,text,uuid)',
    'EXECUTE')
  and has_function_privilege('service_role',
    'public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamp with time zone,text,uuid)',
    'EXECUTE'),
  'standard pricing mutation remains available through the privileged server boundary'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.get_sellertray_commercial_onboarding_admin(uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('''canmanage'',v_role=''admin''' in body)>0,
  'commercial-order management retains its existing Platform Admin role boundary'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.get_sellertray_commercial_onboarding_admin(uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('''canmanageglobalpricing'',public.platform_admin_has_capability(p_actor_user_id,''admin.pricing.manage'',null,now())' in body)>0,
  'Admin onboarding exposes platform-wide pricing authority separately'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.get_sellertray_commercial_onboarding_admin(uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('''canmanagemerchantpricing'',public.platform_admin_has_capability(p_actor_user_id,''admin.pricing.manage'',p_tenant_id,now())' in body)>0,
  'Admin onboarding exposes selected-Business pricing authority separately'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.create_sellertray_initial_installment_purchase_admin_impl(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_role<>''admin''' in body)>0
  and position('admin.pricing.manage' in body)=0,
  'initial purchase authority was not silently replaced by pricing authority'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.get_sellertray_commercial_onboarding_admin(uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('public.get_sellertray_commercial_onboarding_admin_impl(p_actor_user_id,p_tenant_id)' in body)>0,
  'authority separation decorates the canonical onboarding read model rather than creating a second commercial truth'
)
from definition;

select * from extensions.finish();
rollback;
