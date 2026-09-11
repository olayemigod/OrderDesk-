alter table public.ai_parser_attempts
  add column if not exists catalogue_items_total integer,
  add column if not exists catalogue_items_sent integer,
  add column if not exists catalogue_aliases_sent integer;

alter table public.ai_parser_attempts
  drop constraint if exists ai_parser_attempts_catalogue_total_check,
  add constraint ai_parser_attempts_catalogue_total_check
    check (catalogue_items_total is null or catalogue_items_total >= 0),
  drop constraint if exists ai_parser_attempts_catalogue_sent_check,
  add constraint ai_parser_attempts_catalogue_sent_check
    check (catalogue_items_sent is null or catalogue_items_sent >= 0),
  drop constraint if exists ai_parser_attempts_aliases_sent_check,
  add constraint ai_parser_attempts_aliases_sent_check
    check (catalogue_aliases_sent is null or catalogue_aliases_sent >= 0),
  drop constraint if exists ai_parser_attempts_catalogue_budget_check,
  add constraint ai_parser_attempts_catalogue_budget_check
    check (
      catalogue_items_total is null
      or catalogue_items_sent is null
      or catalogue_items_sent <= catalogue_items_total
    );

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
      coalesce(ba.authorization_ready, false) as "usageAuthorizationReady",
      coalesce(us.outstanding_amount, 0) as "usageOutstandingAmount",
      coalesce(us.failed_count, 0) as "usageFailedSettlements",
      coalesce(ai.attempts_period, 0) as "aiParserAttemptsPeriod",
      coalesce(ai.successes_period, 0) as "aiParserSuccessesPeriod",
      coalesce(ai.non_success_period, 0) as "aiParserNonSuccessPeriod",
      coalesce(ai.input_tokens_period, 0) as "aiInputTokensPeriod",
      coalesce(ai.cached_input_tokens_period, 0) as "aiCachedInputTokensPeriod",
      coalesce(ai.output_tokens_period, 0) as "aiOutputTokensPeriod",
      coalesce(ai.reasoning_tokens_period, 0) as "aiReasoningTokensPeriod",
      coalesce(ai.total_tokens_period, 0) as "aiTotalTokensPeriod",
      coalesce(ai.catalogue_total_max, 0) as "aiCatalogueItemsTotalMax",
      coalesce(ai.catalogue_sent_avg, 0) as "aiCatalogueItemsSentAvg",
      coalesce(ai.catalogue_aliases_avg, 0) as "aiCatalogueAliasesSentAvg",
      ai.last_model as "aiParserModel",
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
    left join lateral (
      select exists (
        select 1
        from public.billing_payment_authorizations bpa
        where bpa.tenant_id = t.id
          and bpa.provider = 'paystack'
          and bpa.status = 'active'
          and bpa.reusable = true
      ) as authorization_ready
    ) ba on true
    left join lateral (
      select
        coalesce(sum(ust.amount) filter (where ust.status in ('pending', 'submitted', 'failed')), 0)::numeric as outstanding_amount,
        count(*) filter (where ust.status = 'failed')::int as failed_count
      from public.usage_settlements ust
      where ust.tenant_id = t.id
    ) us on true
    left join lateral (
      select
        count(*)::int as attempts_period,
        count(*) filter (where apa.outcome = 'success')::int as successes_period,
        count(*) filter (where apa.outcome <> 'success')::int as non_success_period,
        coalesce(sum(apa.input_tokens), 0)::bigint as input_tokens_period,
        coalesce(sum(apa.cached_input_tokens), 0)::bigint as cached_input_tokens_period,
        coalesce(sum(apa.output_tokens), 0)::bigint as output_tokens_period,
        coalesce(sum(apa.reasoning_tokens), 0)::bigint as reasoning_tokens_period,
        coalesce(sum(apa.total_tokens), 0)::bigint as total_tokens_period,
        coalesce(max(apa.catalogue_items_total), 0)::int as catalogue_total_max,
        coalesce(round(avg(apa.catalogue_items_sent)::numeric, 1), 0) as catalogue_sent_avg,
        coalesce(round(avg(apa.catalogue_aliases_sent)::numeric, 1), 0) as catalogue_aliases_avg,
        (array_agg(apa.model order by apa.created_at desc) filter (where apa.model is not null))[1] as last_model
      from public.ai_parser_attempts apa
      where apa.tenant_id = t.id
        and apa.created_at >= coalesce(s.current_period_start, s.trial_started_at, date_trunc('month', now()))
        and apa.created_at < coalesce(s.current_period_end, s.trial_ends_at, date_trunc('month', now()) + interval '1 month')
    ) ai on true
    left join public.tenant_admin_notes notes on notes.tenant_id = t.id
  ) x;

  return jsonb_build_object(
    'actorRole', v_role,
    'generatedAt', now(),
    'tenants', v_tenants
  );
end;
$$;

revoke all on function public.platform_admin_overview(uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_overview(uuid) to service_role;
