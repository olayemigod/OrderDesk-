begin;

-- SellerTray C2-3 Commercial Configuration Master Foundation
--
-- Additive only. Existing C1 price/order/installment/payment/legal history stays
-- immutable and public.tenant_subscriptions remains the runtime compatibility
-- authority. This migration introduces Commercial V2 masters and extends the
-- existing price/installment authorities so later C2 stages can bind them to
-- Plan Profile Versions without creating a second pricing or installment engine.

-- ---------------------------------------------------------------------------
-- 1. Governed commercial master vocabulary
-- ---------------------------------------------------------------------------

create table public.sellertray_commercial_charge_types (
  code text primary key,
  display_name text not null,
  description text not null,
  charge_family text not null,
  billing_behavior text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint sellertray_commercial_charge_types_code_check
    check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_commercial_charge_types_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_commercial_charge_types_description_check
    check (char_length(btrim(description)) between 1 and 1000),
  constraint sellertray_commercial_charge_types_family_check
    check (charge_family in ('subscription','setup','addon','staff','other')),
  constraint sellertray_commercial_charge_types_behavior_check
    check (billing_behavior in ('recurring','one_time','usage')),
  constraint sellertray_commercial_charge_types_status_check
    check (status in ('active','retired'))
);

insert into public.sellertray_commercial_charge_types(code,display_name,description,charge_family,billing_behavior) values
  ('branch_subscription','Branch subscription','Recurring SellerTray subscription charge owned by a Branch.','subscription','recurring'),
  ('branch_setup','Branch setup','One-time governed SellerTray Branch setup charge.','setup','one_time'),
  ('addon','Add-on','Charge for a governed SellerTray add-on entitlement.','addon','recurring'),
  ('additional_staff','Additional staff','Recurring charge class for approved additional staff capacity.','staff','recurring')
on conflict (code) do nothing;

create table public.sellertray_commercial_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  status text not null default 'active',
  created_by_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint sellertray_commercial_tax_profiles_code_check
    check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_commercial_tax_profiles_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_commercial_tax_profiles_status_check
    check (status in ('active','retired'))
);

create table public.sellertray_commercial_tax_profile_versions (
  id uuid primary key default gen_random_uuid(),
  tax_profile_id uuid not null references public.sellertray_commercial_tax_profiles(id) on delete restrict,
  version integer not null,
  rate_percent numeric(9,6) not null,
  tax_inclusive boolean not null default true,
  effective_from timestamptz not null,
  effective_until timestamptz,
  change_reason text not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tax_profile_id,version),
  unique (tax_profile_id,effective_from),
  constraint sellertray_commercial_tax_profile_versions_version_check check (version > 0),
  constraint sellertray_commercial_tax_profile_versions_rate_check check (rate_percent between 0 and 100),
  constraint sellertray_commercial_tax_profile_versions_inclusive_check check (tax_inclusive),
  constraint sellertray_commercial_tax_profile_versions_effective_check check (effective_until is null or effective_until > effective_from),
  constraint sellertray_commercial_tax_profile_versions_reason_check check (char_length(btrim(change_reason)) between 6 and 1000)
);

create index sellertray_commercial_tax_profile_resolution_idx
  on public.sellertray_commercial_tax_profile_versions(tax_profile_id,effective_from desc,created_at desc);

create table public.sellertray_commercial_payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  default_display_name text not null,
  status text not null default 'active',
  created_by_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint sellertray_commercial_payment_methods_code_check check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_commercial_payment_methods_name_check check (char_length(btrim(default_display_name)) between 1 and 120),
  constraint sellertray_commercial_payment_methods_status_check check (status in ('active','retired'))
);

create table public.sellertray_commercial_payment_method_versions (
  id uuid primary key default gen_random_uuid(),
  payment_method_id uuid not null references public.sellertray_commercial_payment_methods(id) on delete restrict,
  version integer not null,
  display_name text not null,
  method_type text not null,
  confirmation_mode text not null,
  provider_code text,
  instructions text,
  configuration jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null,
  effective_until timestamptz,
  change_reason text not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (payment_method_id,version),
  unique (payment_method_id,effective_from),
  constraint sellertray_commercial_payment_method_versions_version_check check (version > 0),
  constraint sellertray_commercial_payment_method_versions_name_check check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_commercial_payment_method_versions_type_check check (method_type in ('bank_transfer','paystack','flutterwave','manual','other')),
  constraint sellertray_commercial_payment_method_versions_confirmation_check check (confirmation_mode in ('automatic','manual_verification','manual_confirmation')),
  constraint sellertray_commercial_payment_method_versions_provider_check check (provider_code is null or provider_code ~ '^[a-z][a-z0-9_-]{0,63}$'),
  constraint sellertray_commercial_payment_method_versions_configuration_check check (jsonb_typeof(configuration)='object'),
  constraint sellertray_commercial_payment_method_versions_effective_check check (effective_until is null or effective_until > effective_from),
  constraint sellertray_commercial_payment_method_versions_reason_check check (char_length(btrim(change_reason)) between 6 and 1000)
);

