begin;

-- C2-2/C2-3 foundation hardening.
-- Close retry and immutable-version gaps before any Admin or merchant surface
-- can consume the new Commercial V2 foundations.

-- ---------------------------------------------------------------------------
-- 1. Plan/add-on version identity and grant immutability
-- ---------------------------------------------------------------------------

create or replace function public.guard_sellertray_plan_profile_version_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if tg_op='DELETE' then raise exception 'SellerTray Plan Profile version history is immutable' using errcode='55000'; end if;
  if new.id is distinct from old.id or new.plan_profile_id is distinct from old.plan_profile_id
     or new.version is distinct from old.version or new.created_at is distinct from old.created_at
     or new.created_by_user_id is distinct from old.created_by_user_id then
    raise exception 'SellerTray Plan Profile version identity is immutable' using errcode='55000';
  end if;
  if old.status='retired' then raise exception 'Retired SellerTray Plan Profile versions are immutable' using errcode='55000'; end if;
  if old.status='published' then
    if new.status<>'retired'
       or (to_jsonb(new)-array['status','effective_until','retired_by_user_id','retired_at','retirement_reason'])
          is distinct from
          (to_jsonb(old)-array['status','effective_until','retired_by_user_id','retired_at','retirement_reason']) then
      raise exception 'Published SellerTray Plan Profile content is immutable' using errcode='55000';
    end if;
  elsif old.status='draft' and new.status not in ('draft','published') then
    raise exception 'Draft SellerTray Plan Profile version may only remain draft or be published' using errcode='23514';
  end if;
  return new;
end;
$function$;

create or replace function public.guard_sellertray_addon_version_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if tg_op='DELETE' then raise exception 'SellerTray add-on version history is immutable' using errcode='55000'; end if;
  if new.id is distinct from old.id or new.addon_definition_id is distinct from old.addon_definition_id
     or new.version is distinct from old.version or new.created_at is distinct from old.created_at
     or new.created_by_user_id is distinct from old.created_by_user_id then
    raise exception 'SellerTray add-on version identity is immutable' using errcode='55000';
  end if;
  if old.status='retired' then raise exception 'Retired SellerTray add-on versions are immutable' using errcode='55000'; end if;
  if old.status='published' then
    if new.status<>'retired'
       or (to_jsonb(new)-array['status','effective_until','retired_by_user_id','retired_at','retirement_reason'])
          is distinct from
          (to_jsonb(old)-array['status','effective_until','retired_by_user_id','retired_at','retirement_reason']) then
      raise exception 'Published SellerTray add-on content is immutable' using errcode='55000';
    end if;
  elsif old.status='draft' and new.status not in ('draft','published') then
    raise exception 'Draft SellerTray add-on version may only remain draft or be published' using errcode='23514';
  end if;
  return new;
end;
$function$;

create or replace function public.guard_sellertray_profile_grant_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_old_status text;
  v_new_status text;
begin
  if tg_table_name like 'sellertray_plan_profile_%' then
    if tg_op in ('UPDATE','DELETE') then
      select v.status into v_old_status from public.sellertray_plan_profile_versions v where v.id=old.plan_profile_version_id;
    end if;
    if tg_op in ('INSERT','UPDATE') then
      select v.status into v_new_status from public.sellertray_plan_profile_versions v where v.id=new.plan_profile_version_id;
    end if;
  else
    if tg_op in ('UPDATE','DELETE') then
      select v.status into v_old_status from public.sellertray_addon_versions v where v.id=old.addon_version_id;
    end if;
    if tg_op in ('INSERT','UPDATE') then
      select v.status into v_new_status from public.sellertray_addon_versions v where v.id=new.addon_version_id;
    end if;
  end if;

  if (tg_op in ('UPDATE','DELETE') and v_old_status is distinct from 'draft')
     or (tg_op in ('INSERT','UPDATE') and v_new_status is distinct from 'draft') then
    raise exception 'Published or retired entitlement grants are immutable' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$function$;

