begin;

-- Merchant-scoped commercial pricing is an additive extension of the existing
-- immutable SellerTray price-version authority. Standard platform prices remain
-- global. A selected Business may receive an audited effective-dated override
-- without mutating or shadowing the standard price for any other Business.

alter table public.sellertray_commercial_price_versions
  add column tenant_id uuid references public.tenants(id) on delete restrict,
  add column price_scope text not null default 'standard',
  add column source_standard_price_version_id uuid references public.sellertray_commercial_price_versions(id) on delete restrict;

alter table public.sellertray_commercial_price_versions
  add constraint sellertray_commercial_price_versions_scope_check
    check (price_scope in ('standard','merchant_override')),
  add constraint sellertray_commercial_price_versions_scope_subject_check
    check (
      (price_scope='standard' and tenant_id is null and source_standard_price_version_id is null)
      or
      (price_scope='merchant_override' and tenant_id is not null and source_standard_price_version_id is not null)
    );

comment on column public.sellertray_commercial_price_versions.tenant_id is
  'Business scope for merchant_override price versions. NULL for standard platform-wide price versions.';
comment on column public.sellertray_commercial_price_versions.price_scope is
  'Immutable price authority scope: standard or merchant_override.';
comment on column public.sellertray_commercial_price_versions.source_standard_price_version_id is
  'For merchant_override rows, the exact standard price version governing tax and commercial subject at override publication time.';

drop index if exists public.sellertray_commercial_subscription_price_version_key;
drop index if exists public.sellertray_commercial_branch_setup_price_version_key;
drop index if exists public.sellertray_commercial_price_resolution_idx;

create unique index sellertray_commercial_subscription_price_version_key
  on public.sellertray_commercial_price_versions(plan_code,billing_cycle,currency,effective_from)
  where price_kind='subscription' and price_scope='standard';

create unique index sellertray_commercial_branch_setup_price_version_key
  on public.sellertray_commercial_price_versions(currency,effective_from)
  where price_kind='branch_setup' and price_scope='standard';

create unique index sellertray_commercial_subscription_override_version_key
  on public.sellertray_commercial_price_versions(tenant_id,plan_code,billing_cycle,currency,effective_from)
  where price_kind='subscription' and price_scope='merchant_override';

create unique index sellertray_commercial_branch_setup_override_version_key
  on public.sellertray_commercial_price_versions(tenant_id,currency,effective_from)
  where price_kind='branch_setup' and price_scope='merchant_override';

create index sellertray_commercial_price_resolution_idx
  on public.sellertray_commercial_price_versions(tenant_id,price_scope,price_kind,plan_code,billing_cycle,currency,effective_from desc,created_at desc);

create or replace function public.resolve_sellertray_commercial_price_version(
  p_price_kind text,
  p_plan_code text,
  p_billing_cycle text,
  p_currency text,
  p_as_of timestamptz
)
returns uuid
language sql
stable
set search_path=''
as $$
  with candidate as (
    select p.*
    from public.sellertray_commercial_price_versions p
    where p.price_scope='standard'
      and p.tenant_id is null
      and p.price_kind=p_price_kind
      and p.plan_code is not distinct from p_plan_code
      and p.billing_cycle is not distinct from p_billing_cycle
      and p.currency=upper(btrim(p_currency))
      and p.status='published'
      and p.effective_from<=p_as_of
      and (p.effective_until is null or p.effective_until>p_as_of)
    order by p.effective_from desc,p.created_at desc,p.id desc
    limit 1
  ),
  effective_monthly as (
    select p.*
    from public.sellertray_commercial_price_versions p
    where p.price_scope='standard'
      and p.tenant_id is null
      and p.price_kind='subscription'
      and p.plan_code=p_plan_code
      and p.billing_cycle='monthly'
      and p.currency=upper(btrim(p_currency))
      and p.status='published'
      and p.effective_from<=p_as_of
      and (p.effective_until is null or p.effective_until>p_as_of)
    order by p.effective_from desc,p.created_at desc,p.id desc
    limit 1
  )
  select c.id
  from candidate c
  left join effective_monthly m on true
  where c.price_kind<>'subscription'
     or c.billing_cycle<>'yearly'
     or (
       m.id is not null
       and abs(c.gross_amount-(m.gross_amount*10))<0.005
       and (
         (
           c.net_amount is null and m.net_amount is null
           and c.tax_rate_percent is null and m.tax_rate_percent is null
           and c.tax_amount is null and m.tax_amount is null
         )
         or
         (
           c.net_amount is not null and m.net_amount is not null
           and c.tax_rate_percent is not distinct from m.tax_rate_percent
           and abs(c.net_amount-(m.net_amount*10))<0.005
           and abs(c.tax_amount-(m.tax_amount*10))<0.005
         )
       )
     )
  limit 1;
