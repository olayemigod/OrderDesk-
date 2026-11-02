begin;

-- Close the remaining C2-2/C2-3 review gaps without advancing runtime cutover.
-- This migration preserves C1 compatibility, serializes publication/lifecycle
-- races, and prevents new Business overrides from deriving from withdrawn or
-- superseded standard prices.

create or replace function public.sellertray_commercial_standard_price_is_governed(
  p_price_version_id uuid,
  p_as_of timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_source public.sellertray_commercial_price_versions%rowtype;
  v_resolved uuid;
begin
  if p_price_version_id is null or p_as_of is null then
    return false;
  end if;

  select p.* into v_source
  from public.sellertray_commercial_price_versions p
  where p.id=p_price_version_id;

  if not found
     or v_source.price_scope<>'standard'
     or v_source.tenant_id is not null
     or v_source.status<>'published'
     or v_source.effective_from>p_as_of
     or (v_source.effective_until is not null and v_source.effective_until<=p_as_of)
     or public.sellertray_commercial_price_version_state(v_source.id,p_as_of)<>'active' then
    return false;
  end if;

  -- Legacy rows have no Commercial V2 charge binding. C2 rows resolve through
  -- the Plan/add-on-aware resolver. Both paths must identify this exact source.
  if v_source.charge_type_code is null then
    v_resolved:=public.resolve_sellertray_commercial_price_version(
      v_source.price_kind,
      v_source.plan_code,
      v_source.billing_cycle,
      v_source.currency,
      p_as_of
    );
  else
    v_resolved:=public.resolve_sellertray_commercial_v2_price_version(
      null,
      v_source.price_kind,
      v_source.plan_profile_version_id,
      v_source.addon_version_id,
      v_source.billing_cycle,
      v_source.currency,
      p_as_of
    );
  end if;

  return v_resolved is not distinct from v_source.id;
end;
$function$;

revoke all on function public.sellertray_commercial_standard_price_is_governed(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.sellertray_commercial_standard_price_is_governed(uuid,timestamptz)
  to service_role;

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
  v_source_check_at timestamptz;
  v_exact_retry boolean:=false;
begin
  new.currency:=upper(btrim(new.currency));
  new.change_reason:=btrim(new.change_reason);

  if new.plan_profile_version_id is not null then
    select v.* into strict v_profile
    from public.sellertray_plan_profile_versions v
    where v.id=new.plan_profile_version_id;
    if v_profile.status<>'published'
       or v_profile.effective_from>new.effective_from
       or (v_profile.effective_until is not null and v_profile.effective_until<=new.effective_from) then
      raise exception 'Commercial V2 price requires a published effective Plan Profile Version' using errcode='23514';
    end if;
    if new.billing_cycle is not null and not (new.billing_cycle=any(v_profile.allowed_billing_cycles)) then
      raise exception 'Billing cycle is not allowed by the Plan Profile Version' using errcode='23514';
    end if;
  end if;

  if new.addon_version_id is not null then
    select v.* into strict v_addon
    from public.sellertray_addon_versions v
    where v.id=new.addon_version_id;
    if v_addon.status<>'published'
       or v_addon.effective_from>new.effective_from
       or (v_addon.effective_until is not null and v_addon.effective_until<=new.effective_from) then
      raise exception 'Commercial add-on price requires a published effective add-on version' using errcode='23514';
    end if;
    if new.billing_cycle is not null and not (new.billing_cycle=any(v_addon.allowed_billing_cycles)) then
      raise exception 'Billing cycle is not allowed by the add-on version' using errcode='23514';
    end if;
  end if;

  if new.commercial_tax_profile_version_id is not null then
    select t.* into strict v_tax
    from public.sellertray_commercial_tax_profile_versions t
    where t.id=new.commercial_tax_profile_version_id;
    if v_tax.effective_from>new.effective_from
       or (v_tax.effective_until is not null and v_tax.effective_until<=new.effective_from) then
      raise exception 'Commercial tax profile version is not effective for the price version' using errcode='23514';
    end if;
    if new.tax_rate_percent is distinct from v_tax.rate_percent
       or new.tax_inclusive is distinct from v_tax.tax_inclusive then
      raise exception 'Commercial price tax snapshot must match the governed tax profile version' using errcode='23514';
    end if;
  end if;

  -- Preserve the legacy C1 10-for-12 behavior only for legacy plan-code rows.
  if new.price_kind='subscription' and new.plan_code is not null and new.billing_cycle='yearly' then
    select p.* into v_monthly
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription'
      and p.plan_code=new.plan_code
      and p.plan_profile_version_id is null
      and p.billing_cycle='monthly'
      and p.currency=new.currency
      and p.price_scope=new.price_scope
      and p.tenant_id is not distinct from new.tenant_id
      and p.status='published'
      and p.effective_from<=new.effective_from
      and (p.effective_until is null or p.effective_until>new.effective_from)
    order by p.effective_from desc,p.created_at desc
    limit 1;
    if not found then
      raise exception 'A governed monthly price must exist before a legacy yearly 10-for-12 price is published' using errcode='23514';
    end if;
    if abs(new.gross_amount-(v_monthly.gross_amount*10))>=0.005 then
      raise exception 'Legacy yearly SellerTray subscription price must equal 10 monthly periods' using errcode='23514';
    end if;
    if (new.net_amount is null) is distinct from (v_monthly.net_amount is null)
       or (new.tax_amount is null) is distinct from (v_monthly.tax_amount is null)
       or (new.tax_rate_percent is null) is distinct from (v_monthly.tax_rate_percent is null) then
      raise exception 'Legacy yearly SellerTray tax treatment must match the governed monthly price' using errcode='23514';
    end if;
    if v_monthly.net_amount is not null and (
      abs(new.net_amount-(v_monthly.net_amount*10))>=0.005
      or abs(new.tax_amount-(v_monthly.tax_amount*10))>=0.005
      or new.tax_rate_percent is distinct from v_monthly.tax_rate_percent
    ) then
      raise exception 'Legacy yearly SellerTray tax snapshot must preserve the 10-for-12 rule' using errcode='23514';
    end if;
  end if;

  if new.price_scope='merchant_override' then
    select p.* into v_source
    from public.sellertray_commercial_price_versions p
    where p.id=new.source_standard_price_version_id;

    if not found
       or v_source.price_scope<>'standard'
       or v_source.tenant_id is not null
       or v_source.price_kind<>new.price_kind
       or v_source.charge_type_code is distinct from new.charge_type_code
       or v_source.plan_code is distinct from new.plan_code
       or v_source.plan_profile_version_id is distinct from new.plan_profile_version_id
       or v_source.addon_version_id is distinct from new.addon_version_id
       or v_source.billing_cycle is distinct from new.billing_cycle
       or v_source.currency<>new.currency
       or v_source.commercial_tax_profile_version_id is distinct from new.commercial_tax_profile_version_id
       or v_source.tax_rate_percent is distinct from new.tax_rate_percent then
      raise exception 'Business price override must derive from a matching standard price version' using errcode='23514';
    end if;

    -- Preserve exact fact retries even when the source is later superseded. No
    -- new row can be created because the same natural key already exists.
    select exists(
      select 1
      from public.sellertray_commercial_price_versions p
      where p.price_scope='merchant_override'
        and p.tenant_id=new.tenant_id
        and p.price_kind=new.price_kind
        and p.charge_type_code is not distinct from new.charge_type_code
        and p.plan_code is not distinct from new.plan_code
        and p.plan_profile_version_id is not distinct from new.plan_profile_version_id
        and p.addon_version_id is not distinct from new.addon_version_id
        and p.billing_cycle is not distinct from new.billing_cycle
        and p.currency=new.currency
        and p.gross_amount=new.gross_amount
        and p.tax_inclusive=new.tax_inclusive
        and p.net_amount is not distinct from new.net_amount
        and p.tax_rate_percent is not distinct from new.tax_rate_percent
        and p.tax_amount is not distinct from new.tax_amount
        and p.commercial_tax_profile_version_id is not distinct from new.commercial_tax_profile_version_id
        and p.effective_from=new.effective_from
        and p.effective_until is not distinct from new.effective_until
        and p.status=new.status
        and p.change_reason=new.change_reason
        and p.source_standard_price_version_id=new.source_standard_price_version_id
    ) into v_exact_retry;

    if not v_exact_retry then
      v_source_check_at:=greatest(new.effective_from,clock_timestamp());
      if not public.sellertray_commercial_standard_price_is_governed(v_source.id,v_source_check_at) then
        raise exception 'Business price override source is not the active governed standard price' using errcode='23514';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_sellertray_commercial_price_version()
  from public,anon,authenticated;

-- Legacy Business Branch-setup override publication must remain compatible when
-- the shared standard source was published through the C2 price command.
create or replace function public.publish_sellertray_merchant_branch_setup_price_override_admin(
  p_tenant_id uuid,
  p_currency text,
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
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_gross numeric(18,2):=round(coalesce(p_gross_amount,0)::numeric,2);
  v_standard public.sellertray_commercial_price_versions%rowtype;
  v_net numeric(18,2);
  v_tax numeric(18,2);
  v_id uuid;
begin
  if p_tenant_id is null or not exists(select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()) then
    raise exception 'Commercial pricing management capability required' using errcode='42501';
  end if;
  if v_currency!~'^[A-Z]{3}$' or v_gross<=0 or p_effective_from is null then
    raise exception 'Business, currency, positive setup override and effective time are required' using errcode='22023';
  end if;
  if p_effective_until is not null and p_effective_until<=p_effective_from then
    raise exception 'Commercial override expiry must be after its effective time' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Commercial override reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  select p.* into strict v_standard
  from public.sellertray_commercial_price_versions p
  where p.id=public.resolve_sellertray_commercial_price_version(
    'branch_setup',null,null,v_currency,p_effective_from
  );

  if v_standard.tax_rate_percent is not null then
    v_net:=round((v_gross/(1+(v_standard.tax_rate_percent/100)))::numeric,2);
    v_tax:=v_gross-v_net;
  end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,billing_cycle,
    currency,gross_amount,tax_inclusive,net_amount,tax_rate_percent,tax_amount,
    commercial_tax_profile_version_id,effective_from,effective_until,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,
    tenant_id,price_scope,source_standard_price_version_id
  ) values (
    v_standard.price_kind,v_standard.charge_type_code,v_standard.plan_code,
    v_standard.plan_profile_version_id,v_standard.addon_version_id,v_standard.billing_cycle,
    v_currency,v_gross,v_standard.tax_inclusive,v_net,v_standard.tax_rate_percent,v_tax,
    v_standard.commercial_tax_profile_version_id,p_effective_from,p_effective_until,'published',v_reason,
    p_actor_user_id,p_actor_user_id,now(),
    p_tenant_id,'merchant_override',v_standard.id
  )
  on conflict (tenant_id,currency,effective_from)
    where price_kind='branch_setup' and price_scope='merchant_override'
  do nothing returning id into v_id;

  if v_id is null then
    select p.id into strict v_id
    from public.sellertray_commercial_price_versions p
    where p.price_scope='merchant_override'
      and p.tenant_id=p_tenant_id
      and p.price_kind='branch_setup'
      and p.currency=v_currency
      and p.effective_from=p_effective_from
      and p.effective_until is not distinct from p_effective_until
      and p.gross_amount=v_gross
      and p.source_standard_price_version_id=v_standard.id
      and p.charge_type_code is not distinct from v_standard.charge_type_code
      and p.commercial_tax_profile_version_id is not distinct from v_standard.commercial_tax_profile_version_id
      and p.change_reason=v_reason;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,p_tenant_id,'sellertray_publish_merchant_branch_setup_price_override',
    jsonb_build_object(
      'priceVersionId',v_id,
      'sourceStandardPriceVersionId',v_standard.id,
      'chargeTypeCode',v_standard.charge_type_code,
      'commercialTaxProfileVersionId',v_standard.commercial_tax_profile_version_id,
      'currency',v_currency,
      'grossAmount',v_gross,
      'effectiveFrom',p_effective_from,
      'effectiveUntil',p_effective_until,
      'reason',v_reason
    )
  );
  return v_id;
exception when no_data_found then
  raise exception 'Existing merchant Branch setup price override conflicts with this request' using errcode='23505';
end;
$function$;

revoke execute on function public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid)
  from public,anon,authenticated;
