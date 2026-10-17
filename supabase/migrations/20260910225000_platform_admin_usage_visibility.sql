create or replace function public.platform_admin_overview(p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_tenants jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id = p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb)
  into v_tenants
  from (
    select
      t.id,
      t.name,
      t.slug,
      t.business_email as "businessEmail",
      t.business_phone as "businessPhone",
      t.onboarding_status as "onboardingStatus",
      t.whatsapp_connection_status as "whatsappStatus",
      t.subscription_status as "subscriptionStatus",
      s.plan_code as "planCode",
      s.trial_ends_at as "trialEndsAt",
      s.current_period_end as "currentPeriodEnd",
      s.grace_ends_at as "graceEndsAt",
      case
        when s.status = 'active' then 'full'
        when s.status = 'trial' and (s.trial_ends_at is null or s.trial_ends_at > now()) then 'full'
        when s.status = 'grace' and (s.grace_ends_at is null or s.grace_ends_at > now()) then 'full'
        else 'read_only'
      end as "accessMode",
      coalesce(o.orders_30d, 0) as "orders30d",
      coalesce(o.needs_review, 0) as "needsReview",
      o.last_order_at as "lastOrderAt",
      i.last_inbound_at as "lastInboundAt",
      coalesce(n.notification_exceptions, 0) as "notificationExceptions",
      coalesce(m.team_members, 0) as "teamMembers",
      coalesce(u.usage_units_period, 0) as "usageUnitsPeriod",
      coalesce(u.usage_amount_period, 0) as "usageAmountPeriod",
      p.usage_unit_price as "usageUnitPrice",
      coalesce(p.currency, t.currency, 'NGN') as "currency",
      notes.support_note as "supportNote",
      notes.updated_at as "supportNoteUpdatedAt"
    from public.tenants t
    left join public.tenant_subscriptions s on s.tenant_id = t.id
    left join public.subscription_plans p on p.code = s.plan_code
    left join lateral (
      select
        count(*) filter (where o.created_at >= now() - interval '30 days')::int as orders_30d,
        count(*) filter (where o.status in ('draft', 'needs_review'))::int as needs_review,
        max(o.created_at) as last_order_at
      from public.orders o
      where o.tenant_id = t.id
    ) o on true
    left join lateral (
      select max(im.received_at) as last_inbound_at
      from public.inbound_messages im
      where im.tenant_id = t.id
    ) i on true
    left join lateral (
      select count(*) filter (where onf.delivery_status in ('failed', 'template_required'))::int as notification_exceptions
      from public.outbound_notifications onf
      where onf.tenant_id = t.id
    ) n on true
    left join lateral (
      select count(*)::int as team_members
      from public.tenant_members tm
      where tm.tenant_id = t.id
    ) m on true
    left join lateral (
      select
        coalesce(sum(ue.quantity), 0)::int as usage_units_period,
        coalesce(sum(ue.amount), 0)::numeric as usage_amount_period
      from public.usage_events ue
      where ue.tenant_id = t.id
        and ue.event_code = coalesce(p.usage_event_code, 'AI_ORDER_ACTIVITY')
        and ue.occurred_at >= coalesce(s.current_period_start, s.trial_started_at, date_trunc('month', now()))
        and ue.occurred_at < coalesce(s.current_period_end, s.trial_ends_at, date_trunc('month', now()) + interval '1 month')
    ) u on true
    left join public.tenant_admin_notes notes on notes.tenant_id = t.id
  ) x;

  return jsonb_build_object(
    'actorRole', v_role,
    'generatedAt', now(),
    'tenants', v_tenants
  );
end;
$$;