$$;

create or replace function public.resolve_sellertray_commercial_price_version_for_tenant(
  p_tenant_id uuid,
  p_price_kind text,
  p_plan_code text,
  p_billing_cycle text,
  p_currency text,
  p_as_of timestamptz
)
returns uuid
language sql
stable
set search_path=''
as $$
  select p.id
  from public.sellertray_commercial_price_versions p
  where p.price_kind=p_price_kind
    and p.plan_code is not distinct from p_plan_code
    and p.billing_cycle is not distinct from p_billing_cycle
    and p.currency=upper(btrim(p_currency))
    and p.status='published'
    and p.effective_from<=p_as_of
    and (p.effective_until is null or p.effective_until>p_as_of)
    and (
      (p.price_scope='merchant_override' and p.tenant_id=p_tenant_id)
      or
      (p.price_scope='standard' and p.tenant_id is null)
    )
  order by
    case when p.price_scope='merchant_override' then 1 else 0 end desc,
    p.effective_from desc,
    p.created_at desc,
    p.id desc
  limit 1;
$$;

comment on function public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamptz) is
  'Resolves the exact effective SellerTray price version for a Business, preferring an effective merchant_override and otherwise falling back to the standard platform price.';

create or replace function public.validate_sellertray_commercial_price_version()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_monthly public.sellertray_commercial_price_versions%rowtype;
  v_standard public.sellertray_commercial_price_versions%rowtype;
begin
  new.currency:=upper(btrim(new.currency));
  new.change_reason:=btrim(new.change_reason);

  if new.price_scope='merchant_override' then
    select p.* into v_standard
    from public.sellertray_commercial_price_versions p
    where p.id=new.source_standard_price_version_id;

    if not found
       or v_standard.price_scope<>'standard'
       or v_standard.tenant_id is not null
       or v_standard.price_kind<>new.price_kind
       or v_standard.plan_code is distinct from new.plan_code
       or v_standard.billing_cycle is distinct from new.billing_cycle
       or v_standard.currency<>new.currency
       or v_standard.status<>'published'
       or v_standard.effective_from>new.effective_from
       or (v_standard.effective_until is not null and v_standard.effective_until<=new.effective_from) then
      raise exception 'Merchant commercial override must reference the exact standard price version effective at the override start' using errcode='23514';
    end if;

    if public.resolve_sellertray_commercial_price_version(
      new.price_kind,new.plan_code,new.billing_cycle,new.currency,new.effective_from
    ) is distinct from v_standard.id then
      raise exception 'Merchant commercial override source is not the governed standard price effective at the override start' using errcode='23514';
    end if;

    -- A negotiated price changes the commercial gross amount only. Tax treatment
    -- follows the source standard price snapshot and cannot be overridden ad hoc.
    if new.tax_rate_percent is distinct from v_standard.tax_rate_percent
       or (new.net_amount is null) is distinct from (v_standard.net_amount is null)
       or (new.tax_amount is null) is distinct from (v_standard.tax_amount is null) then
      raise exception 'Merchant commercial override must preserve the standard price tax treatment' using errcode='23514';
    end if;
  end if;

  if new.billing_cycle='yearly' then
    select p.* into v_monthly
    from public.sellertray_commercial_price_versions p
    where p.price_kind='subscription'
      and p.plan_code=new.plan_code
      and p.billing_cycle='monthly'
      and p.currency=new.currency
      and p.status='published'
      and p.price_scope=new.price_scope
      and p.tenant_id is not distinct from new.tenant_id
      and p.effective_from<=new.effective_from
      and (p.effective_until is null or p.effective_until>new.effective_from)
    order by p.effective_from desc,p.created_at desc,p.id desc
    limit 1;

    if not found then
      raise exception 'A governed monthly price in the same scope must exist before a yearly 10-for-12 price is published' using errcode='23514';
    end if;

    if abs(new.gross_amount-(v_monthly.gross_amount*10))>=0.005 then
      raise exception 'Yearly SellerTray subscription price must equal 10 monthly periods' using errcode='23514';
    end if;

    if (new.net_amount is null) is distinct from (v_monthly.net_amount is null)
       or (new.tax_amount is null) is distinct from (v_monthly.tax_amount is null)
       or (new.tax_rate_percent is null) is distinct from (v_monthly.tax_rate_percent is null) then
      raise exception 'Yearly SellerTray tax treatment must match the governed monthly price' using errcode='23514';
    end if;

    if v_monthly.net_amount is not null and (
      abs(new.net_amount-(v_monthly.net_amount*10))>=0.005
      or abs(new.tax_amount-(v_monthly.tax_amount*10))>=0.005
      or new.tax_rate_percent is distinct from v_monthly.tax_rate_percent
    ) then
      raise exception 'Yearly SellerTray tax snapshot must preserve the 10-for-12 rule' using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

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
as $$
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
$$;

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
as $$
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
$$;

