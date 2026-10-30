begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(27);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_onboarding_state(uuid)','EXECUTE'),
  'authenticated Owner/Manager clients can call the governed onboarding wrapper'
);
select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_onboarding_state(uuid)','EXECUTE'),
  'anonymous clients cannot read merchant onboarding commercial state'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_onboarding_state_core(uuid)','EXECUTE'),
  'authenticated clients cannot bypass the merchant onboarding permission wrapper'
);
select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_onboarding_state_core(uuid)','EXECUTE'),
  'service role can execute the shared onboarding projection'
);
select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_onboarding_state_admin(uuid,uuid)','EXECUTE'),
  'service role can execute the ProcessEdge Admin onboarding wrapper'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_onboarding_state_admin(uuid,uuid)','EXECUTE'),
  'merchant clients cannot call the ProcessEdge Admin onboarding wrapper'
);
select extensions.ok(
  position(
    'if v_role is null or v_role not in' in
    lower(pg_get_functiondef('public.get_sellertray_onboarding_state(uuid)'::regprocedure))
  ) > 0,
  'merchant onboarding wrapper explicitly rejects missing membership instead of relying on NULL NOT IN semantics'
);
select extensions.ok(
  position(
    'if v_role is null or v_role not in' in
    lower(pg_get_functiondef('public.get_sellertray_onboarding_state_admin(uuid,uuid)'::regprocedure))
  ) > 0,
  'Admin onboarding wrapper explicitly rejects missing platform-admin identity'
);

create temporary table oa1_fixture(
  tenant_id uuid primary key,
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  branch_id uuid,
  master_version_id uuid
) on commit drop;

insert into oa1_fixture(tenant_id,admin_user_id,owner_user_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'oa1-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from oa1_fixture
union all
select owner_user_id,'oa1-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from oa1_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from oa1_fixture;

insert into public.tenants(
  id,name,slug,merchant_code,currency,timezone,onboarding_status,
  subscription_status,whatsapp_connection_status
)
select tenant_id,'OA1 Read Model Test','oa1-read-model-'||substr(tenant_id::text,1,8),'OA1','NGN','Africa/Lagos',
       'catalogue','trial','not_connected'
from oa1_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from oa1_fixture;

update oa1_fixture f
set branch_id=(
  select b.id from public.branches b
  where b.tenant_id=f.tenant_id and b.is_active
  order by b.is_default desc,b.created_at,b.id
  limit 1
);

select extensions.is(
  (select (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{branchPreparation,activeBranchCount}')::integer from oa1_fixture),
  1,
  'Business creation establishes one governed active Branch for onboarding'
);

update public.branches b set is_active=false
from oa1_fixture f where b.id=f.branch_id;
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)#>>'{nextAction,code}' from oa1_fixture),
  'prepare_branch',
  'Branch preparation remains the first onboarding action when no active Branch exists'
);

update public.branches b set is_active=true
from oa1_fixture f where b.id=f.branch_id;
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)#>>'{nextAction,code}' from oa1_fixture),
  'await_master_agreement_publication',
  'after Branch preparation, first purchase fails closed until a current Master Agreement is published'
);

update oa1_fixture f
set master_version_id=public.publish_sellertray_master_agreement_admin(
  'build43-oa1-'||substr(f.tenant_id::text,1,8),
  'SellerTray Master Agreement',
  'Build 43 first-purchase sequencing regression agreement.',
  now()-interval '1 minute',
  'Build 43 clean-schema onboarding regression',
  f.admin_user_id
);

select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)#>>'{nextAction,code}' from oa1_fixture),
  'review_master_agreement',
  'published but unaccepted Master Agreement is the governed action before first plan selection'
);
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)->>'currentStage' from oa1_fixture),
  'agreement',
  'published but unaccepted Master Agreement keeps onboarding at the agreement stage'
);
select extensions.ok(
  (select (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{agreement,published}')::boolean
          and not (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{agreement,accepted}')::boolean
   from oa1_fixture),
  'pre-purchase agreement projection distinguishes published from accepted state'
);
select extensions.ok(
  not (select (public.get_sellertray_commercial_billing_center(tenant_id,owner_user_id)->>'canPurchaseInitial')::boolean from oa1_fixture),
  'Billing cannot create the initial purchase before current Master Agreement acceptance'
);
select extensions.throws_ok(
  format(
    'select public.create_sellertray_initial_installment_purchase_merchant(%L,%L,%L,array[%L]::uuid[],%L,%L,%L)',
    f.tenant_id,'business','NGN',f.branch_id,'two_installment_70_30',gen_random_uuid(),f.owner_user_id
  ),
  '23514',null::text,
  'server-side first-purchase command rejects entry before Master Agreement acceptance'
) from oa1_fixture f;

select extensions.ok(
  (select public.accept_sellertray_master_agreement(
    f.tenant_id,f.master_version_id,'OA1 Business Owner',
    jsonb_build_object('channel','merchant_web','authority_confirmed',true),
    gen_random_uuid(),f.owner_user_id
  ) is not null from oa1_fixture f),
  'controlled test fixture records genuine authority-shaped Master acceptance'
);
select extensions.ok(
  (select public.sellertray_master_agreement_is_accepted(tenant_id,now()) from oa1_fixture),
  'Business satisfies the current Master Agreement after one acceptance'
);
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)#>>'{nextAction,code}' from oa1_fixture),
  'select_plan',
  'accepted current Master Agreement advances the no-order lifecycle to plan selection'
);
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)#>>'{nextAction,surface}' from oa1_fixture),
  'merchant_web',
  'first plan selection remains a Merchant Web responsibility'
);
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)->>'currentStage' from oa1_fixture),
  'commercial_order',
  'accepted Master Agreement restores the commercial-order stage before the first purchase exists'
);
select extensions.ok(
  (select (public.get_sellertray_commercial_billing_center(tenant_id,owner_user_id)->>'canPurchaseInitial')::boolean from oa1_fixture),
  'Billing enables the initial Owner purchase only after Master Agreement acceptance'
);
select extensions.is(
  (select (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{settlement,approvedAdjustmentAmount}')::numeric from oa1_fixture),
  0::numeric,
  'onboarding does not manufacture an adjustment before commercial authority creates one'
);
select extensions.is(
  (select (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{settlement,directPaymentAmount}')::numeric from oa1_fixture),
  0::numeric,
  'onboarding does not manufacture a direct payment before reconciliation authority creates one'
);
select extensions.is(
  (select (public.get_sellertray_onboarding_state_core(tenant_id)#>>'{legacyRuntime,compatibilityAccess}')::boolean from oa1_fixture),
  false,
  'new Businesses do not receive operational trial access before activation'
);
select extensions.is(
  (select public.get_sellertray_onboarding_state_core(tenant_id)->>'accessEnforcement' from oa1_fixture),
  'governed_runtime',
  'onboarding status identifies the governed runtime enforcement boundary'
);

-- An existing legacy trial remains compatible; OA5 does not retire the estate before C2.
update public.tenant_subscriptions s set trial_ends_at=now()+interval '5 days'
from oa1_fixture f where f.tenant_id=s.tenant_id;
select extensions.ok(public.orderdesk_subscription_can_write(tenant_id),
  'legacy runtime access remains compatible until the governed C2 cutover') from oa1_fixture;

select * from extensions.finish();
rollback;