-- A Plan Profile must have actual governed entitlement content before it can be
-- published. Candidate/retired catalogue items cannot enter a published plan.
create or replace function public.publish_sellertray_plan_profile_version_admin(
  p_plan_profile_version_id uuid,
  p_effective_from timestamptz,
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
  v_result uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.plans.manage',null,now()) then raise exception 'Plan Profile management capability required' using errcode='42501'; end if;
  if p_effective_from is null or char_length(v_reason) not between 6 and 1000 then raise exception 'Effective time and a reason between 6 and 1000 characters are required' using errcode='22023'; end if;

  if exists(select 1 from public.sellertray_plan_profile_versions v where v.id=p_plan_profile_version_id and v.status='published' and v.effective_from=p_effective_from and v.change_reason=v_reason) then
    return p_plan_profile_version_id;
  end if;
  if not exists(select 1 from public.sellertray_plan_profile_versions v where v.id=p_plan_profile_version_id and v.status='draft') then raise exception 'Draft Plan Profile version not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.sellertray_plan_profile_feature_grants g where g.plan_profile_version_id=p_plan_profile_version_id and g.enabled)
     and not exists(select 1 from public.sellertray_plan_profile_capability_grants g where g.plan_profile_version_id=p_plan_profile_version_id and g.enabled)
     and not exists(select 1 from public.sellertray_plan_profile_limit_values g where g.plan_profile_version_id=p_plan_profile_version_id) then
    raise exception 'Plan Profile version requires governed entitlement content before publication' using errcode='23514';
  end if;
  if exists(
    select 1 from public.sellertray_plan_profile_feature_grants g join public.sellertray_feature_catalogue c on c.code=g.feature_code
    where g.plan_profile_version_id=p_plan_profile_version_id and c.status<>'active'
  ) or exists(
    select 1 from public.sellertray_plan_profile_capability_grants g join public.sellertray_capability_catalogue c on c.code=g.capability_code
    where g.plan_profile_version_id=p_plan_profile_version_id and c.status<>'active'
  ) or exists(
    select 1 from public.sellertray_plan_profile_limit_values g join public.sellertray_limit_definitions c on c.code=g.limit_code
    where g.plan_profile_version_id=p_plan_profile_version_id and c.status<>'active'
  ) then
    raise exception 'Plan Profile version references catalogue entries that are not active' using errcode='23514';
  end if;

  update public.sellertray_plan_profile_versions v
  set status='published',effective_from=p_effective_from,change_reason=v_reason,
      published_by_user_id=p_actor_user_id,published_at=now()
  where v.id=p_plan_profile_version_id and v.status='draft'
  returning v.id into v_result;
  if v_result is null then raise exception 'Plan Profile publication conflicted with another change' using errcode='40001'; end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_plan_profile_version',jsonb_build_object('planProfileVersionId',v_result,'effectiveFrom',p_effective_from,'reason',v_reason));
  return v_result;
end;
$function$;

create or replace function public.create_sellertray_addon_definition_admin(
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
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.plans.manage',null,now()) then raise exception 'Plan Profile management capability required' using errcode='42501'; end if;
  if v_code!~'^[a-z][a-z0-9_]{1,63}$' or char_length(v_name) not between 1 and 120 or char_length(v_reason) not between 6 and 1000 then raise exception 'Valid add-on code, name and reason are required' using errcode='22023'; end if;
  insert into public.sellertray_addon_definitions(code,default_display_name,created_by_user_id)
  values(v_code,v_name,p_actor_user_id)
  on conflict(code) do nothing returning id into v_id;
  if v_id is null then
    select a.id into v_id from public.sellertray_addon_definitions a where a.code=v_code and a.default_display_name=v_name;
    if v_id is null then raise exception 'Existing add-on definition conflicts with this request' using errcode='23505'; end if;
    return v_id;
  end if;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_create_addon_definition',jsonb_build_object('addonDefinitionId',v_id,'code',v_code,'displayName',v_name,'reason',v_reason));
  return v_id;
end;
$function$;

create or replace function public.publish_sellertray_addon_version_admin(
  p_addon_version_id uuid,
  p_effective_from timestamptz,
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
  v_result uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.plans.manage',null,now()) then raise exception 'Plan Profile management capability required' using errcode='42501'; end if;
  if p_effective_from is null or char_length(v_reason) not between 6 and 1000 then raise exception 'Effective time and a reason between 6 and 1000 characters are required' using errcode='22023'; end if;
  if exists(select 1 from public.sellertray_addon_versions v where v.id=p_addon_version_id and v.status='published' and v.effective_from=p_effective_from and v.change_reason=v_reason) then return p_addon_version_id; end if;
  if not exists(select 1 from public.sellertray_addon_versions v where v.id=p_addon_version_id and v.status='draft') then raise exception 'Draft add-on version not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.sellertray_addon_feature_grants g where g.addon_version_id=p_addon_version_id and g.enabled)
     and not exists(select 1 from public.sellertray_addon_capability_grants g where g.addon_version_id=p_addon_version_id and g.enabled)
     and not exists(select 1 from public.sellertray_addon_limit_values g where g.addon_version_id=p_addon_version_id) then
    raise exception 'Add-on version requires governed entitlement content before publication' using errcode='23514';
  end if;
  update public.sellertray_addon_versions v
  set status='published',effective_from=p_effective_from,change_reason=v_reason,published_by_user_id=p_actor_user_id,published_at=now()
  where v.id=p_addon_version_id and v.status='draft' returning v.id into v_result;
  if v_result is null then raise exception 'Add-on publication conflicted with another change' using errcode='40001'; end if;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_addon_version',jsonb_build_object('addonVersionId',v_result,'effectiveFrom',p_effective_from,'reason',v_reason));
  return v_result;
end;
$function$;

create or replace function public.retire_sellertray_addon_version_admin(
  p_addon_version_id uuid,
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
  v_from timestamptz;
  v_result uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.plans.manage',null,now()) then raise exception 'Plan Profile management capability required' using errcode='42501'; end if;
  select effective_from into v_from from public.sellertray_addon_versions where id=p_addon_version_id;
  if v_from is null or p_effective_until is null or p_effective_until<=v_from or char_length(v_reason) not between 6 and 1000 then raise exception 'Valid retirement time and reason are required' using errcode='22023'; end if;
  if exists(select 1 from public.sellertray_addon_versions v where v.id=p_addon_version_id and v.status='retired' and v.effective_until=p_effective_until and v.retirement_reason=v_reason) then return p_addon_version_id; end if;
  update public.sellertray_addon_versions v
  set status='retired',effective_until=p_effective_until,retired_by_user_id=p_actor_user_id,retired_at=now(),retirement_reason=v_reason
  where v.id=p_addon_version_id and v.status='published' returning v.id into v_result;
  if v_result is null then raise exception 'Published add-on version not found' using errcode='P0002'; end if;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_retire_addon_version',jsonb_build_object('addonVersionId',v_result,'effectiveUntil',p_effective_until,'reason',v_reason));
  return v_result;
end;
$function$;

revoke all on function public.create_sellertray_addon_definition_admin(text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.retire_sellertray_addon_version_admin(uuid,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.create_sellertray_addon_definition_admin(text,text,text,uuid) to service_role;
grant execute on function public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid) to service_role;
grant execute on function public.retire_sellertray_addon_version_admin(uuid,timestamptz,text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Retry-safe version publication for commercial tax/payment masters
-- ---------------------------------------------------------------------------

alter table public.sellertray_commercial_tax_profile_versions add column command_id uuid;
alter table public.sellertray_commercial_payment_method_versions add column command_id uuid;
alter table public.sellertray_commercial_tax_profile_versions alter column command_id set not null;
alter table public.sellertray_commercial_payment_method_versions alter column command_id set not null;
create unique index sellertray_commercial_tax_profile_version_command_key on public.sellertray_commercial_tax_profile_versions(command_id);
create unique index sellertray_commercial_payment_method_version_command_key on public.sellertray_commercial_payment_method_versions(command_id);

drop function public.publish_sellertray_commercial_tax_profile_version_admin(uuid,numeric,timestamptz,timestamptz,text,uuid);
drop function public.publish_sellertray_commercial_payment_method_version_admin(uuid,text,text,text,text,text,jsonb,timestamptz,timestamptz,text,uuid);

create or replace function public.publish_sellertray_commercial_tax_profile_version_admin(
  p_tax_profile_id uuid,
  p_rate_percent numeric,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_reason text:=btrim(coalesce(p_reason,''));
  v_existing public.sellertray_commercial_tax_profile_versions%rowtype;
  v_version integer;
  v_id uuid;
begin
  if p_command_id is null then raise exception 'Commercial tax publication command id is required' using errcode='22023'; end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.commercial_tax.manage',null,now()) then raise exception 'Commercial tax management capability required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-tax-command|'||p_command_id::text,0));
  select v.* into v_existing from public.sellertray_commercial_tax_profile_versions v where v.command_id=p_command_id;
  if found then
    if v_existing.tax_profile_id=p_tax_profile_id and v_existing.rate_percent=p_rate_percent
       and v_existing.effective_from=p_effective_from and v_existing.effective_until is not distinct from p_effective_until
       and v_existing.change_reason=v_reason and v_existing.created_by_user_id=p_actor_user_id then return v_existing.id; end if;
    raise exception 'Commercial tax publication command id already belongs to different facts' using errcode='23505';
  end if;
  if p_tax_profile_id is null or not exists(select 1 from public.sellertray_commercial_tax_profiles p where p.id=p_tax_profile_id and p.status='active') then raise exception 'Active commercial tax profile not found' using errcode='P0002'; end if;
  if p_rate_percent is null or p_rate_percent<0 or p_rate_percent>100 or p_effective_from is null or (p_effective_until is not null and p_effective_until<=p_effective_from) then raise exception 'Valid tax rate and effective window are required' using errcode='22023'; end if;
  if char_length(v_reason) not between 6 and 1000 then raise exception 'Commercial tax change reason must be between 6 and 1000 characters' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-tax-profile|'||p_tax_profile_id::text,0));
  select coalesce(max(v.version),0)+1 into v_version from public.sellertray_commercial_tax_profile_versions v where v.tax_profile_id=p_tax_profile_id;
  insert into public.sellertray_commercial_tax_profile_versions(tax_profile_id,version,rate_percent,tax_inclusive,effective_from,effective_until,change_reason,created_by_user_id,command_id)
  values(p_tax_profile_id,v_version,p_rate_percent,true,p_effective_from,p_effective_until,v_reason,p_actor_user_id,p_command_id) returning id into v_id;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_commercial_tax_profile_version',jsonb_build_object('commandId',p_command_id,'taxProfileId',p_tax_profile_id,'taxProfileVersionId',v_id,'version',v_version,'ratePercent',p_rate_percent,'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,'reason',v_reason));
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
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_reason text:=btrim(coalesce(p_reason,''));
  v_config jsonb:=coalesce(p_configuration,'{}'::jsonb);
  v_existing public.sellertray_commercial_payment_method_versions%rowtype;
  v_version integer;
  v_id uuid;
begin
  if p_command_id is null then raise exception 'Commercial payment-method publication command id is required' using errcode='22023'; end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.commercial_payment_methods.manage',null,now()) then raise exception 'Commercial payment-method management capability required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-payment-method-command|'||p_command_id::text,0));
  select v.* into v_existing from public.sellertray_commercial_payment_method_versions v where v.command_id=p_command_id;
  if found then
    if v_existing.payment_method_id=p_payment_method_id and v_existing.display_name=btrim(p_display_name)
       and v_existing.method_type=p_method_type and v_existing.confirmation_mode=p_confirmation_mode
       and v_existing.provider_code is not distinct from nullif(lower(btrim(coalesce(p_provider_code,''))),'')
       and v_existing.instructions is not distinct from nullif(btrim(coalesce(p_instructions,'')),'')
       and v_existing.configuration=v_config and v_existing.effective_from=p_effective_from
       and v_existing.effective_until is not distinct from p_effective_until and v_existing.change_reason=v_reason
       and v_existing.created_by_user_id=p_actor_user_id then return v_existing.id; end if;
    raise exception 'Commercial payment-method publication command id already belongs to different facts' using errcode='23505';
  end if;
  if p_payment_method_id is null or not exists(select 1 from public.sellertray_commercial_payment_methods p where p.id=p_payment_method_id and p.status='active') then raise exception 'Active commercial payment method not found' using errcode='P0002'; end if;
  if char_length(btrim(coalesce(p_display_name,''))) not between 1 and 120 or p_effective_from is null or (p_effective_until is not null and p_effective_until<=p_effective_from) then raise exception 'Display name and valid effective window are required' using errcode='22023'; end if;
  if p_method_type not in ('bank_transfer','paystack','flutterwave','manual','other') or p_confirmation_mode not in ('automatic','manual_verification','manual_confirmation') then raise exception 'Unsupported commercial payment method configuration' using errcode='22023'; end if;
  if jsonb_typeof(v_config)<>'object' or char_length(v_reason) not between 6 and 1000 then raise exception 'Valid payment configuration and change reason are required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-commercial-payment-method|'||p_payment_method_id::text,0));
  select coalesce(max(v.version),0)+1 into v_version from public.sellertray_commercial_payment_method_versions v where v.payment_method_id=p_payment_method_id;
  insert into public.sellertray_commercial_payment_method_versions(payment_method_id,version,display_name,method_type,confirmation_mode,provider_code,instructions,configuration,effective_from,effective_until,change_reason,created_by_user_id,command_id)
  values(p_payment_method_id,v_version,btrim(p_display_name),p_method_type,p_confirmation_mode,nullif(lower(btrim(coalesce(p_provider_code,''))),''),nullif(btrim(coalesce(p_instructions,'')),''),v_config,p_effective_from,p_effective_until,v_reason,p_actor_user_id,p_command_id) returning id into v_id;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_commercial_payment_method_version',jsonb_build_object('commandId',p_command_id,'paymentMethodId',p_payment_method_id,'paymentMethodVersionId',v_id,'version',v_version,'methodType',p_method_type,'confirmationMode',p_confirmation_mode,'providerCode',p_provider_code,'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,'reason',v_reason));
  return v_id;
end;
$function$;

revoke all on function public.publish_sellertray_commercial_tax_profile_version_admin(uuid,numeric,timestamptz,timestamptz,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_commercial_payment_method_version_admin(uuid,text,text,text,text,text,jsonb,timestamptz,timestamptz,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_commercial_tax_profile_version_admin(uuid,numeric,timestamptz,timestamptz,text,uuid,uuid) to service_role;
grant execute on function public.publish_sellertray_commercial_payment_method_version_admin(uuid,text,text,text,text,text,jsonb,timestamptz,timestamptz,text,uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Retry-safe C2 price publication wrappers
-- ---------------------------------------------------------------------------

create table public.sellertray_commercial_price_publication_commands (
  command_id uuid primary key,
  operation text not null,
  tenant_id uuid references public.tenants(id) on delete restrict,
  price_version_id uuid not null references public.sellertray_commercial_price_versions(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  facts jsonb not null,
  created_at timestamptz not null default now(),
  constraint sellertray_commercial_price_publication_commands_operation_check check (operation in ('standard','merchant_override')),
  constraint sellertray_commercial_price_publication_commands_facts_check check (jsonb_typeof(facts)='object')
);
create trigger prevent_sellertray_commercial_price_publication_command_mutation
before update or delete on public.sellertray_commercial_price_publication_commands
for each row execute function public.prevent_sellertray_commercial_history_mutation();
alter table public.sellertray_commercial_price_publication_commands enable row level security;
revoke all on table public.sellertray_commercial_price_publication_commands from public,anon,authenticated;
grant select,insert on table public.sellertray_commercial_price_publication_commands to service_role;

revoke execute on function public.publish_sellertray_commercial_v2_price_admin(text,uuid,uuid,text,text,numeric,uuid,timestamptz,timestamptz,text,uuid) from service_role;
revoke execute on function public.publish_sellertray_commercial_v2_price_override_admin(uuid,uuid,numeric,timestamptz,timestamptz,text,uuid) from service_role;

create or replace function public.publish_sellertray_commercial_v2_price_admin(
  p_price_kind text,p_plan_profile_version_id uuid,p_addon_version_id uuid,p_billing_cycle text,
  p_currency text,p_gross_amount numeric,p_commercial_tax_profile_version_id uuid,
  p_effective_from timestamptz,p_effective_until timestamptz,p_reason text,
  p_command_id uuid,p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_facts jsonb;
  v_existing public.sellertray_commercial_price_publication_commands%rowtype;
  v_id uuid;
begin
  if p_command_id is null then raise exception 'Commercial price publication command id is required' using errcode='22023'; end if;
  v_facts:=jsonb_build_object('priceKind',p_price_kind,'planProfileVersionId',p_plan_profile_version_id,'addonVersionId',p_addon_version_id,'billingCycle',p_billing_cycle,'currency',p_currency,'grossAmount',p_gross_amount,'commercialTaxProfileVersionId',p_commercial_tax_profile_version_id,'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,'reason',btrim(coalesce(p_reason,'')));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-price-publish-command|'||p_command_id::text,0));
  select c.* into v_existing from public.sellertray_commercial_price_publication_commands c where c.command_id=p_command_id;
  if found then
    if v_existing.operation='standard' and v_existing.tenant_id is null and v_existing.actor_user_id=p_actor_user_id and v_existing.facts=v_facts then return v_existing.price_version_id; end if;
    raise exception 'Commercial price publication command id already belongs to different facts' using errcode='23505';
  end if;
  v_id:=public.publish_sellertray_commercial_v2_price_admin(p_price_kind,p_plan_profile_version_id,p_addon_version_id,p_billing_cycle,p_currency,p_gross_amount,p_commercial_tax_profile_version_id,p_effective_from,p_effective_until,p_reason,p_actor_user_id);
  insert into public.sellertray_commercial_price_publication_commands(command_id,operation,price_version_id,actor_user_id,facts)
  values(p_command_id,'standard',v_id,p_actor_user_id,v_facts);
  return v_id;
end;
$function$;

create or replace function public.publish_sellertray_commercial_v2_price_override_admin(
  p_tenant_id uuid,p_source_standard_price_version_id uuid,p_gross_amount numeric,
  p_effective_from timestamptz,p_effective_until timestamptz,p_reason text,
  p_command_id uuid,p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_facts jsonb;
  v_existing public.sellertray_commercial_price_publication_commands%rowtype;
  v_id uuid;
begin
  if p_command_id is null then raise exception 'Business price-override publication command id is required' using errcode='22023'; end if;
  v_facts:=jsonb_build_object('tenantId',p_tenant_id,'sourceStandardPriceVersionId',p_source_standard_price_version_id,'grossAmount',p_gross_amount,'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,'reason',btrim(coalesce(p_reason,'')));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-price-publish-command|'||p_command_id::text,0));
  select c.* into v_existing from public.sellertray_commercial_price_publication_commands c where c.command_id=p_command_id;
  if found then
    if v_existing.operation='merchant_override' and v_existing.tenant_id=p_tenant_id and v_existing.actor_user_id=p_actor_user_id and v_existing.facts=v_facts then return v_existing.price_version_id; end if;
    raise exception 'Business price-override command id already belongs to different facts' using errcode='23505';
  end if;
  v_id:=public.publish_sellertray_commercial_v2_price_override_admin(p_tenant_id,p_source_standard_price_version_id,p_gross_amount,p_effective_from,p_effective_until,p_reason,p_actor_user_id);
  insert into public.sellertray_commercial_price_publication_commands(command_id,operation,tenant_id,price_version_id,actor_user_id,facts)
  values(p_command_id,'merchant_override',p_tenant_id,v_id,p_actor_user_id,v_facts);
  return v_id;
end;
$function$;

revoke all on function public.publish_sellertray_commercial_v2_price_admin(text,uuid,uuid,text,text,numeric,uuid,timestamptz,timestamptz,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_commercial_v2_price_override_admin(uuid,uuid,numeric,timestamptz,timestamptz,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_commercial_v2_price_admin(text,uuid,uuid,text,text,numeric,uuid,timestamptz,timestamptz,text,uuid,uuid) to service_role;
grant execute on function public.publish_sellertray_commercial_v2_price_override_admin(uuid,uuid,numeric,timestamptz,timestamptz,text,uuid,uuid) to service_role;

-- The old overloads are internal implementation helpers only after this point.
revoke execute on function public.publish_sellertray_commercial_v2_price_admin(text,uuid,uuid,text,text,numeric,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.publish_sellertray_commercial_v2_price_override_admin(uuid,uuid,numeric,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;

-- Global command-id semantics for C2 price lifecycle control.
create or replace function public.control_sellertray_commercial_v2_price_version_admin(
  p_price_version_id uuid,p_action text,p_reason text,p_command_id uuid,p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_target public.sellertray_commercial_price_versions%rowtype;
  v_state text;
  v_existing_ids uuid[];
  v_existing_action_min text;
  v_existing_action_max text;
  v_existing_reason_min text;
  v_existing_reason_max text;
begin
  if p_price_version_id is null or p_command_id is null or v_action not in ('pause','resume','deactivate','void') or char_length(v_reason) not between 6 and 1000 then raise exception 'Price version, valid lifecycle action, command id and reason are required' using errcode='22023'; end if;
  select p.* into strict v_target from public.sellertray_commercial_price_versions p where p.id=p_price_version_id;
  if v_target.plan_code is not null and v_target.price_kind='subscription' then raise exception 'Legacy plan-code subscription prices remain governed by the compatibility lifecycle command' using errcode='22023'; end if;
  if v_target.price_scope='standard' then
    if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',null,now()) then raise exception 'Platform pricing management capability required' using errcode='42501'; end if;
  elsif not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',v_target.tenant_id,now()) then raise exception 'Business pricing management capability required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sellertray-price-control-command|'||p_command_id::text,0));
  select array_agg(c.price_version_id order by c.price_version_id),min(c.control_action),max(c.control_action),min(c.reason),max(c.reason)
    into v_existing_ids,v_existing_action_min,v_existing_action_max,v_existing_reason_min,v_existing_reason_max
  from public.sellertray_commercial_price_version_controls c where c.command_id=p_command_id;
  if coalesce(cardinality(v_existing_ids),0)>0 then
    if v_existing_ids=array[p_price_version_id] and v_existing_action_min=v_action and v_existing_action_max=v_action and v_existing_reason_min=v_reason and v_existing_reason_max=v_reason then
      return jsonb_build_object('priceVersionId',p_price_version_id,'action',v_action,'state',public.sellertray_commercial_price_version_state(p_price_version_id,now()),'alreadyApplied',true);
    end if;
    raise exception 'Price lifecycle command id already belongs to different facts' using errcode='23505';
  end if;
  v_state:=public.sellertray_commercial_price_version_state(p_price_version_id,now());
  if v_action='pause' and v_state<>'active' then raise exception 'Only an active price version can be paused' using errcode='23514'; end if;
  if v_action='resume' and v_state<>'paused' then raise exception 'Only a paused price version can be resumed' using errcode='23514'; end if;
  if v_action in ('deactivate','void') and v_state in ('deactivated','voided') then raise exception 'A deactivated or voided price version is terminal' using errcode='23514'; end if;
  if v_action='void' then
    if v_target.effective_from<=now() then raise exception 'Void is only allowed before a price version becomes effective' using errcode='23514'; end if;
    if exists(select 1 from public.sellertray_commercial_order_price_snapshots s where s.source_price_version_id=p_price_version_id) then raise exception 'A price version already used by an order cannot be voided' using errcode='23514'; end if;
    if exists(select 1 from public.sellertray_commercial_price_versions p where p.source_standard_price_version_id=p_price_version_id) then raise exception 'A standard price referenced by a Business override cannot be voided' using errcode='23514'; end if;
  end if;
  insert into public.sellertray_commercial_price_version_controls(price_version_id,control_action,command_id,controlled_by_user_id,effective_at,reason)
  values(p_price_version_id,v_action,p_command_id,p_actor_user_id,now(),v_reason);
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,v_target.tenant_id,'sellertray_control_commercial_v2_price_version',jsonb_build_object('priceVersionId',p_price_version_id,'controlAction',v_action,'priceKind',v_target.price_kind,'planProfileVersionId',v_target.plan_profile_version_id,'addonVersionId',v_target.addon_version_id,'commandId',p_command_id,'reason',v_reason));
  return jsonb_build_object('priceVersionId',p_price_version_id,'action',v_action,'state',public.sellertray_commercial_price_version_state(p_price_version_id,now()),'alreadyApplied',false);
end;
$function$;

commit;