revoke all on function public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamptz,timestamptz,text,uuid) to service_role;
grant execute on function public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid) to service_role;

comment on function public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamptz,timestamptz,text,uuid) is
  'Publishes an immutable Business-scoped subscription price override through admin.pricing.manage. Annual override remains exactly 10x the monthly override for 12 months.';
comment on function public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid) is
  'Publishes an immutable Business-scoped Branch setup price override through admin.pricing.manage without changing the platform-wide standard price.';

create or replace function public.snapshot_sellertray_commercial_order_price()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_price public.sellertray_commercial_price_versions%rowtype;
  v_plan_name text;
  v_resolved_price_id uuid;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.id=new.commercial_order_id and o.tenant_id=new.tenant_id;

  select p.* into strict v_price
  from public.sellertray_commercial_price_versions p
  where p.id=new.source_price_version_id;

  if v_price.currency<>v_order.currency then
    raise exception 'Commercial order and price version currency must match' using errcode='23514';
  end if;
  if v_price.price_scope='merchant_override' and v_price.tenant_id<>new.tenant_id then
    raise exception 'Merchant-scoped commercial price belongs to a different Business' using errcode='42501';
  end if;

  v_resolved_price_id:=public.resolve_sellertray_commercial_price_version_for_tenant(
    new.tenant_id,v_price.price_kind,v_price.plan_code,v_price.billing_cycle,v_price.currency,v_order.ordered_at
  );
  if v_resolved_price_id is null or v_resolved_price_id<>v_price.id then
    raise exception 'Commercial order must snapshot the governed Business price version effective at the order time' using errcode='23514';
  end if;

  if new.line_type='subscription' then
    if v_price.price_kind<>'subscription' then
      raise exception 'Subscription order line requires a subscription price version' using errcode='23514';
    end if;
    select p.name into strict v_plan_name from public.subscription_plans p where p.code=v_price.plan_code;
    new.plan_code:=v_price.plan_code;
    new.billing_cycle:=v_price.billing_cycle;
    new.branch_id:=null;
    new.quantity:=1;
    if nullif(btrim(new.description_snapshot),'') is null then new.description_snapshot:=v_plan_name; end if;
  elsif new.line_type='branch_setup' then
    if v_price.price_kind<>'branch_setup' then
      raise exception 'Branch setup order line requires a branch setup price version' using errcode='23514';
    end if;
    if new.branch_id is null then raise exception 'Branch setup order line requires a Branch' using errcode='23514'; end if;
    new.plan_code:=null;
    new.billing_cycle:=null;
    new.quantity:=1;
  else
    raise exception 'Unsupported SellerTray commercial order line type' using errcode='23514';
  end if;

  new.currency:=v_price.currency;
  new.unit_gross_amount:=v_price.gross_amount;
  new.gross_amount:=round((new.quantity*v_price.gross_amount)::numeric,2);
  if v_price.net_amount is null then
    new.net_amount:=null; new.tax_rate_percent:=null; new.tax_amount:=null;
  else
    new.net_amount:=round((new.quantity*v_price.net_amount)::numeric,2);
    new.tax_rate_percent:=v_price.tax_rate_percent;
    new.tax_amount:=new.gross_amount-new.net_amount;
  end if;
  new.snapshotted_at:=now();
  return new;
end;
$$;

