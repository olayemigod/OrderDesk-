begin;

create or replace function public.publish_sellertray_subscription_price_pair_admin_impl(
  p_plan_code text,
  p_currency text,
  p_monthly_gross_amount numeric,
  p_tax_rate_percent numeric,
  p_effective_from timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_role text;
  v_plan_code text:=btrim(coalesce(p_plan_code,''));
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_monthly_gross numeric(18,2):=round(coalesce(p_monthly_gross_amount,0)::numeric,2);
  v_monthly_net numeric(18,2);
  v_monthly_tax numeric(18,2);
  v_yearly_gross numeric(18,2);
  v_yearly_net numeric(18,2);
  v_yearly_tax numeric(18,2);
  v_monthly_id uuid;
  v_yearly_id uuid;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if v_role<>'admin' then raise exception 'Platform admin role required for this action' using errcode='42501'; end if;
  if not exists(select 1 from public.subscription_plans p where p.code=v_plan_code and p.is_active) then raise exception 'Active SellerTray plan not found' using errcode='P0002'; end if;
  if v_currency!~'^[A-Z]{3}$' or v_monthly_gross<=0 or p_effective_from is null then raise exception 'Plan, currency, positive monthly price and effective time are required' using errcode='22023'; end if;
  if char_length(v_reason) not between 6 and 1000 then raise exception 'Commercial change reason must be between 6 and 1000 characters' using errcode='22023'; end if;
  if p_tax_rate_percent is not null and (p_tax_rate_percent<0 or p_tax_rate_percent>100) then raise exception 'Tax rate must be between 0 and 100 percent' using errcode='22023'; end if;

  if p_tax_rate_percent is not null then
    v_monthly_net:=round((v_monthly_gross/(1+(p_tax_rate_percent/100)))::numeric,2);
    v_monthly_tax:=v_monthly_gross-v_monthly_net;
  end if;
  v_yearly_gross:=v_monthly_gross*10;
  if v_monthly_net is not null then v_yearly_net:=v_monthly_net*10; v_yearly_tax:=v_yearly_gross-v_yearly_net; end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,tax_inclusive,
    net_amount,tax_rate_percent,tax_amount,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,price_scope
  ) values(
    'subscription',v_plan_code,'monthly',v_currency,v_monthly_gross,true,
    v_monthly_net,p_tax_rate_percent,v_monthly_tax,p_effective_from,'published',v_reason,
    p_actor_user_id,p_actor_user_id,now(),'standard'
  )
  on conflict (plan_code,billing_cycle,currency,effective_from)
    where price_kind='subscription' and price_scope='standard'
  do nothing returning id into v_monthly_id;

  if v_monthly_id is null then
    select p.id into strict v_monthly_id
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription' and p.price_scope='standard' and p.tenant_id is null
      and p.plan_code=v_plan_code and p.billing_cycle='monthly' and p.currency=v_currency
      and p.effective_from=p_effective_from and p.gross_amount=v_monthly_gross
      and p.net_amount is not distinct from v_monthly_net
      and p.tax_rate_percent is not distinct from p_tax_rate_percent
      and p.tax_amount is not distinct from v_monthly_tax and p.change_reason=v_reason;
  end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,tax_inclusive,
    net_amount,tax_rate_percent,tax_amount,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,price_scope
  ) values(
    'subscription',v_plan_code,'yearly',v_currency,v_yearly_gross,true,
    v_yearly_net,p_tax_rate_percent,v_yearly_tax,p_effective_from,'published',v_reason,
    p_actor_user_id,p_actor_user_id,now(),'standard'
  )
  on conflict (plan_code,billing_cycle,currency,effective_from)
    where price_kind='subscription' and price_scope='standard'
  do nothing returning id into v_yearly_id;

  if v_yearly_id is null then
    select p.id into strict v_yearly_id
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription' and p.price_scope='standard' and p.tenant_id is null
      and p.plan_code=v_plan_code and p.billing_cycle='yearly' and p.currency=v_currency
      and p.effective_from=p_effective_from and p.gross_amount=v_yearly_gross
      and p.net_amount is not distinct from v_yearly_net
      and p.tax_rate_percent is not distinct from p_tax_rate_percent
      and p.tax_amount is not distinct from v_yearly_tax and p.change_reason=v_reason;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_subscription_price_pair',jsonb_build_object(
    'planCode',v_plan_code,'currency',v_currency,'monthlyPriceVersionId',v_monthly_id,
    'yearlyPriceVersionId',v_yearly_id,'monthlyGrossAmount',v_monthly_gross,
    'yearlyGrossAmount',v_yearly_gross,'taxRatePercent',p_tax_rate_percent,
    'effectiveFrom',p_effective_from,'priceScope','standard','reason',v_reason
  ));

  return jsonb_build_object('monthlyPriceVersionId',v_monthly_id,'yearlyPriceVersionId',v_yearly_id,'monthlyGrossAmount',v_monthly_gross,'yearlyGrossAmount',v_yearly_gross);
