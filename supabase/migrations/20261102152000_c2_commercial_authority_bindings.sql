begin;

-- SellerTray C2-3 Commercial Authority Bindings
--
-- Forward-only compatibility extension. Historical C1 price rows are not
-- updated or re-snapshotted. New nullable references let new Commercial V2
-- price and installment policy rows bind to Plan Profile/add-on/tax masters.
-- Legacy plan-code publishers/resolvers remain valid until the late C2 cutover.

alter table public.sellertray_commercial_price_versions
  add column if not exists charge_type_code text,
  add column if not exists plan_profile_version_id uuid,
  add column if not exists addon_version_id uuid,
  add column if not exists commercial_tax_profile_version_id uuid;

alter table public.sellertray_commercial_price_versions
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
        price_kind='subscription' and billing_cycle in ('monthly','yearly') and addon_version_id is null
        and (
          (plan_code is not null and plan_profile_version_id is null and (charge_type_code is null or charge_type_code='branch_subscription'))
          or
          (plan_code is null and plan_profile_version_id is not null and charge_type_code='branch_subscription')
        )
      )
      or
      (
        price_kind='branch_setup' and plan_code is null and plan_profile_version_id is null
        and addon_version_id is null and billing_cycle is null
        and (charge_type_code is null or charge_type_code='branch_setup')
      )
      or
      (
        price_kind='addon' and plan_code is null and plan_profile_version_id is null
        and addon_version_id is not null and charge_type_code='addon'
        and billing_cycle in ('monthly','yearly','one_time')
      )
      or
      (
        price_kind='additional_staff' and plan_code is null and addon_version_id is null
        and charge_type_code='additional_staff' and billing_cycle in ('monthly','yearly')
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

  -- Preserve the legacy C1 10-for-12 behavior only for legacy plan-code rows.
  -- C2 Plan Profile billing cycles are independent configured commercial rates.
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
    and ((p.price_scope='merchant_override' and p.tenant_id=p_tenant_id) or p.price_scope='standard')
  order by case p.price_scope when 'merchant_override' then 200 else 100 end desc,
           p.effective_from desc,p.created_at desc,p.id desc
  limit 1;
$function$;

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
begin
  if p_price_version_id is null or p_command_id is null or v_action not in ('pause','resume','deactivate','void') or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Price version, valid lifecycle action, command id and reason are required' using errcode='22023';
  end if;
  select p.* into strict v_target from public.sellertray_commercial_price_versions p where p.id=p_price_version_id;
  if v_target.plan_code is not null and v_target.price_kind='subscription' then
    raise exception 'Legacy plan-code subscription prices remain governed by the compatibility lifecycle command' using errcode='22023';
  end if;
  if v_target.price_scope='standard' then
    if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',null,now()) then raise exception 'Platform pricing management capability required' using errcode='42501'; end if;
  else
    if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',v_target.tenant_id,now()) then raise exception 'Business pricing management capability required' using errcode='42501'; end if;
  end if;

  select c.* into v_existing from public.sellertray_commercial_price_version_controls c where c.command_id=p_command_id and c.price_version_id=p_price_version_id order by c.created_at desc limit 1;
  if found then
    if v_existing.control_action=v_action and v_existing.reason=v_reason then
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
  values(p_actor_user_id,v_target.tenant_id,'sellertray_control_commercial_v2_price_version',jsonb_build_object(
    'priceVersionId',p_price_version_id,'controlAction',v_action,'priceKind',v_target.price_kind,
    'planProfileVersionId',v_target.plan_profile_version_id,'addonVersionId',v_target.addon_version_id,
    'commandId',p_command_id,'reason',v_reason
  ));
  return jsonb_build_object('priceVersionId',p_price_version_id,'action',v_action,'state',public.sellertray_commercial_price_version_state(p_price_version_id,now()),'alreadyApplied',false);
end;
$function$;

revoke all on function public.resolve_sellertray_commercial_v2_price_version(uuid,text,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.publish_sellertray_commercial_v2_price_admin(text,uuid,uuid,text,text,numeric,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_commercial_v2_price_override_admin(uuid,uuid,numeric,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_sellertray_commercial_v2_price_version(uuid,text,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.publish_sellertray_commercial_v2_price_admin(text,uuid,uuid,text,text,numeric,uuid,timestamptz,timestamptz,text,uuid) to service_role;
grant execute on function public.publish_sellertray_commercial_v2_price_override_admin(uuid,uuid,numeric,timestamptz,timestamptz,text,uuid) to service_role;
grant execute on function public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid) to service_role;

-- Plan-Profile-aware installment policy is additive. The legacy plan_cycle
-- policy and resolver remain unchanged for C1 compatibility.
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

commit;