create or replace function public.create_sellertray_initial_installment_purchase_admin_impl(
  p_tenant_id uuid,
  p_plan_code text,
  p_currency text,
  p_branch_ids uuid[],
  p_structure_code text,
  p_order_reference text,
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
  v_structure text:=btrim(coalesce(p_structure_code,''));
  v_reference text:=btrim(coalesce(p_order_reference,''));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_order_id uuid;
  v_obligation_id uuid;
  v_subscription_price_id uuid;
  v_setup_price_id uuid;
  v_subscription_price public.sellertray_commercial_price_versions%rowtype;
  v_setup_price public.sellertray_commercial_price_versions%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_ordered_at timestamptz:=now();
  v_branch_count integer;
  v_line_no integer:=2;
  v_total numeric(18,2);
  v_first numeric(18,2);
  v_second numeric(18,2);
  v_third numeric(18,2);
  v_branch record;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if v_role<>'admin' then raise exception 'Platform admin role required for this action' using errcode='42501'; end if;
  if p_tenant_id is null or not exists(select 1 from public.tenants t where t.id=p_tenant_id) then raise exception 'Business not found' using errcode='P0002'; end if;
  if char_length(v_reference) not between 1 and 128 then raise exception 'Commercial order reference is required' using errcode='22023'; end if;
  if char_length(v_reason) not between 6 and 1000 then raise exception 'Commercial creation reason must be between 6 and 1000 characters' using errcode='22023'; end if;
  if v_structure not in ('two_installment_70_30','three_installment_60_20_20') then raise exception 'Unsupported installment structure' using errcode='22023'; end if;
  if v_currency!~'^[A-Z]{3}$' then raise exception 'Valid commercial currency is required' using errcode='22023'; end if;
  if not exists(select 1 from public.subscription_plans p where p.code=v_plan_code and p.is_active) then raise exception 'Active SellerTray plan not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.tenant_subscriptions s where s.tenant_id=p_tenant_id and s.status='trial') then
    raise exception 'Business is not in the pre-C2 runtime compatibility state required for an initial installment purchase' using errcode='23514';
  end if;
  if p_branch_ids is null or cardinality(p_branch_ids)=0 then raise exception 'Select at least one active Branch for the initial purchase' using errcode='22023'; end if;
  if cardinality(p_branch_ids)<>(select count(distinct x) from unnest(p_branch_ids) x) then raise exception 'Branch selection contains duplicates' using errcode='22023'; end if;
  select count(*) into v_branch_count from public.branches b where b.tenant_id=p_tenant_id and b.is_active and b.id=any(p_branch_ids);
  if v_branch_count<>cardinality(p_branch_ids) then raise exception 'Every selected Branch must be active and belong to this business' using errcode='23514'; end if;

  select o.* into v_order from public.sellertray_commercial_orders o where o.order_reference=v_reference;
  if found then
    if v_order.tenant_id<>p_tenant_id or v_order.currency<>v_currency then raise exception 'Commercial order reference is already used for different facts' using errcode='23505'; end if;
    select io.id into strict v_obligation_id from public.sellertray_commercial_installment_obligations io where io.tenant_id=p_tenant_id and io.commercial_order_id=v_order.id and io.structure_code=v_structure;
    if not exists(
      select 1 from public.sellertray_commercial_order_price_snapshots ps
      where ps.tenant_id=p_tenant_id and ps.commercial_order_id=v_order.id and ps.line_type='subscription' and ps.plan_code=v_plan_code and ps.billing_cycle='yearly'
    ) or (
      select coalesce(array_agg(ps.branch_id order by ps.branch_id),'{}'::uuid[])
      from public.sellertray_commercial_order_price_snapshots ps
      where ps.tenant_id=p_tenant_id and ps.commercial_order_id=v_order.id and ps.line_type='branch_setup'
    ) is distinct from (select array_agg(x order by x) from unnest(p_branch_ids) x) then
      raise exception 'Commercial order reference is already used for different facts' using errcode='23505';
    end if;
    return jsonb_build_object('commercialOrderId',v_order.id,'installmentObligationId',v_obligation_id,'orderReference',v_order.order_reference,'currency',v_order.currency,'totalGrossAmount',v_order.total_gross_amount,'idempotentReplay',true);
  end if;

  if exists(
    select 1 from public.sellertray_commercial_orders o
    join public.sellertray_commercial_order_price_snapshots ps on ps.tenant_id=o.tenant_id and ps.commercial_order_id=o.id and ps.line_type='subscription'
    where o.tenant_id=p_tenant_id
  ) then raise exception 'Business already has a governed subscription commercial order; initial purchase cannot be duplicated' using errcode='23505'; end if;

  v_subscription_price_id:=public.resolve_sellertray_commercial_price_version_for_tenant(p_tenant_id,'subscription',v_plan_code,'yearly',v_currency,v_ordered_at);
  v_setup_price_id:=public.resolve_sellertray_commercial_price_version_for_tenant(p_tenant_id,'branch_setup',null,null,v_currency,v_ordered_at);
  if v_subscription_price_id is null then raise exception 'No governed yearly subscription price is effective for this purchase' using errcode='23514'; end if;
  if v_setup_price_id is null then raise exception 'No governed Branch setup price is effective for this purchase' using errcode='23514'; end if;
  select p.* into strict v_subscription_price from public.sellertray_commercial_price_versions p where p.id=v_subscription_price_id;
  select p.* into strict v_setup_price from public.sellertray_commercial_price_versions p where p.id=v_setup_price_id;
  v_total:=v_subscription_price.gross_amount+(v_setup_price.gross_amount*v_branch_count);

  insert into public.sellertray_commercial_orders(tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id)
  values(p_tenant_id,v_reference,v_currency,v_total,v_ordered_at,p_actor_user_id) returning id into v_order_id;

  insert into public.sellertray_commercial_order_price_snapshots(
    tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot,quantity,currency,unit_gross_amount,gross_amount
  ) values(p_tenant_id,v_order_id,1,'subscription',v_subscription_price_id,'',1,v_currency,0,0);

  for v_branch in select b.id,b.code,b.name from public.branches b where b.tenant_id=p_tenant_id and b.is_active and b.id=any(p_branch_ids) order by b.name,b.id loop
    insert into public.sellertray_commercial_order_price_snapshots(
      tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot,quantity,currency,unit_gross_amount,gross_amount
    ) values(p_tenant_id,v_order_id,v_line_no,'branch_setup',v_setup_price_id,v_branch.id,format('Branch setup · %s',v_branch.name),1,v_currency,0,0);
    v_line_no:=v_line_no+1;
  end loop;

  insert into public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id)
  values(p_tenant_id,v_order_id,v_structure,v_currency,v_total,p_actor_user_id) returning id into v_obligation_id;

  if v_structure='two_installment_70_30' then
    v_first:=round((v_total*0.70)::numeric,2); v_second:=v_total-v_first;
    insert into public.sellertray_commercial_installment_schedule(tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at)
    values(p_tenant_id,v_obligation_id,1,70,v_first,null),(p_tenant_id,v_obligation_id,2,30,v_second,null);
  else
    v_first:=round((v_total*0.60)::numeric,2); v_second:=round((v_total*0.20)::numeric,2); v_third:=v_total-v_first-v_second;
    insert into public.sellertray_commercial_installment_schedule(tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at)
    values(p_tenant_id,v_obligation_id,1,60,v_first,null),(p_tenant_id,v_obligation_id,2,20,v_second,null),(p_tenant_id,v_obligation_id,3,20,v_third,null);
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'sellertray_create_initial_installment_purchase',jsonb_build_object(
    'commercialOrderId',v_order_id,'installmentObligationId',v_obligation_id,'orderReference',v_reference,
    'planCode',v_plan_code,'currency',v_currency,'branchIds',to_jsonb(p_branch_ids),'structureCode',v_structure,
    'totalGrossAmount',v_total,'subscriptionPriceVersionId',v_subscription_price.id,
    'subscriptionPriceScope',v_subscription_price.price_scope,'setupPriceVersionId',v_setup_price.id,
    'setupPriceScope',v_setup_price.price_scope,'reason',v_reason
  ));

  return jsonb_build_object(
    'commercialOrderId',v_order_id,'installmentObligationId',v_obligation_id,'orderReference',v_reference,
    'currency',v_currency,'totalGrossAmount',v_total,'subscriptionPriceVersionId',v_subscription_price.id,
    'subscriptionPriceScope',v_subscription_price.price_scope,'setupPriceVersionId',v_setup_price.id,
    'setupPriceScope',v_setup_price.price_scope,'idempotentReplay',false
  );
