begin;

-- Keep Business pricing selection on one authority. A currently applicable
-- merchant override wins; otherwise delegate to the canonical standard-price
-- resolver (including its lifecycle and 10-for-12 validation).
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
as $function$
  select coalesce(
    (
      select p.id
      from public.sellertray_commercial_price_versions p
      where p.price_scope='merchant_override'
        and p.tenant_id=p_tenant_id
        and p.price_kind=p_price_kind
        and p.plan_code is not distinct from p_plan_code
        and p.billing_cycle is not distinct from p_billing_cycle
        and p.currency=upper(btrim(p_currency))
        and p.status='published'
        and p.effective_from<=p_as_of
        and (p.effective_until is null or p.effective_until>p_as_of)
        and public.sellertray_commercial_price_version_state(p.id,p_as_of)='active'
      order by p.effective_from desc,p.created_at desc,p.id desc
      limit 1
    ),
    public.resolve_sellertray_commercial_price_version(
      p_price_kind,p_plan_code,p_billing_cycle,p_currency,p_as_of
    )
  );
$function$;

revoke all on function public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamptz)
  to service_role;

-- Preserve the established service-only wrapper and response fields while
-- adding server-derived pricing capabilities and an effective-price projection
-- for the selected Business. The full history remains available for lifecycle
-- review, but cannot expose another Business's override.
create or replace function public.get_sellertray_commercial_onboarding_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $function$
declare
  v_role text;
  v_as_of timestamptz:=now();
  v_result jsonb;
  v_prices jsonb;
  v_effective_prices jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  v_result:=public.get_sellertray_commercial_onboarding_admin_impl(
    p_actor_user_id,
    p_tenant_id
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,
    'priceKind',p.price_kind,
    'planCode',p.plan_code,
    'billingCycle',p.billing_cycle,
    'currency',p.currency,
    'grossAmount',p.gross_amount,
    'netAmount',p.net_amount,
    'taxRatePercent',p.tax_rate_percent,
    'taxAmount',p.tax_amount,
    'effectiveFrom',p.effective_from,
    'effectiveUntil',p.effective_until,
    'changeReason',p.change_reason,
    'priceScope',p.price_scope,
    'tenantId',p.tenant_id,
    'sourceStandardPriceVersionId',p.source_standard_price_version_id,
    'lifecycleState',public.sellertray_commercial_price_version_state(p.id,v_as_of),
    'latestControlAction',c.control_action,
    'latestControlAt',c.effective_at,
    'latestControlReason',c.reason
  ) order by p.price_kind,p.plan_code nulls last,p.billing_cycle nulls last,
             p.effective_from desc,p.created_at desc,p.id desc),'[]'::jsonb)
  into v_prices
  from public.sellertray_commercial_price_versions p
  left join lateral (
    select pc.control_action,pc.effective_at,pc.reason
    from public.sellertray_commercial_price_version_controls pc
    where pc.price_version_id=p.id
      and pc.effective_at<=v_as_of
    order by pc.effective_at desc,pc.created_at desc,pc.id desc
    limit 1
  ) c on true
  where p.status='published'
    and (
      (p.price_scope='standard' and p.tenant_id is null)
      or (p.price_scope='merchant_override' and p.tenant_id=p_tenant_id)
    );

  with requested_prices(price_kind,plan_code,billing_cycle,currency) as (
    select 'subscription'::text,p.code,'monthly'::text,p.currency
    from public.subscription_plans p
    where p.is_active
    union
    select 'subscription'::text,p.code,'yearly'::text,p.currency
    from public.subscription_plans p
    where p.is_active
    union
    select 'branch_setup'::text,null::text,null::text,p.currency
    from public.subscription_plans p
    where p.is_active
  ), resolved_prices as (
    select r.*,
      public.resolve_sellertray_commercial_price_version_for_tenant(
        p_tenant_id,r.price_kind,r.plan_code,r.billing_cycle,r.currency,v_as_of
      ) as price_version_id
    from requested_prices r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,
    'priceKind',p.price_kind,
    'planCode',p.plan_code,
    'billingCycle',p.billing_cycle,
    'currency',p.currency,
    'grossAmount',p.gross_amount,
    'netAmount',p.net_amount,
    'taxRatePercent',p.tax_rate_percent,
    'taxAmount',p.tax_amount,
    'effectiveFrom',p.effective_from,
    'effectiveUntil',p.effective_until,
    'changeReason',p.change_reason,
    'priceScope',p.price_scope,
    'tenantId',p.tenant_id,
    'sourceStandardPriceVersionId',p.source_standard_price_version_id,
    'lifecycleState','active',
    'latestControlAction',c.control_action,
    'latestControlAt',c.effective_at,
    'latestControlReason',c.reason
  ) order by p.price_kind,p.plan_code nulls last,p.billing_cycle nulls last),'[]'::jsonb)
  into v_effective_prices
  from resolved_prices r
  join public.sellertray_commercial_price_versions p on p.id=r.price_version_id
  left join lateral (
    select pc.control_action,pc.effective_at,pc.reason
    from public.sellertray_commercial_price_version_controls pc
    where pc.price_version_id=p.id
      and pc.effective_at<=v_as_of
    order by pc.effective_at desc,pc.created_at desc,pc.id desc
    limit 1
  ) c on true;

  return v_result || jsonb_build_object(
    'canManageGlobalPricing',
      v_role='admin' and public.platform_admin_has_capability(
        p_actor_user_id,'admin.pricing.manage',null,v_as_of
      ),
    'canManageMerchantPricing',
      public.platform_admin_has_capability(
        p_actor_user_id,'admin.pricing.manage',p_tenant_id,v_as_of
      ),
    'prices',v_prices,
    'effectivePrices',v_effective_prices,
    'pricingResolvedAt',v_as_of
  );
end;
$function$;

revoke all on function public.get_sellertray_commercial_onboarding_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_onboarding_admin(uuid,uuid)
  to service_role;

commit;