exception when no_data_found then
  raise exception 'Existing governed subscription price version conflicts with this request' using errcode='23505';
end;
$$;

create or replace function public.publish_sellertray_branch_setup_price_admin_impl(
  p_currency text,
  p_gross_amount numeric,
  p_tax_rate_percent numeric,
  p_effective_from timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
set search_path=''
as $$
declare
  v_role text;
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_gross numeric(18,2):=round(coalesce(p_gross_amount,0)::numeric,2);
  v_net numeric(18,2);
  v_tax numeric(18,2);
  v_id uuid;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if v_role<>'admin' then raise exception 'Platform admin role required for this action' using errcode='42501'; end if;
  if v_currency!~'^[A-Z]{3}$' or v_gross<=0 or p_effective_from is null then raise exception 'Currency, positive Branch setup price and effective time are required' using errcode='22023'; end if;
  if char_length(v_reason) not between 6 and 1000 then raise exception 'Commercial change reason must be between 6 and 1000 characters' using errcode='22023'; end if;
  if p_tax_rate_percent is not null and (p_tax_rate_percent<0 or p_tax_rate_percent>100) then raise exception 'Tax rate must be between 0 and 100 percent' using errcode='22023'; end if;
  if p_tax_rate_percent is not null then v_net:=round((v_gross/(1+(p_tax_rate_percent/100)))::numeric,2); v_tax:=v_gross-v_net; end if;

  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,tax_inclusive,
    net_amount,tax_rate_percent,tax_amount,effective_from,status,change_reason,
    created_by_user_id,approved_by_user_id,approved_at,price_scope
  ) values(
    'branch_setup',null,null,v_currency,v_gross,true,v_net,p_tax_rate_percent,v_tax,
    p_effective_from,'published',v_reason,p_actor_user_id,p_actor_user_id,now(),'standard'
  )
  on conflict (currency,effective_from)
    where price_kind='branch_setup' and price_scope='standard'
  do nothing returning id into v_id;

  if v_id is null then
    select p.id into strict v_id
    from public.sellertray_commercial_price_versions p
    where p.price_kind='branch_setup' and p.price_scope='standard' and p.tenant_id is null
      and p.currency=v_currency and p.effective_from=p_effective_from and p.gross_amount=v_gross
      and p.net_amount is not distinct from v_net
      and p.tax_rate_percent is not distinct from p_tax_rate_percent
      and p.tax_amount is not distinct from v_tax and p.change_reason=v_reason;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_branch_setup_price',jsonb_build_object(
    'priceVersionId',v_id,'currency',v_currency,'grossAmount',v_gross,
    'taxRatePercent',p_tax_rate_percent,'effectiveFrom',p_effective_from,
    'priceScope','standard','reason',v_reason
  ));
  return v_id;
exception when no_data_found then
  raise exception 'Existing governed Branch setup price version conflicts with this request' using errcode='23505';
end;
$$;

commit;
