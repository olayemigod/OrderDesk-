begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

create temp table sellertray_tenant_pricing_fixture (
  admin_user_id uuid not null,
  support_user_id uuid not null,
  tenant_override_id uuid not null,
  tenant_fallback_id uuid not null,
  standard_monthly_id uuid,
  standard_yearly_id uuid,
  standard_setup_id uuid,
  override_monthly_id uuid,
  override_yearly_id uuid,
  override_setup_id uuid,
  guessed_status_rejected boolean not null default false
) on commit drop;

insert into sellertray_tenant_pricing_fixture(
  admin_user_id,support_user_id,tenant_override_id,tenant_fallback_id
) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'tenant-pricing-admin-'||left(admin_user_id::text,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_tenant_pricing_fixture
union all
select support_user_id,'tenant-pricing-support-'||left(support_user_id::text,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_tenant_pricing_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from sellertray_tenant_pricing_fixture
union all
select support_user_id,'support' from sellertray_tenant_pricing_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_override_id,'Pricing Override Business','pricing-override-'||left(tenant_override_id::text,8),'POV','trial'
from sellertray_tenant_pricing_fixture
union all
select tenant_fallback_id,'Pricing Fallback Business','pricing-fallback-'||left(tenant_fallback_id::text,8),'PFB','trial'
from sellertray_tenant_pricing_fixture;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',1000,now()-interval '2 days',
         'Canonical standard monthly price',admin_user_id,admin_user_id,now()
  from sellertray_tenant_pricing_fixture
  returning id
)
update sellertray_tenant_pricing_fixture set standard_monthly_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',10000,now()-interval '2 days',
         'Canonical standard yearly price',admin_user_id,admin_user_id,now()
  from sellertray_tenant_pricing_fixture
  returning id
)
update sellertray_tenant_pricing_fixture set standard_yearly_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'branch_setup',null,null,'NGN',5000,now()-interval '2 days',
         'Canonical standard setup price',admin_user_id,admin_user_id,now()
  from sellertray_tenant_pricing_fixture
  returning id
)
update sellertray_tenant_pricing_fixture set standard_setup_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    tenant_id,price_scope,source_standard_price_version_id,
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,effective_until,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select tenant_override_id,'merchant_override',standard_monthly_id,
         'subscription','business','monthly','NGN',800,now()-interval '1 day',now()+interval '30 days',
         'Governed Business monthly override',admin_user_id,admin_user_id,now()
  from sellertray_tenant_pricing_fixture
  returning id
)
update sellertray_tenant_pricing_fixture set override_monthly_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    tenant_id,price_scope,source_standard_price_version_id,
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,effective_until,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select tenant_override_id,'merchant_override',standard_yearly_id,
         'subscription','business','yearly','NGN',8000,now()-interval '1 day',now()+interval '30 days',
         'Governed Business yearly override',admin_user_id,admin_user_id,now()
  from sellertray_tenant_pricing_fixture
  returning id
)
update sellertray_tenant_pricing_fixture set override_yearly_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    tenant_id,price_scope,source_standard_price_version_id,
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,effective_until,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select tenant_override_id,'merchant_override',standard_setup_id,
         'branch_setup',null,null,'NGN',4000,now()-interval '1 day',now()+interval '30 days',
         'Governed Business setup override',admin_user_id,admin_user_id,now()
  from sellertray_tenant_pricing_fixture
  returning id
)
update sellertray_tenant_pricing_fixture set override_setup_id=(select id from inserted);

select extensions.is(
  public.resolve_sellertray_commercial_price_version_for_tenant(
    tenant_override_id,'subscription','business','yearly','NGN',now()
  ),override_yearly_id,
  'tenant resolver selects the applicable governed Business subscription override'
) from sellertray_tenant_pricing_fixture;

select extensions.is(
  public.resolve_sellertray_commercial_price_version_for_tenant(
    tenant_override_id,'branch_setup',null,null,'NGN',now()
  ),override_setup_id,
  'tenant resolver selects the applicable governed Business setup override'
) from sellertray_tenant_pricing_fixture;

select extensions.is(
  public.resolve_sellertray_commercial_price_version_for_tenant(
    tenant_fallback_id,'subscription','business','yearly','NGN',now()
  ),standard_yearly_id,
  'tenant resolver falls back to the canonical standard subscription price'
) from sellertray_tenant_pricing_fixture;

select extensions.is(
  public.resolve_sellertray_commercial_price_version_for_tenant(
    tenant_fallback_id,'branch_setup',null,null,'NGN',now()
  ),standard_setup_id,
  'tenant resolver falls back to the canonical standard setup price'
) from sellertray_tenant_pricing_fixture;

select extensions.ok(
  exists (
    select 1
    from sellertray_tenant_pricing_fixture f,
         jsonb_array_elements(public.get_sellertray_commercial_onboarding_admin(
           f.admin_user_id,f.tenant_override_id
         )->'effectivePrices') p
    where p->>'id'=f.override_yearly_id::text
      and p->>'priceScope'='merchant_override'
  ),
  'Admin onboarding projects the same effective Business override selected by the resolver'
);

select extensions.ok(
  exists (
    select 1
    from sellertray_tenant_pricing_fixture f,
         jsonb_array_elements(public.get_sellertray_commercial_onboarding_admin(
           f.admin_user_id,f.tenant_fallback_id
         )->'effectivePrices') p
    where p->>'id'=f.standard_yearly_id::text
      and p->>'priceScope'='standard'
  ),
  'Admin onboarding projects canonical standard fallback when no Business override exists'
);

select extensions.ok(
  not exists (
    select 1
    from sellertray_tenant_pricing_fixture f,
         jsonb_array_elements(public.get_sellertray_commercial_onboarding_admin(
           f.admin_user_id,f.tenant_fallback_id
         )->'prices') p
    where p->>'tenantId'=f.tenant_override_id::text
  ),
  'Admin onboarding price history does not expose another Business override'
);

select extensions.ok(
  (select (projection.value->>'canManageGlobalPricing')::boolean
       and (projection.value->>'canManageMerchantPricing')::boolean
   from sellertray_tenant_pricing_fixture f
   cross join lateral (
     select public.get_sellertray_commercial_onboarding_admin(
       f.admin_user_id,f.tenant_override_id
     ) as value
   ) projection),
  'Admin onboarding projects actionable pricing capabilities for authorised Platform Admin'
);

select extensions.ok(
  (select not (projection.value->>'canManageGlobalPricing')::boolean
       and not (projection.value->>'canManageMerchantPricing')::boolean
   from sellertray_tenant_pricing_fixture f
   cross join lateral (
     select public.get_sellertray_commercial_onboarding_admin(
       f.support_user_id,f.tenant_override_id
     ) as value
   ) projection),
  'Admin onboarding keeps Platform Support pricing review-only without an explicit grant'
);

do $$
begin
  begin
    update public.tenant_subscriptions s
    set status='trialing'
    from sellertray_tenant_pricing_fixture f
    where s.tenant_id=f.tenant_override_id;
  exception when check_violation then
    update sellertray_tenant_pricing_fixture set guessed_status_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select guessed_status_rejected from sellertray_tenant_pricing_fixture),
  'canonical tenant_subscriptions constraint rejects guessed trialing commercial status'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamptz)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role','public.get_sellertray_commercial_onboarding_admin(uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.get_sellertray_commercial_onboarding_admin(uuid,uuid)','EXECUTE'
  ),
  'resolver and onboarding RPC preserve their service-role-only execution boundary'
);

select * from extensions.finish();
rollback;
