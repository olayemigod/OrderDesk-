-- Converge the governed Business-specific commercial price override publishers.
-- Production already carried this authority from an earlier migration lineage; this
-- forward-only migration restores the same capability/audit boundary for clean
-- repository replay without reintroducing the historical migration wholesale.

create or replace function public.publish_sellertray_merchant_subscription_price_override_admin(
  p_tenant_id uuid,
  p_plan_code text,
  p_currency text,
  p_monthly_gross_amount numeric,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_plan text:=btrim(coalesce(p_plan_code,''));
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_monthly_gross numeric(18,2):=round(coalesce(p_monthly_gross_amount,0)::numeric,2);
  v_yearly_gross numeric(18,2);
  v_standard_monthly public.sellertray_commercial_price_versions%rowtype;
  v_standard_yearly public.sellertray_commercial_price_versions%rowtype;
  v_monthly_net numeric(18,2);
  v_monthly_tax numeric(18,2);
  v_yearly_net numeric(18,2);
  v_yearly_tax numeric(18,2);
  v_monthly_id uuid;
  v_yearly_id uuid;
begin
  if p_tenant_id is null or not exists(select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()) then
    raise exception 'Commercial pricing management capability required' using errcode='42501';
  end if;
  if not exists(select 1 from public.subscription_plans p where p.code=v_plan and p.is_active) then
    raise exception 'Active SellerTray plan not found' using errcode='P0002';
  end if;
  if v_currency!~'^[A-Z]{3}$' or v_monthly_gross<=0 or p_effective_from is null then
    raise exception 'Business, plan, currency, positive monthly override and effective time are required' using errcode='22023';
  end if;
  if p_effective_until is not null and p_effective_until<=p_effective_from then
    raise exception 'Commercial override expiry must be after its effective time' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Commercial override reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  select p.* into strict v_standard_monthly
  from public.sellertray_commercial_price_versions p
  where p.id=public.resolve_sellertray_commercial_price_version('subscription',v_plan,'monthly',v_currency,p_effective_from);
  select p.* into strict v_standard_yearly
  from public.sellertray_commercial_price_versions p
  where p.id=public.resolve_sellertray_commercial_price_version('subscription',v_plan,'yearly',v_currency,p_effective_from);

  if v_standard_monthly.tax_rate_percent is not null then
    v_monthly_net:=round((v_monthly_gross/(1+(v_standard_monthly.tax_rate_percent/100)))::numeric,2);
    v_monthly_tax:=v_monthly_gross-v_monthly_net;
  end if;
  v_yearly_gross:=v_monthly_gross*10;
  if v_monthly_net is not null then
    v_yearly_net:=v_monthly_net*10;
    v_yearly_tax:=v_yearly_gross-v_yearly_net;
  end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,tax_inclusive,
    net_amount,tax_rate_percent,tax_amount,effective_from,effective_until,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,
    tenant_id,price_scope,source_standard_price_version_id
  ) values (
    'subscription',v_plan,'monthly',v_currency,v_monthly_gross,true,
    v_monthly_net,v_standard_monthly.tax_rate_percent,v_monthly_tax,p_effective_from,p_effective_until,'published',v_reason,
    p_actor_user_id,p_actor_user_id,now(),
    p_tenant_id,'merchant_override',v_standard_monthly.id
  )
  on conflict (tenant_id,plan_code,billing_cycle,currency,effective_from)
    where price_kind='subscription' and price_scope='merchant_override'
  do nothing returning id into v_monthly_id;

  if v_monthly_id is null then
    select p.id into strict v_monthly_id
    from public.sellertray_commercial_price_versions p
    where p.price_scope='merchant_override' and p.tenant_id=p_tenant_id
      and p.price_kind='subscription' and p.plan_code=v_plan and p.billing_cycle='monthly'
      and p.currency=v_currency and p.effective_from=p_effective_from
      and p.effective_until is not distinct from p_effective_until
      and p.gross_amount=v_monthly_gross
      and p.source_standard_price_version_id=v_standard_monthly.id
      and p.change_reason=v_reason;
  end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,tax_inclusive,
    net_amount,tax_rate_percent,tax_amount,effective_from,effective_until,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,
    tenant_id,price_scope,source_standard_price_version_id
  ) values (
    'subscription',v_plan,'yearly',v_currency,v_yearly_gross,true,
    v_yearly_net,v_standard_yearly.tax_rate_percent,v_yearly_tax,p_effective_from,p_effective_until,'published',v_reason,
    p_actor_user_id,p_actor_user_id,now(),
    p_tenant_id,'merchant_override',v_standard_yearly.id
  )
  on conflict (tenant_id,plan_code,billing_cycle,currency,effective_from)
    where price_kind='subscription' and price_scope='merchant_override'
  do nothing returning id into v_yearly_id;

  if v_yearly_id is null then
    select p.id into strict v_yearly_id
    from public.sellertray_commercial_price_versions p
    where p.price_scope='merchant_override' and p.tenant_id=p_tenant_id
      and p.price_kind='subscription' and p.plan_code=v_plan and p.billing_cycle='yearly'
      and p.currency=v_currency and p.effective_from=p_effective_from
      and p.effective_until is not distinct from p_effective_until
      and p.gross_amount=v_yearly_gross
      and p.source_standard_price_version_id=v_standard_yearly.id
      and p.change_reason=v_reason;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'sellertray_publish_merchant_subscription_price_override',jsonb_build_object(
    'planCode',v_plan,'currency',v_currency,'monthlyPriceVersionId',v_monthly_id,
    'yearlyPriceVersionId',v_yearly_id,'monthlyGrossAmount',v_monthly_gross,
    'yearlyGrossAmount',v_yearly_gross,'effectiveFrom',p_effective_from,
    'effectiveUntil',p_effective_until,'reason',v_reason
  ));

  return jsonb_build_object(
    'monthlyPriceVersionId',v_monthly_id,'yearlyPriceVersionId',v_yearly_id,
    'monthlyGrossAmount',v_monthly_gross,'yearlyGrossAmount',v_yearly_gross,
    'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until
  );
