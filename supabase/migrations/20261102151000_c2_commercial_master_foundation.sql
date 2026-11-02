begin;

-- SellerTray C2-3 Commercial Configuration Master Foundation
--
-- Additive only. This migration introduces the governed Commercial V2 master
-- vocabulary. It does not rewrite C1 commercial history, alter runtime access,
-- or switch any merchant surface to Commercial V2.

create table public.sellertray_commercial_charge_types (
  code text primary key,
  display_name text not null,
  description text not null,
  charge_family text not null,
  billing_behavior text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint sellertray_commercial_charge_types_code_check check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_commercial_charge_types_name_check check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_commercial_charge_types_description_check check (char_length(btrim(description)) between 1 and 1000),
  constraint sellertray_commercial_charge_types_family_check check (charge_family in ('subscription','setup','addon','staff','other')),
  constraint sellertray_commercial_charge_types_behavior_check check (billing_behavior in ('recurring','one_time','usage')),
  constraint sellertray_commercial_charge_types_status_check check (status in ('active','retired'))
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
  constraint sellertray_commercial_tax_profiles_code_check check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_commercial_tax_profiles_name_check check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_commercial_tax_profiles_status_check check (status in ('active','retired'))
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

create or replace function public.create_sellertray_commercial_tax_profile_admin(
  p_code text,
  p_display_name text,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_code text:=lower(btrim(coalesce(p_code,'')));
  v_name text:=btrim(coalesce(p_display_name,''));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_id uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.commercial_tax.manage',null,now()) then
    raise exception 'Commercial tax management capability required' using errcode='42501';
  end if;
  if v_code!~'^[a-z][a-z0-9_]{1,63}$' or char_length(v_name) not between 1 and 120 or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Valid tax profile code, name and reason are required' using errcode='22023';
  end if;
  insert into public.sellertray_commercial_tax_profiles(code,display_name,created_by_user_id)
  values(v_code,v_name,p_actor_user_id)
  on conflict (code) do nothing returning id into v_id;
  if v_id is null then
    select p.id into v_id from public.sellertray_commercial_tax_profiles p where p.code=v_code and p.display_name=v_name;
    if v_id is null then raise exception 'Existing commercial tax profile conflicts with this request' using errcode='23505'; end if;
    return v_id;
  end if;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_create_commercial_tax_profile',jsonb_build_object('taxProfileId',v_id,'code',v_code,'displayName',v_name,'reason',v_reason));
  return v_id;
end;
$function$;

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
  if jsonb_typeof(coalesce(p_configuration,'{}'::jsonb))<>'object' then raise exception 'Payment method configuration must be an object' using errcode='22023'; end if;
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

revoke all on function public.create_sellertray_commercial_tax_profile_admin(text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_commercial_tax_profile_version_admin(uuid,numeric,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_commercial_payment_method_version_admin(uuid,text,text,text,text,text,jsonb,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.create_sellertray_commercial_tax_profile_admin(text,text,text,uuid) to service_role;
grant execute on function public.publish_sellertray_commercial_tax_profile_version_admin(uuid,numeric,timestamptz,timestamptz,text,uuid) to service_role;
grant execute on function public.publish_sellertray_commercial_payment_method_version_admin(uuid,text,text,text,text,text,jsonb,timestamptz,timestamptz,text,uuid) to service_role;

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