grant execute on function public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid)
  to service_role;

-- Publication must lock the parent before entitlement validation. Grant mutation
-- takes the same row lock, so whichever transaction wins forces the other to
-- re-evaluate against the committed parent/grant state.
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
  v_version public.sellertray_plan_profile_versions%rowtype;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.plans.manage',null,now()) then
    raise exception 'Plan Profile management capability required' using errcode='42501';
  end if;
  if p_effective_from is null or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Effective time and a reason between 6 and 1000 characters are required' using errcode='22023';
  end if;

  select v.* into v_version
  from public.sellertray_plan_profile_versions v
  where v.id=p_plan_profile_version_id
  for update;

  if not found then
    raise exception 'Draft Plan Profile version not found' using errcode='P0002';
  end if;
  if v_version.status='published'
     and v_version.effective_from=p_effective_from
     and v_version.change_reason=v_reason then
    return p_plan_profile_version_id;
  end if;
  if v_version.status<>'draft' then
    raise exception 'Draft Plan Profile version not found' using errcode='P0002';
  end if;

  if not exists(
      select 1 from public.sellertray_plan_profile_feature_grants g
      where g.plan_profile_version_id=p_plan_profile_version_id and g.enabled
    )
    and not exists(
      select 1 from public.sellertray_plan_profile_capability_grants g
      where g.plan_profile_version_id=p_plan_profile_version_id and g.enabled
    )
    and not exists(
      select 1 from public.sellertray_plan_profile_limit_values g
      where g.plan_profile_version_id=p_plan_profile_version_id
    ) then
    raise exception 'Plan Profile version requires governed entitlement content before publication' using errcode='23514';
  end if;

  if exists(
    select 1
    from public.sellertray_plan_profile_feature_grants g
    join public.sellertray_feature_catalogue c on c.code=g.feature_code
    where g.plan_profile_version_id=p_plan_profile_version_id and c.status<>'active'
  ) or exists(
    select 1
    from public.sellertray_plan_profile_capability_grants g
    join public.sellertray_capability_catalogue c on c.code=g.capability_code
    where g.plan_profile_version_id=p_plan_profile_version_id and c.status<>'active'
  ) or exists(
    select 1
    from public.sellertray_plan_profile_limit_values g
    join public.sellertray_limit_definitions c on c.code=g.limit_code
    where g.plan_profile_version_id=p_plan_profile_version_id and c.status<>'active'
  ) then
    raise exception 'Plan Profile version references catalogue entries that are not active' using errcode='23514';
  end if;

  update public.sellertray_plan_profile_versions v
  set status='published',effective_from=p_effective_from,change_reason=v_reason,
      published_by_user_id=p_actor_user_id,published_at=now()
  where v.id=p_plan_profile_version_id and v.status='draft'
  returning v.id into v_result;

  if v_result is null then
    raise exception 'Plan Profile publication conflicted with another change' using errcode='40001';
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,null,'sellertray_publish_plan_profile_version',
    jsonb_build_object('planProfileVersionId',v_result,'effectiveFrom',p_effective_from,'reason',v_reason)
  );
  return v_result;
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
  v_version public.sellertray_addon_versions%rowtype;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.plans.manage',null,now()) then
    raise exception 'Plan Profile management capability required' using errcode='42501';
  end if;
  if p_effective_from is null or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Effective time and a reason between 6 and 1000 characters are required' using errcode='22023';
  end if;

  select v.* into v_version
  from public.sellertray_addon_versions v
  where v.id=p_addon_version_id
  for update;

  if not found then
    raise exception 'Draft add-on version not found' using errcode='P0002';
  end if;
  if v_version.status='published'
     and v_version.effective_from=p_effective_from
     and v_version.change_reason=v_reason then
    return p_addon_version_id;
  end if;
  if v_version.status<>'draft' then
    raise exception 'Draft add-on version not found' using errcode='P0002';
  end if;

  if not exists(
      select 1 from public.sellertray_addon_feature_grants g
      where g.addon_version_id=p_addon_version_id and g.enabled
    )
    and not exists(
      select 1 from public.sellertray_addon_capability_grants g
      where g.addon_version_id=p_addon_version_id and g.enabled
    )
    and not exists(
      select 1 from public.sellertray_addon_limit_values g
      where g.addon_version_id=p_addon_version_id
    ) then
    raise exception 'Add-on version requires governed entitlement content before publication' using errcode='23514';
  end if;

  if exists(
    select 1
    from public.sellertray_addon_feature_grants g
    join public.sellertray_feature_catalogue c on c.code=g.feature_code
    where g.addon_version_id=p_addon_version_id and c.status<>'active'
  ) or exists(
    select 1
    from public.sellertray_addon_capability_grants g
    join public.sellertray_capability_catalogue c on c.code=g.capability_code
    where g.addon_version_id=p_addon_version_id and c.status<>'active'
  ) or exists(
    select 1
    from public.sellertray_addon_limit_values g
    join public.sellertray_limit_definitions c on c.code=g.limit_code
    where g.addon_version_id=p_addon_version_id and c.status<>'active'
  ) then
    raise exception 'Add-on version references catalogue entries that are not active' using errcode='23514';
  end if;

  update public.sellertray_addon_versions v
  set status='published',effective_from=p_effective_from,change_reason=v_reason,
      published_by_user_id=p_actor_user_id,published_at=now()
  where v.id=p_addon_version_id and v.status='draft'
  returning v.id into v_result;

  if v_result is null then
    raise exception 'Add-on publication conflicted with another change' using errcode='40001';
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,null,'sellertray_publish_addon_version',
    jsonb_build_object('addonVersionId',v_result,'effectiveFrom',p_effective_from,'reason',v_reason)
  );
  return v_result;
