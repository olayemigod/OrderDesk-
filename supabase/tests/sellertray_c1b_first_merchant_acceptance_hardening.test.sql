begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

create temp table c1b_acceptance_hardening_fixture (
  unauthorized_user_id uuid not null,
  support_user_id uuid not null,
  tenant_id uuid not null,
  unauthorized_read_denied boolean not null default false,
  unauthorized_subscription_price_denied boolean not null default false,
  unauthorized_setup_price_denied boolean not null default false,
  unauthorized_purchase_denied boolean not null default false,
  support_mutation_denied boolean not null default false
) on commit drop;

insert into c1b_acceptance_hardening_fixture(
  unauthorized_user_id,
  support_user_id,
  tenant_id
) values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select support_user_id,
       'c1b-hardening-support-'||substr(support_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from c1b_acceptance_hardening_fixture;

insert into public.platform_admins(user_id,role)
select support_user_id,'support'
from c1b_acceptance_hardening_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,
       'C1B Acceptance Hardening Tenant',
       'c1b-acceptance-hardening-'||substr(tenant_id::text,1,8),
       'C1H',
       'trial'
from c1b_acceptance_hardening_fixture;

-- A missing platform_admins row must fail before any service-authority read or
-- mutation can use the supplied actor identity.
do $$
declare
  f c1b_acceptance_hardening_fixture%rowtype;
begin
  select * into strict f from c1b_acceptance_hardening_fixture;

  begin
    perform public.get_sellertray_commercial_onboarding_admin(
      f.unauthorized_user_id,
      f.tenant_id
    );
  exception when insufficient_privilege then
    update c1b_acceptance_hardening_fixture set unauthorized_read_denied=true;
  end;

  begin
    perform public.publish_sellertray_subscription_price_pair_admin(
      'business','NGN',1000,0,now(),'Unauthorized subscription price test',
      f.unauthorized_user_id
    );
  exception when insufficient_privilege then
    update c1b_acceptance_hardening_fixture set unauthorized_subscription_price_denied=true;
  end;

  begin
    perform public.publish_sellertray_branch_setup_price_admin(
      'NGN',1000,0,now(),'Unauthorized setup price test',
      f.unauthorized_user_id
    );
  exception when insufficient_privilege then
    update c1b_acceptance_hardening_fixture set unauthorized_setup_price_denied=true;
  end;

  begin
    perform public.create_sellertray_initial_installment_purchase_admin(
      f.tenant_id,'business','NGN',array[gen_random_uuid()],
      'two_installment_70_30','C1B-HARDENING-UNAUTHORIZED',
      'Unauthorized purchase test',f.unauthorized_user_id
    );
  exception when insufficient_privilege then
    update c1b_acceptance_hardening_fixture set unauthorized_purchase_denied=true;
  end;

  begin
    perform public.publish_sellertray_branch_setup_price_admin(
      'NGN',1000,0,now(),'Support mutation must be denied',
      f.support_user_id
    );
  exception when insufficient_privilege then
    update c1b_acceptance_hardening_fixture set support_mutation_denied=true;
  end;
end
$$;

select extensions.ok(
  (select unauthorized_read_denied from c1b_acceptance_hardening_fixture),
  'missing Platform Admin role cannot read the first-merchant onboarding projection'
);

select extensions.ok(
  (select unauthorized_subscription_price_denied
     and unauthorized_setup_price_denied
     and unauthorized_purchase_denied
   from c1b_acceptance_hardening_fixture),
  'missing Platform Admin role cannot invoke first-merchant commercial mutations'
);

select extensions.ok(
  (select support_mutation_denied from c1b_acceptance_hardening_fixture),
  'Platform Support remains review-only for first-merchant commercial mutations'
);

select extensions.ok(
  (select (
    public.get_sellertray_commercial_onboarding_admin(f.support_user_id,f.tenant_id)->>'actorRole'='support'
    and (public.get_sellertray_commercial_onboarding_admin(f.support_user_id,f.tenant_id)->>'canManage')::boolean=false
  ) from c1b_acceptance_hardening_fixture f),
  'Platform Support can still review the governed onboarding projection'
);

select extensions.ok(
  position('coalesce(v_role' in lower(pg_get_functiondef(
    'public.get_sellertray_commercial_onboarding_admin(uuid,uuid)'::regprocedure
  )))>0
  and position('is distinct from ''admin''' in lower(pg_get_functiondef(
    'public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid)'::regprocedure
  )))>0
  and position('is distinct from ''admin''' in lower(pg_get_functiondef(
    'public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid)'::regprocedure
  )))>0
  and position('is distinct from ''admin''' in lower(pg_get_functiondef(
    'public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure
  )))>0,
  'all exposed first-merchant service RPCs use NULL-safe Platform Admin role guards'
);

select extensions.ok(
  position('for update' in lower(pg_get_functiondef(
    'public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure
  )))>0
  and position('create_sellertray_initial_installment_purchase_admin_impl' in lower(pg_get_functiondef(
    'public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure
  ))) > position('for update' in lower(pg_get_functiondef(
    'public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure
  ))),
  'initial-purchase wrapper serializes the Business before invoking existing idempotency/order checks'
);

select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_commercial_onboarding_admin(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_sellertray_commercial_onboarding_admin(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)','EXECUTE'),
  'exposed first-merchant authority remains service-role only'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_commercial_onboarding_admin_impl(uuid,uuid)') is not null
  and to_regprocedure('public.publish_sellertray_subscription_price_pair_admin_impl(text,text,numeric,numeric,timestamptz,text,uuid)') is not null
  and to_regprocedure('public.publish_sellertray_branch_setup_price_admin_impl(text,numeric,numeric,timestamptz,text,uuid)') is not null
  and to_regprocedure('public.create_sellertray_initial_installment_purchase_admin_impl(uuid,text,text,uuid[],text,text,text,uuid)') is not null
  and not has_function_privilege('authenticated','public.get_sellertray_commercial_onboarding_admin_impl(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_sellertray_initial_installment_purchase_admin_impl(uuid,text,text,uuid[],text,text,text,uuid)','EXECUTE'),
  'renamed implementations remain internal to trusted service authority'
);

select * from extensions.finish();
rollback;