create index sellertray_commercial_payment_method_resolution_idx
  on public.sellertray_commercial_payment_method_versions(payment_method_id,effective_from desc,created_at desc);

insert into public.sellertray_commercial_payment_methods(code,default_display_name) values
  ('paystack','Paystack'),
  ('bank_transfer','Bank transfer'),
  ('flutterwave','Flutterwave')
on conflict (code) do nothing;

create table public.sellertray_commercial_adjustment_types (
  code text primary key,
  display_name text not null,
  description text not null,
  adjustment_kind text not null,
  calculation_mode text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint sellertray_commercial_adjustment_types_code_check check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_commercial_adjustment_types_name_check check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_commercial_adjustment_types_description_check check (char_length(btrim(description)) between 1 and 1000),
  constraint sellertray_commercial_adjustment_types_kind_check check (adjustment_kind in ('discount','credit','surcharge')),
  constraint sellertray_commercial_adjustment_types_mode_check check (calculation_mode in ('fixed','percentage')),
  constraint sellertray_commercial_adjustment_types_status_check check (status in ('active','retired'))
);

insert into public.sellertray_commercial_adjustment_types(code,display_name,description,adjustment_kind,calculation_mode) values
  ('discount_fixed','Fixed discount','Governed fixed-value commercial discount.','discount','fixed'),
  ('discount_percentage','Percentage discount','Governed percentage commercial discount.','discount','percentage'),
  ('credit_fixed','Fixed credit','Governed fixed-value commercial credit.','credit','fixed'),
  ('surcharge_fixed','Fixed surcharge','Governed fixed-value commercial surcharge.','surcharge','fixed')
on conflict (code) do nothing;

create table public.sellertray_commercial_entitlement_override_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  plan_profile_version_id uuid not null references public.sellertray_plan_profile_versions(id) on delete restrict,
  override_kind text not null,
  feature_code text references public.sellertray_feature_catalogue(code) on delete restrict,
  capability_code text references public.sellertray_capability_catalogue(code) on delete restrict,
  limit_code text references public.sellertray_limit_definitions(code) on delete restrict,
  enabled boolean,
  limit_value numeric(18,6),
  is_unlimited boolean,
  effective_from timestamptz not null,
  effective_until timestamptz,
  change_reason text not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint sellertray_commercial_entitlement_override_kind_check check (override_kind in ('feature','capability','limit')),
  constraint sellertray_commercial_entitlement_override_shape_check check (
    (override_kind='feature' and feature_code is not null and capability_code is null and limit_code is null and enabled is not null and limit_value is null and is_unlimited is null)
    or
    (override_kind='capability' and feature_code is null and capability_code is not null and limit_code is null and enabled is not null and limit_value is null and is_unlimited is null)
    or
    (override_kind='limit' and feature_code is null and capability_code is null and limit_code is not null and enabled is null and ((is_unlimited=true and limit_value is null) or (coalesce(is_unlimited,false)=false and limit_value is not null and limit_value>=0)))
  ),
  constraint sellertray_commercial_entitlement_override_effective_check check (effective_until is null or effective_until > effective_from),
  constraint sellertray_commercial_entitlement_override_reason_check check (char_length(btrim(change_reason)) between 6 and 1000)
);

create index sellertray_commercial_entitlement_override_resolution_idx
  on public.sellertray_commercial_entitlement_override_versions(tenant_id,plan_profile_version_id,override_kind,effective_from desc,created_at desc);

create trigger prevent_sellertray_commercial_tax_profile_version_mutation
before update or delete on public.sellertray_commercial_tax_profile_versions
for each row execute function public.prevent_sellertray_commercial_history_mutation();
create trigger prevent_sellertray_commercial_payment_method_version_mutation
before update or delete on public.sellertray_commercial_payment_method_versions
for each row execute function public.prevent_sellertray_commercial_history_mutation();
create trigger prevent_sellertray_commercial_entitlement_override_mutation
before update or delete on public.sellertray_commercial_entitlement_override_versions
for each row execute function public.prevent_sellertray_commercial_history_mutation();

-- ---------------------------------------------------------------------------
-- 2. Governed master publication commands
-- ---------------------------------------------------------------------------