exception when no_data_found then
  raise exception 'Existing merchant subscription price override conflicts with this request' using errcode='23505';
end;
$function$;

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
  where p.id=public.resolve_sellertray_commercial_price_version('branch_setup',null,null,v_currency,p_effective_from);

  if v_standard.tax_rate_percent is not null then
    v_net:=round((v_gross/(1+(v_standard.tax_rate_percent/100)))::numeric,2);
    v_tax:=v_gross-v_net;
  end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,tax_inclusive,
    net_amount,tax_rate_percent,tax_amount,effective_from,effective_until,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,
    tenant_id,price_scope,source_standard_price_version_id
  ) values (
    'branch_setup',null,null,v_currency,v_gross,true,
    v_net,v_standard.tax_rate_percent,v_tax,p_effective_from,p_effective_until,'published',v_reason,
    p_actor_user_id,p_actor_user_id,now(),
    p_tenant_id,'merchant_override',v_standard.id
  )
  on conflict (tenant_id,currency,effective_from)
    where price_kind='branch_setup' and price_scope='merchant_override'
  do nothing returning id into v_id;

  if v_id is null then
    select p.id into strict v_id
    from public.sellertray_commercial_price_versions p
    where p.price_scope='merchant_override' and p.tenant_id=p_tenant_id
      and p.price_kind='branch_setup' and p.currency=v_currency and p.effective_from=p_effective_from
      and p.effective_until is not distinct from p_effective_until
      and p.gross_amount=v_gross and p.source_standard_price_version_id=v_standard.id
      and p.change_reason=v_reason;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'sellertray_publish_merchant_branch_setup_price_override',jsonb_build_object(
    'priceVersionId',v_id,'currency',v_currency,'grossAmount',v_gross,
    'effectiveFrom',p_effective_from,'effectiveUntil',p_effective_until,'reason',v_reason
  ));
  return v_id;
exception when no_data_found then
  raise exception 'Existing merchant Branch setup price override conflicts with this request' using errcode='23505';
end;
$function$;

revoke execute on function public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
revoke execute on function public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamptz,timestamptz,text,uuid) to service_role;
grant execute on function public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid) to service_role;
