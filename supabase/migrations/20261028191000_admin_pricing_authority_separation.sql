begin;

-- Keep pricing publication authority distinct from initial commercial-order creation.
-- Standard platform pricing requires a platform-scoped pricing capability; a selected
-- Business override requires pricing authority in that Business scope. The Admin
-- onboarding read model exposes those authorities separately while preserving the
-- existing Admin-only initial-purchase command boundary.

create or replace function public.publish_sellertray_subscription_price_pair_admin(
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
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.pricing.manage',null,now()
  ) then
    raise exception 'Platform pricing management capability required' using errcode='42501';
  end if;

  return public.publish_sellertray_subscription_price_pair_admin_impl(
    p_plan_code,
    p_currency,
    p_monthly_gross_amount,
    p_tax_rate_percent,
    p_effective_from,
    p_reason,
    p_actor_user_id
  );
end;
$$;

create or replace function public.publish_sellertray_branch_setup_price_admin(
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
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.pricing.manage',null,now()
  ) then
    raise exception 'Platform pricing management capability required' using errcode='42501';
  end if;

  return public.publish_sellertray_branch_setup_price_admin_impl(
    p_currency,
    p_gross_amount,
    p_tax_rate_percent,
    p_effective_from,
    p_reason,
    p_actor_user_id
  );
end;
$$;

revoke all on function public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid) to service_role;
grant execute on function public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid) to service_role;

comment on function public.publish_sellertray_subscription_price_pair_admin(text,text,numeric,numeric,timestamptz,text,uuid) is
  'Publishes immutable platform-wide SellerTray subscription prices only for an actor with platform-scoped admin.pricing.manage authority. Transport remains service-role-only and Admin AAL2-gated.';
comment on function public.publish_sellertray_branch_setup_price_admin(text,numeric,numeric,timestamptz,text,uuid) is
  'Publishes immutable platform-wide SellerTray Branch setup pricing only for an actor with platform-scoped admin.pricing.manage authority. Transport remains service-role-only and Admin AAL2-gated.';

create or replace function public.get_sellertray_commercial_onboarding_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
set search_path=''
as $$
declare
  v_role text;
  v_result jsonb;
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

  return v_result || jsonb_build_object(
    -- Preserve the existing commercial-order mutation contract. The initial
    -- purchase command still requires the Platform Admin role independently of
    -- pricing authority.
    'canManage',v_role='admin',
    -- Standard platform pricing is deliberately platform-scoped.
    'canManageGlobalPricing',public.platform_admin_has_capability(
      p_actor_user_id,'admin.pricing.manage',null,now()
    ),
    -- Merchant-specific negotiated pricing may be narrower than platform scope.
    'canManageMerchantPricing',public.platform_admin_has_capability(
      p_actor_user_id,'admin.pricing.manage',p_tenant_id,now()
    )
  );
end;
$$;

comment on function public.get_sellertray_commercial_onboarding_admin(uuid,uuid) is
  'Admin commercial onboarding read model with distinct initial-purchase, platform-pricing and Business-pricing authority flags. Does not merge those permissions.';

commit;