create or replace function public.publish_sellertray_commercial_tax_profile_version_admin(
  p_tax_profile_id uuid,
  p_rate_percent numeric,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_reason text:=btrim(coalesce(p_reason,''));
  v_version integer;
  v_id uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.commercial_tax.manage',null,now()) then
    raise exception 'Commercial tax management capability required' using errcode='42501';
  end if;
  if p_tax_profile_id is null or not exists(select 1 from public.sellertray_commercial_tax_profiles p where p.id=p_tax_profile_id and p.status='active') then
    raise exception 'Active commercial tax profile not found' using errcode='P0002';
  end if;
  if p_rate_percent is null or p_rate_percent<0 or p_rate_percent>100 or p_effective_from is null or (p_effective_until is not null and p_effective_until<=p_effective_from) then
    raise exception 'Valid tax rate and effective window are required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then raise exception 'Commercial tax change reason must be between 6 and 1000 characters' using errcode='22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-tax-profile|'||p_tax_profile_id::text,0));
  select coalesce(max(v.version),0)+1 into v_version from public.sellertray_commercial_tax_profile_versions v where v.tax_profile_id=p_tax_profile_id;
  insert into public.sellertray_commercial_tax_profile_versions(
    tax_profile_id,version,rate_percent,tax_inclusive,effective_from,effective_until,change_reason,created_by_user_id
  ) values(p_tax_profile_id,v_version,p_rate_percent,true,p_effective_from,p_effective_until,v_reason,p_actor_user_id)
  returning id into v_id;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_commercial_tax_profile_version',jsonb_build_object(
    'taxProfileId',p_tax_profile_id,'taxProfileVersionId',v_id,'version',v_version,
    'ratePercent',p_rate_percent,'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,'reason',v_reason
  ));
  return v_id;
end;
$function$;

create or replace function public.publish_sellertray_commercial_payment_method_version_admin(
  p_payment_method_id uuid,
  p_display_name text,
  p_method_type text,
  p_confirmation_mode text,
  p_provider_code text,
  p_instructions text,
  p_configuration jsonb,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_reason text:=btrim(coalesce(p_reason,''));
  v_version integer;
  v_id uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.commercial_payment_methods.manage',null,now()) then
    raise exception 'Commercial payment-method management capability required' using errcode='42501';
  end if;
  if p_payment_method_id is null or not exists(select 1 from public.sellertray_commercial_payment_methods p where p.id=p_payment_method_id and p.status='active') then
    raise exception 'Active commercial payment method not found' using errcode='P0002';
  end if;
  if char_length(btrim(coalesce(p_display_name,''))) not between 1 and 120 or p_effective_from is null or (p_effective_until is not null and p_effective_until<=p_effective_from) then
    raise exception 'Display name and valid effective window are required' using errcode='22023';
  end if;
  if p_method_type not in ('bank_transfer','paystack','flutterwave','manual','other') or p_confirmation_mode not in ('automatic','manual_verification','manual_confirmation') then
    raise exception 'Unsupported commercial payment method configuration' using errcode='22023';
  end if;
  if coalesce(p_configuration,'{}'::jsonb) is null or jsonb_typeof(coalesce(p_configuration,'{}'::jsonb))<>'object' then raise exception 'Payment method configuration must be an object' using errcode='22023'; end if;
  if char_length(v_reason) not between 6 and 1000 then raise exception 'Commercial payment-method change reason must be between 6 and 1000 characters' using errcode='22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-commercial-payment-method|'||p_payment_method_id::text,0));
  select coalesce(max(v.version),0)+1 into v_version from public.sellertray_commercial_payment_method_versions v where v.payment_method_id=p_payment_method_id;
  insert into public.sellertray_commercial_payment_method_versions(
    payment_method_id,version,display_name,method_type,confirmation_mode,provider_code,instructions,
    configuration,effective_from,effective_until,change_reason,created_by_user_id
  ) values(
    p_payment_method_id,v_version,btrim(p_display_name),p_method_type,p_confirmation_mode,
    nullif(lower(btrim(coalesce(p_provider_code,''))),''),nullif(btrim(coalesce(p_instructions,'')),''),
    coalesce(p_configuration,'{}'::jsonb),p_effective_from,p_effective_until,v_reason,p_actor_user_id
  ) returning id into v_id;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_commercial_payment_method_version',jsonb_build_object(
    'paymentMethodId',p_payment_method_id,'paymentMethodVersionId',v_id,'version',v_version,
    'methodType',p_method_type,'confirmationMode',p_confirmation_mode,'providerCode',p_provider_code,
    'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,'reason',v_reason
  ));
  return v_id;
end;
$function$;