end;
$$;

create or replace function public.get_sellertray_commercial_onboarding_admin_impl(p_actor_user_id uuid,p_tenant_id uuid)
returns jsonb
language plpgsql
stable
set search_path=''
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if v_role not in ('admin','support') then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  if p_tenant_id is null or not exists(select 1 from public.tenants t where t.id=p_tenant_id) then raise exception 'Business not found' using errcode='P0002'; end if;

  select jsonb_build_object(
    'actorRole',v_role,
    'canManage',public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()),
    'tenantId',p_tenant_id,
    'runtimeCompatibility',(
      select jsonb_build_object('planCode',s.plan_code,'status',s.status,'eligibleForInitialInstallment',s.status='trial')
      from public.tenant_subscriptions s where s.tenant_id=p_tenant_id
    ),
    'plans',coalesce((select jsonb_agg(jsonb_build_object('code',p.code,'name',p.name,'currency',p.currency,'active',p.is_active) order by p.name,p.code) from public.subscription_plans p where p.is_active),'[]'::jsonb),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'code',b.code,'name',b.name,'active',b.is_active,'isDefault',b.is_default) order by b.is_default desc,b.name,b.id) from public.branches b where b.tenant_id=p_tenant_id),'[]'::jsonb),
    'prices',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,'priceKind',p.price_kind,'planCode',p.plan_code,'billingCycle',p.billing_cycle,
        'currency',p.currency,'grossAmount',p.gross_amount,'netAmount',p.net_amount,'taxRatePercent',p.tax_rate_percent,
        'taxAmount',p.tax_amount,'effectiveFrom',p.effective_from,'effectiveUntil',p.effective_until,
        'changeReason',p.change_reason,'priceScope',p.price_scope,'tenantId',p.tenant_id,
        'sourceStandardPriceVersionId',p.source_standard_price_version_id
      ) order by case p.price_scope when 'merchant_override' then 0 else 1 end,p.price_kind,p.plan_code nulls last,p.billing_cycle nulls last,p.effective_from desc,p.created_at desc)
      from public.sellertray_commercial_price_versions p
      where p.status='published' and (p.price_scope='standard' or p.tenant_id=p_tenant_id)
    ),'[]'::jsonb),
    'orders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,'reference',o.order_reference,'currency',o.currency,'totalGrossAmount',o.total_gross_amount,
        'orderedAt',o.ordered_at,'installmentObligationId',io.id,'structureCode',io.structure_code,
        'schedule',coalesce((select jsonb_agg(jsonb_build_object('sequenceNo',s.sequence_no,'percentage',s.percentage,'amountDue',s.amount_due,'dueAt',s.due_at) order by s.sequence_no) from public.sellertray_commercial_installment_schedule s where s.tenant_id=o.tenant_id and s.installment_obligation_id=io.id),'[]'::jsonb),
        'branches',coalesce((select jsonb_agg(jsonb_build_object('branchId',ps.branch_id,'description',ps.description_snapshot,'grossAmount',ps.gross_amount,'priceVersionId',ps.source_price_version_id,'priceScope',pv.price_scope) order by ps.line_no) from public.sellertray_commercial_order_price_snapshots ps join public.sellertray_commercial_price_versions pv on pv.id=ps.source_price_version_id where ps.tenant_id=o.tenant_id and ps.commercial_order_id=o.id and ps.line_type='branch_setup'),'[]'::jsonb)
      ) order by o.ordered_at desc,o.id desc)
      from public.sellertray_commercial_orders o
      left join public.sellertray_commercial_installment_obligations io on io.tenant_id=o.tenant_id and io.commercial_order_id=o.id
      where o.tenant_id=p_tenant_id
    ),'[]'::jsonb),
    'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'family',t.agreement_family,'versionCode',t.version_code,'title',t.title,'effectiveFrom',t.effective_from,'publishedAt',t.published_at) order by t.agreement_family,t.effective_from desc,t.published_at desc) from public.sellertray_commercial_agreement_template_versions t),'[]'::jsonb),
    'agreements',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'commercialOrderId',a.commercial_order_id,'installmentObligationId',a.installment_obligation_id,'templateVersionId',a.template_version_id,'family',a.agreement_family,'reference',a.agreement_reference,'issuedAt',a.issued_at,'accepted',exists(select 1 from public.sellertray_commercial_agreement_acceptances ac where ac.tenant_id=a.tenant_id and ac.agreement_id=a.id)) order by a.issued_at desc,a.id desc) from public.sellertray_commercial_agreements a where a.tenant_id=p_tenant_id),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

commit;