end;
$function$;

revoke all on function public.publish_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid)
  from public,anon,authenticated;
revoke all on function public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid)
  from public,anon,authenticated;
grant execute on function public.publish_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid)
  to service_role;
grant execute on function public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid)
  to service_role;

create or replace function public.control_sellertray_commercial_v2_price_version_admin(
  p_price_version_id uuid,
  p_action text,
  p_reason text,
  p_command_id uuid,
  p_actor_user_id uuid
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
  v_existing public.sellertray_commercial_price_version_controls%rowtype;
  v_lock_identity text;
  v_control_at timestamptz;
begin
  if p_price_version_id is null
     or p_command_id is null
     or v_action not in ('pause','resume','deactivate','void')
     or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Price version, valid lifecycle action, command id and reason are required' using errcode='22023';
  end if;

  select p.* into strict v_target
  from public.sellertray_commercial_price_versions p
  where p.id=p_price_version_id;

  if v_target.plan_code is not null and v_target.price_kind='subscription' then
    raise exception 'Legacy plan-code subscription prices remain governed by the compatibility lifecycle command' using errcode='22023';
  end if;
  if v_target.price_scope='standard' then
    if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',null,now()) then
      raise exception 'Platform pricing management capability required' using errcode='42501';
    end if;
  else
    if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',v_target.tenant_id,now()) then
      raise exception 'Business pricing management capability required' using errcode='42501';
    end if;
  end if;

  -- Branch setup is still reachable through the compatibility lifecycle command,
  -- so reuse its exact advisory-lock identity. Other C2 subjects serialize per
  -- immutable price version because their cycles are independently configured.
  if v_target.price_kind='branch_setup' then
    v_lock_identity:=concat_ws(
      '|','sellertray-price-lifecycle-v1','branch_setup',v_target.id::text
    );
  else
    v_lock_identity:=concat_ws(
      '|','sellertray-price-lifecycle-v2',v_target.price_kind,v_target.id::text
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_identity,0));
  v_control_at:=clock_timestamp();

  select c.* into v_existing
  from public.sellertray_commercial_price_version_controls c
  where c.command_id=p_command_id and c.price_version_id=p_price_version_id
  order by c.created_at desc
  limit 1;

  if found then
    if v_existing.control_action=v_action and v_existing.reason=v_reason then
      return jsonb_build_object(
        'priceVersionId',p_price_version_id,
        'action',v_action,
        'state',public.sellertray_commercial_price_version_state(p_price_version_id,v_control_at),
        'alreadyApplied',true
      );
    end if;
    raise exception 'Price lifecycle command id already belongs to different facts' using errcode='23505';
  end if;

  v_state:=public.sellertray_commercial_price_version_state(p_price_version_id,v_control_at);
  if v_action='pause' and v_state<>'active' then
    raise exception 'Only an active price version can be paused' using errcode='23514';
  end if;
  if v_action='resume' and v_state<>'paused' then
    raise exception 'Only a paused price version can be resumed' using errcode='23514';
  end if;
  if v_action in ('deactivate','void') and v_state in ('deactivated','voided') then
    raise exception 'A deactivated or voided price version is terminal' using errcode='23514';
  end if;
  if v_action='void' then
    if v_target.effective_from<=v_control_at then
      raise exception 'Void is only allowed before a price version becomes effective' using errcode='23514';
    end if;
    if exists(
      select 1 from public.sellertray_commercial_order_price_snapshots s
      where s.source_price_version_id=p_price_version_id
    ) then
      raise exception 'A price version already used by an order cannot be voided' using errcode='23514';
    end if;
    if exists(
      select 1 from public.sellertray_commercial_price_versions p
      where p.source_standard_price_version_id=p_price_version_id
    ) then
      raise exception 'A standard price referenced by a Business override cannot be voided' using errcode='23514';
    end if;
  end if;

  insert into public.sellertray_commercial_price_version_controls(
    price_version_id,control_action,command_id,controlled_by_user_id,effective_at,reason
  ) values(
    p_price_version_id,v_action,p_command_id,p_actor_user_id,v_control_at,v_reason
  );

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,v_target.tenant_id,'sellertray_control_commercial_v2_price_version',
    jsonb_build_object(
      'priceVersionId',p_price_version_id,
      'controlAction',v_action,
      'priceKind',v_target.price_kind,
      'planProfileVersionId',v_target.plan_profile_version_id,
      'addonVersionId',v_target.addon_version_id,
      'commandId',p_command_id,
      'controlAt',v_control_at,
      'reason',v_reason
    )
  );

  return jsonb_build_object(
    'priceVersionId',p_price_version_id,
    'action',v_action,
    'state',public.sellertray_commercial_price_version_state(p_price_version_id,v_control_at),
    'alreadyApplied',false
  );
end;
$function$;

revoke all on function public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)
  to service_role;

commit;