revoke all on function public.publish_sellertray_commercial_tax_profile_version_admin(uuid,numeric,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_commercial_payment_method_version_admin(uuid,text,text,text,text,text,jsonb,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_commercial_tax_profile_version_admin(uuid,numeric,timestamptz,timestamptz,text,uuid) to service_role;
grant execute on function public.publish_sellertray_commercial_payment_method_version_admin(uuid,text,text,text,text,text,jsonb,timestamptz,timestamptz,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Extend the existing immutable price authority for Commercial V2 subjects
-- ---------------------------------------------------------------------------

alter table public.sellertray_commercial_price_versions
  add column if not exists charge_type_code text,
  add column if not exists plan_profile_version_id uuid,
  add column if not exists addon_version_id uuid,
  add column if not exists commercial_tax_profile_version_id uuid;

update public.sellertray_commercial_price_versions
set charge_type_code=case price_kind
  when 'subscription' then 'branch_subscription'
  when 'branch_setup' then 'branch_setup'
  else charge_type_code
end
where charge_type_code is null;

alter table public.sellertray_commercial_price_versions
  alter column charge_type_code set not null,
  add constraint sellertray_commercial_price_versions_charge_type_fkey
    foreign key (charge_type_code) references public.sellertray_commercial_charge_types(code) on delete restrict,
  add constraint sellertray_commercial_price_versions_plan_profile_version_fkey
    foreign key (plan_profile_version_id) references public.sellertray_plan_profile_versions(id) on delete restrict,
  add constraint sellertray_commercial_price_versions_addon_version_fkey
    foreign key (addon_version_id) references public.sellertray_addon_versions(id) on delete restrict,
  add constraint sellertray_commercial_price_versions_tax_profile_version_fkey
    foreign key (commercial_tax_profile_version_id) references public.sellertray_commercial_tax_profile_versions(id) on delete restrict;

alter table public.sellertray_commercial_price_versions
  drop constraint sellertray_commercial_price_versions_kind_check,
  add constraint sellertray_commercial_price_versions_kind_check
    check (price_kind in ('subscription','branch_setup','addon','additional_staff')),
  drop constraint sellertray_commercial_price_versions_subject_check,
  add constraint sellertray_commercial_price_versions_subject_check
    check (
      (
        price_kind='subscription' and charge_type_code='branch_subscription'
        and billing_cycle in ('monthly','yearly') and addon_version_id is null
        and (
          (plan_code is not null and plan_profile_version_id is null)
          or
          (plan_code is null and plan_profile_version_id is not null)
        )
      )
      or
      (
        price_kind='branch_setup' and charge_type_code='branch_setup'
        and plan_code is null and plan_profile_version_id is null and addon_version_id is null and billing_cycle is null
      )
      or
      (
        price_kind='addon' and charge_type_code='addon'
        and plan_code is null and plan_profile_version_id is null and addon_version_id is not null
        and billing_cycle in ('monthly','yearly','one_time')
      )
      or
      (
        price_kind='additional_staff' and charge_type_code='additional_staff'
        and plan_code is null and addon_version_id is null
        and billing_cycle in ('monthly','yearly')
      )
    );

create unique index sellertray_commercial_c2_subscription_standard_price_key
  on public.sellertray_commercial_price_versions(plan_profile_version_id,billing_cycle,currency,effective_from)
  where price_kind='subscription' and price_scope='standard' and plan_profile_version_id is not null;
create unique index sellertray_commercial_c2_subscription_override_price_key
  on public.sellertray_commercial_price_versions(tenant_id,plan_profile_version_id,billing_cycle,currency,effective_from)
  where price_kind='subscription' and price_scope='merchant_override' and plan_profile_version_id is not null;
create unique index sellertray_commercial_addon_standard_price_key
  on public.sellertray_commercial_price_versions(addon_version_id,billing_cycle,currency,effective_from)
  where price_kind='addon' and price_scope='standard';
create unique index sellertray_commercial_addon_override_price_key
  on public.sellertray_commercial_price_versions(tenant_id,addon_version_id,billing_cycle,currency,effective_from)
  where price_kind='addon' and price_scope='merchant_override';
create unique index sellertray_commercial_staff_standard_price_key
  on public.sellertray_commercial_price_versions(plan_profile_version_id,billing_cycle,currency,effective_from) nulls not distinct
  where price_kind='additional_staff' and price_scope='standard';
create unique index sellertray_commercial_staff_override_price_key
  on public.sellertray_commercial_price_versions(tenant_id,plan_profile_version_id,billing_cycle,currency,effective_from) nulls not distinct
  where price_kind='additional_staff' and price_scope='merchant_override';

create or replace function public.validate_sellertray_commercial_price_version()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_monthly public.sellertray_commercial_price_versions%rowtype;
  v_profile public.sellertray_plan_profile_versions%rowtype;
  v_addon public.sellertray_addon_versions%rowtype;
  v_tax public.sellertray_commercial_tax_profile_versions%rowtype;
  v_source public.sellertray_commercial_price_versions%rowtype;
begin
  new.currency:=upper(btrim(new.currency));
  new.change_reason:=btrim(new.change_reason);

  if new.plan_profile_version_id is not null then
    select v.* into strict v_profile from public.sellertray_plan_profile_versions v where v.id=new.plan_profile_version_id;
    if v_profile.status<>'published' or v_profile.effective_from>new.effective_from or (v_profile.effective_until is not null and v_profile.effective_until<=new.effective_from) then
      raise exception 'Commercial V2 price requires a published effective Plan Profile Version' using errcode='23514';
    end if;
    if new.billing_cycle is not null and not (new.billing_cycle=any(v_profile.allowed_billing_cycles)) then
      raise exception 'Billing cycle is not allowed by the Plan Profile Version' using errcode='23514';
    end if;
  end if;

  if new.addon_version_id is not null then
    select v.* into strict v_addon from public.sellertray_addon_versions v where v.id=new.addon_version_id;
    if v_addon.status<>'published' or v_addon.effective_from>new.effective_from or (v_addon.effective_until is not null and v_addon.effective_until<=new.effective_from) then
      raise exception 'Commercial add-on price requires a published effective add-on version' using errcode='23514';
    end if;
    if new.billing_cycle is not null and not (new.billing_cycle=any(v_addon.allowed_billing_cycles)) then
      raise exception 'Billing cycle is not allowed by the add-on version' using errcode='23514';
    end if;
  end if;

  if new.commercial_tax_profile_version_id is not null then
    select t.* into strict v_tax from public.sellertray_commercial_tax_profile_versions t where t.id=new.commercial_tax_profile_version_id;
    if v_tax.effective_from>new.effective_from or (v_tax.effective_until is not null and v_tax.effective_until<=new.effective_from) then
      raise exception 'Commercial tax profile version is not effective for the price version' using errcode='23514';
    end if;
    if new.tax_rate_percent is distinct from v_tax.rate_percent or new.tax_inclusive is distinct from v_tax.tax_inclusive then
      raise exception 'Commercial price tax snapshot must match the governed tax profile version' using errcode='23514';
    end if;
  end if;

  -- Preserve the legacy C1 10-for-12 rule only for legacy plan-code rows.
  -- C2 Plan Profile cycles are independently configurable commercial rates.
  if new.price_kind='subscription' and new.plan_code is not null and new.billing_cycle='yearly' then
    select p.* into v_monthly
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription' and p.plan_code=new.plan_code and p.plan_profile_version_id is null
      and p.billing_cycle='monthly' and p.currency=new.currency and p.price_scope=new.price_scope
      and p.tenant_id is not distinct from new.tenant_id and p.status='published'
      and p.effective_from<=new.effective_from and (p.effective_until is null or p.effective_until>new.effective_from)
    order by p.effective_from desc,p.created_at desc limit 1;
    if not found then raise exception 'A governed monthly price must exist before a legacy yearly 10-for-12 price is published' using errcode='23514'; end if;
    if abs(new.gross_amount-(v_monthly.gross_amount*10))>=0.005 then raise exception 'Legacy yearly SellerTray subscription price must equal 10 monthly periods' using errcode='23514'; end if;
    if (new.net_amount is null) is distinct from (v_monthly.net_amount is null)
       or (new.tax_amount is null) is distinct from (v_monthly.tax_amount is null)
       or (new.tax_rate_percent is null) is distinct from (v_monthly.tax_rate_percent is null) then
      raise exception 'Legacy yearly SellerTray tax treatment must match the governed monthly price' using errcode='23514';
    end if;
    if v_monthly.net_amount is not null and (
      abs(new.net_amount-(v_monthly.net_amount*10))>=0.005
      or abs(new.tax_amount-(v_monthly.tax_amount*10))>=0.005
      or new.tax_rate_percent is distinct from v_monthly.tax_rate_percent
    ) then raise exception 'Legacy yearly SellerTray tax snapshot must preserve the 10-for-12 rule' using errcode='23514'; end if;
  end if;

  if new.price_scope='merchant_override' then
    select p.* into strict v_source from public.sellertray_commercial_price_versions p where p.id=new.source_standard_price_version_id;
    if v_source.price_scope<>'standard'
       or v_source.price_kind<>new.price_kind
       or v_source.charge_type_code<>new.charge_type_code
       or v_source.plan_code is distinct from new.plan_code
       or v_source.plan_profile_version_id is distinct from new.plan_profile_version_id
       or v_source.addon_version_id is distinct from new.addon_version_id
       or v_source.billing_cycle is distinct from new.billing_cycle
       or v_source.currency<>new.currency
       or v_source.commercial_tax_profile_version_id is distinct from new.commercial_tax_profile_version_id
       or v_source.tax_rate_percent is distinct from new.tax_rate_percent then
      raise exception 'Business price override must derive from a matching standard price version' using errcode='23514';
    end if;
    if v_source.effective_from>new.effective_from or (v_source.effective_until is not null and v_source.effective_until<=new.effective_from) then
      raise exception 'Source standard price version is not effective for the Business override' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.resolve_sellertray_commercial_v2_price_version(
  p_tenant_id uuid,
  p_price_kind text,
  p_plan_profile_version_id uuid,
  p_addon_version_id uuid,
  p_billing_cycle text,
  p_currency text,
  p_as_of timestamptz default now()
)
returns uuid
language sql
stable
security definer
set search_path=''
as $function$
  select p.id
  from public.sellertray_commercial_price_versions p
  where p.price_kind=p_price_kind
    and p.plan_code is null
    and p.plan_profile_version_id is not distinct from p_plan_profile_version_id
    and p.addon_version_id is not distinct from p_addon_version_id
    and p.billing_cycle is not distinct from p_billing_cycle
    and p.currency=upper(btrim(p_currency))
    and p.status='published'
    and p.effective_from<=p_as_of and (p.effective_until is null or p.effective_until>p_as_of)
    and public.sellertray_commercial_price_version_state(p.id,p_as_of)='active'
    and (
      (p.price_scope='merchant_override' and p.tenant_id=p_tenant_id)
      or p.price_scope='standard'
    )
  order by case p.price_scope when 'merchant_override' then 200 else 100 end desc,
           p.effective_from desc,p.created_at desc,p.id desc
  limit 1;
$function$;

revoke all on function public.resolve_sellertray_commercial_v2_price_version(uuid,text,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.resolve_sellertray_commercial_v2_price_version(uuid,text,uuid,uuid,text,text,timestamptz) to service_role;

create or replace function public.publish_sellertray_commercial_v2_price_admin(
  p_price_kind text,
  p_plan_profile_version_id uuid,
  p_addon_version_id uuid,
  p_billing_cycle text,
  p_currency text,
  p_gross_amount numeric,
  p_commercial_tax_profile_version_id uuid,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_kind text:=lower(btrim(coalesce(p_price_kind,'')));
  v_cycle text:=lower(btrim(coalesce(p_billing_cycle,'')));
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_gross numeric(18,2):=round(coalesce(p_gross_amount,0)::numeric,2);
  v_charge_type text;
  v_tax public.sellertray_commercial_tax_profile_versions%rowtype;
  v_net numeric(18,2);
  v_tax_amount numeric(18,2);
  v_tax_rate numeric(9,6);
  v_id uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',null,now()) then raise exception 'Commercial pricing management capability required' using errcode='42501'; end if;
  if v_kind not in ('subscription','branch_setup','addon','additional_staff') or v_currency!~'^[A-Z]{3}$' or v_gross<=0 or p_effective_from is null then raise exception 'Valid price kind, currency, amount and effective time are required' using errcode='22023'; end if;
  if p_effective_until is not null and p_effective_until<=p_effective_from then raise exception 'Price expiry must be after its effective time' using errcode='22023'; end if;
  if char_length(v_reason) not between 6 and 1000 then raise exception 'Commercial price change reason must be between 6 and 1000 characters' using errcode='22023'; end if;

  if v_kind='subscription' then
    if p_plan_profile_version_id is null or p_addon_version_id is not null or v_cycle not in ('monthly','yearly') then raise exception 'Commercial V2 subscription price requires Plan Profile Version and valid cycle' using errcode='22023'; end if;
    v_charge_type:='branch_subscription';
  elsif v_kind='branch_setup' then
    if p_plan_profile_version_id is not null or p_addon_version_id is not null or v_cycle<>'' then raise exception 'Branch setup price has no Plan/add-on/cycle subject' using errcode='22023'; end if;
    v_cycle:=null; v_charge_type:='branch_setup';
  elsif v_kind='addon' then
    if p_addon_version_id is null or p_plan_profile_version_id is not null or v_cycle not in ('monthly','yearly','one_time') then raise exception 'Add-on price requires add-on version and valid cycle' using errcode='22023'; end if;
    v_charge_type:='addon';
  else
    if p_addon_version_id is not null or v_cycle not in ('monthly','yearly') then raise exception 'Additional-staff price requires a recurring billing cycle' using errcode='22023'; end if;
    v_charge_type:='additional_staff';
  end if;

  if p_commercial_tax_profile_version_id is not null then
    select t.* into strict v_tax from public.sellertray_commercial_tax_profile_versions t where t.id=p_commercial_tax_profile_version_id;
    if v_tax.effective_from>p_effective_from or (v_tax.effective_until is not null and v_tax.effective_until<=p_effective_from) then raise exception 'Commercial tax profile is not effective for this price' using errcode='23514'; end if;
    v_tax_rate:=v_tax.rate_percent;
    v_net:=round((v_gross/(1+(v_tax_rate/100)))::numeric,2);
    v_tax_amount:=v_gross-v_net;
  end if;

  begin
    insert into public.sellertray_commercial_price_versions(
      price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
      currency,gross_amount,tax_inclusive,net_amount,tax_rate_percent,tax_amount,
      commercial_tax_profile_version_id,effective_from,effective_until,status,change_reason,
      created_by_user_id,approved_by_user_id,approved_at,price_scope
    ) values(
      v_kind,v_charge_type,null,p_plan_profile_version_id,p_addon_version_id,v_cycle,
      v_currency,v_gross,true,v_net,v_tax_rate,v_tax_amount,
      p_commercial_tax_profile_version_id,p_effective_from,p_effective_until,'published',v_reason,
      p_actor_user_id,p_actor_user_id,now(),'standard'
    ) returning id into v_id;
  exception when unique_violation then
    select p.id into v_id from public.sellertray_commercial_price_versions p
    where p.price_scope='standard' and p.price_kind=v_kind and p.plan_code is null
      and p.plan_profile_version_id is not distinct from p_plan_profile_version_id
      and p.addon_version_id is not distinct from p_addon_version_id
      and p.billing_cycle is not distinct from v_cycle and p.currency=v_currency
      and p.effective_from=p_effective_from and p.effective_until is not distinct from p_effective_until
      and p.gross_amount=v_gross and p.commercial_tax_profile_version_id is not distinct from p_commercial_tax_profile_version_id
      and p.change_reason=v_reason;
    if v_id is null then raise exception 'Existing Commercial V2 price conflicts with this request' using errcode='23505'; end if;
  end;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_commercial_v2_price',jsonb_build_object(
    'priceVersionId',v_id,'priceKind',v_kind,'chargeTypeCode',v_charge_type,
    'planProfileVersionId',p_plan_profile_version_id,'addonVersionId',p_addon_version_id,
    'billingCycle',v_cycle,'currency',v_currency,'grossAmount',v_gross,
    'commercialTaxProfileVersionId',p_commercial_tax_profile_version_id,
    'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,'reason',v_reason
  ));
  return v_id;
end;
$function$;

create or replace function public.publish_sellertray_commercial_v2_price_override_admin(
  p_tenant_id uuid,
  p_source_standard_price_version_id uuid,
  p_gross_amount numeric,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_reason text:=btrim(coalesce(p_reason,''));
  v_gross numeric(18,2):=round(coalesce(p_gross_amount,0)::numeric,2);
  v_source public.sellertray_commercial_price_versions%rowtype;
  v_net numeric(18,2);
  v_tax_amount numeric(18,2);
  v_id uuid;
begin
  if p_tenant_id is null or not exists(select 1 from public.tenants t where t.id=p_tenant_id) then raise exception 'Business not found' using errcode='P0002'; end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()) then raise exception 'Business pricing management capability required' using errcode='42501'; end if;
  select p.* into strict v_source from public.sellertray_commercial_price_versions p where p.id=p_source_standard_price_version_id;
  if v_source.price_scope<>'standard' or v_source.plan_code is not null then raise exception 'Commercial V2 override requires a standard Commercial V2 price version' using errcode='22023'; end if;
  if v_gross<=0 or p_effective_from is null or (p_effective_until is not null and p_effective_until<=p_effective_from) then raise exception 'Positive override amount and valid effective window are required' using errcode='22023'; end if;
  if v_source.effective_from>p_effective_from or (v_source.effective_until is not null and v_source.effective_until<=p_effective_from) then raise exception 'Source standard price is not effective for this override' using errcode='23514'; end if;
  if char_length(v_reason) not between 6 and 1000 then raise exception 'Commercial override reason must be between 6 and 1000 characters' using errcode='22023'; end if;

  if v_source.tax_rate_percent is not null then
    v_net:=round((v_gross/(1+(v_source.tax_rate_percent/100)))::numeric,2);
    v_tax_amount:=v_gross-v_net;
  end if;

  begin
    insert into public.sellertray_commercial_price_versions(
      price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
      currency,gross_amount,tax_inclusive,net_amount,tax_rate_percent,tax_amount,
      commercial_tax_profile_version_id,effective_from,effective_until,status,change_reason,
      created_by_user_id,approved_by_user_id,approved_at,tenant_id,price_scope,source_standard_price_version_id
    ) values(
      v_source.price_kind,v_source.charge_type_code,null,v_source.plan_profile_version_id,v_source.addon_version_id,v_source.billing_cycle,
      v_source.currency,v_gross,true,v_net,v_source.tax_rate_percent,v_tax_amount,
      v_source.commercial_tax_profile_version_id,p_effective_from,p_effective_until,'published',v_reason,
      p_actor_user_id,p_actor_user_id,now(),p_tenant_id,'merchant_override',v_source.id
    ) returning id into v_id;
  exception when unique_violation then
    select p.id into v_id from public.sellertray_commercial_price_versions p
    where p.price_scope='merchant_override' and p.tenant_id=p_tenant_id
      and p.source_standard_price_version_id=v_source.id
      and p.effective_from=p_effective_from and p.effective_until is not distinct from p_effective_until
      and p.gross_amount=v_gross and p.change_reason=v_reason;
    if v_id is null then raise exception 'Existing Business Commercial V2 price override conflicts with this request' using errcode='23505'; end if;
  end;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'sellertray_publish_commercial_v2_price_override',jsonb_build_object(
    'priceVersionId',v_id,'sourceStandardPriceVersionId',v_source.id,'grossAmount',v_gross,
    'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,'reason',v_reason
  ));
  return v_id;
end;
$function$;

revoke all on function public.publish_sellertray_commercial_v2_price_admin(text,uuid,uuid,text,text,numeric,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_commercial_v2_price_override_admin(uuid,uuid,numeric,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_commercial_v2_price_admin(text,uuid,uuid,text,text,numeric,uuid,timestamptz,timestamptz,text,uuid) to service_role;
grant execute on function public.publish_sellertray_commercial_v2_price_override_admin(uuid,uuid,numeric,timestamptz,timestamptz,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Extend installment policy authority to Plan Profile Versions
-- ---------------------------------------------------------------------------

alter table public.sellertray_installment_policy_versions
  add column if not exists plan_profile_version_id uuid;

alter table public.sellertray_installment_policy_versions
  add constraint sellertray_installment_policy_plan_profile_version_fkey
    foreign key (plan_profile_version_id) references public.sellertray_plan_profile_versions(id) on delete restrict,
  drop constraint sellertray_installment_policy_scope_kind_check,
  add constraint sellertray_installment_policy_scope_kind_check
    check (scope_kind in ('platform','plan_cycle','plan_profile_cycle','tenant','commercial_order')),
  drop constraint sellertray_installment_policy_scope_shape_check,
  add constraint sellertray_installment_policy_scope_shape_check
    check (
      (scope_kind='platform' and tenant_id is null and commercial_order_id is null and plan_code is null and plan_profile_version_id is null and billing_cycle is not null)
      or
      (scope_kind='plan_cycle' and tenant_id is null and commercial_order_id is null and plan_code is not null and plan_profile_version_id is null and billing_cycle is not null)
      or
      (scope_kind='plan_profile_cycle' and tenant_id is null and commercial_order_id is null and plan_code is null and plan_profile_version_id is not null and billing_cycle is not null)
      or
      (scope_kind='tenant' and tenant_id is not null and commercial_order_id is null and plan_code is null and plan_profile_version_id is null and billing_cycle is not null)
      or
      (scope_kind='commercial_order' and tenant_id is not null and commercial_order_id is not null and plan_code is null and plan_profile_version_id is null and billing_cycle is null)
    );

create index sellertray_installment_policy_plan_profile_idx
  on public.sellertray_installment_policy_versions(plan_profile_version_id,billing_cycle,effective_from desc)
  where plan_profile_version_id is not null;

create or replace function public.validate_sellertray_installment_policy_plan_profile()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_profile public.sellertray_plan_profile_versions%rowtype;
begin
  if new.scope_kind='plan_profile_cycle' then
    select v.* into strict v_profile from public.sellertray_plan_profile_versions v where v.id=new.plan_profile_version_id;
    if v_profile.status<>'published' or v_profile.effective_from>new.effective_from or (v_profile.effective_until is not null and v_profile.effective_until<=new.effective_from) then
      raise exception 'Installment policy requires a published effective Plan Profile Version' using errcode='23514';
    end if;
    if not (new.billing_cycle=any(v_profile.allowed_billing_cycles)) then
      raise exception 'Installment policy billing cycle is not allowed by the Plan Profile Version' using errcode='23514';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_sellertray_installment_policy_plan_profile() from public,anon,authenticated;
create trigger validate_sellertray_installment_policy_plan_profile
before insert on public.sellertray_installment_policy_versions
for each row execute function public.validate_sellertray_installment_policy_plan_profile();

create or replace function public.resolve_sellertray_installment_policy_v2(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_plan_profile_version_id uuid,
  p_billing_cycle text,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  with candidates as (
    select p.*,
      case p.scope_kind
        when 'commercial_order' then 400
        when 'tenant' then 300
        when 'plan_profile_cycle' then 200
        else 100
      end as precedence
    from public.sellertray_installment_policy_versions p
    where p.effective_from<=p_as_of and (p.effective_until is null or p.effective_until>p_as_of)
      and (
        (p.scope_kind='commercial_order' and p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id)
        or (p.scope_kind='tenant' and p.tenant_id=p_tenant_id and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='plan_profile_cycle' and p.plan_profile_version_id=p_plan_profile_version_id and p.billing_cycle=p_billing_cycle)
        or (p.scope_kind='platform' and p.billing_cycle=p_billing_cycle)
      )
  )
  select jsonb_build_object(
    'policyVersionId',c.id,'scopeKind',c.scope_kind,'enabled',c.enabled,
    'defaultTemplateId',c.default_template_id,'planProfileVersionId',c.plan_profile_version_id,
    'effectiveFrom',c.effective_from,'effectiveUntil',c.effective_until
  )
  from candidates c
  order by c.precedence desc,c.effective_from desc,c.created_at desc,c.id desc
  limit 1;
$function$;

revoke all on function public.resolve_sellertray_installment_policy_v2(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.resolve_sellertray_installment_policy_v2(uuid,uuid,uuid,text,timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS / ACL boundary
-- ---------------------------------------------------------------------------

do $acl$
declare
  v_table text;
begin
  foreach v_table in array array[
    'sellertray_commercial_charge_types','sellertray_commercial_tax_profiles','sellertray_commercial_tax_profile_versions',
    'sellertray_commercial_payment_methods','sellertray_commercial_payment_method_versions',
    'sellertray_commercial_adjustment_types','sellertray_commercial_entitlement_override_versions'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on table public.%I from public,anon,authenticated',v_table);
    execute format('grant select,insert,update,delete on table public.%I to service_role',v_table);
  end loop;
end
$acl$;

commit;
