begin;

create or replace function public.platform_admin_bootstrap(p_actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  return jsonb_build_object(
    'actorRole',v_role,
    'generatedAt',now(),
    'merchantCount',(select count(*)::integer from public.tenants),
    'legacyTrialRecords',(
      select count(*)::integer
      from public.tenants t
      left join public.tenant_subscriptions s on s.tenant_id=t.id
      where coalesce(s.status,t.subscription_status)='trial'
    )
  );
end;
$$;

create or replace function public.platform_admin_operations_summary(p_actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  with tenant_periods as materialized (
    select
      t.id,
      t.whatsapp_connection_status,
      coalesce(p.usage_event_code,'AI_ORDER_ACTIVITY') usage_event_code,
      coalesce(s.current_period_start,s.trial_started_at,date_trunc('month',now())) period_start,
      coalesce(s.current_period_end,s.trial_ends_at,date_trunc('month',now())+interval '1 month') period_end
    from public.tenants t
    left join public.tenant_subscriptions s on s.tenant_id=t.id
    left join public.subscription_plans p on p.code=s.plan_code
  ), ai as materialized (
    select
      count(*)::integer attempts,
      count(*) filter(where a.outcome='success')::integer successes,
      count(*) filter(where a.outcome<>'success')::integer non_success,
      count(distinct a.tenant_id)::integer tenants_with_attempts,
      coalesce(sum(a.input_tokens),0)::bigint input_tokens,
      coalesce(sum(a.cached_input_tokens),0)::bigint cached_input_tokens,
      coalesce(sum(a.output_tokens),0)::bigint output_tokens,
      coalesce(sum(a.reasoning_tokens),0)::bigint reasoning_tokens,
      coalesce(sum(a.total_tokens),0)::bigint total_tokens,
      coalesce(max(a.catalogue_items_total),0)::integer catalogue_total_max,
      coalesce(round(sum(coalesce(a.catalogue_items_sent,0))::numeric/nullif(count(*),0),1),0) catalogue_sent_avg,
      coalesce(round(sum(coalesce(a.catalogue_aliases_sent,0))::numeric/nullif(count(*),0),1),0) catalogue_aliases_avg,
      (array_agg(a.model order by a.created_at desc) filter(where a.model is not null))[1] latest_model
    from public.ai_parser_attempts a
    join tenant_periods tp on tp.id=a.tenant_id
    where a.created_at>=tp.period_start and a.created_at<tp.period_end
  ), usage as materialized (
    select coalesce(sum(u.quantity),0)::integer metered_external_order_units
    from public.usage_events u
    join tenant_periods tp on tp.id=u.tenant_id
    where u.event_code=tp.usage_event_code
      and u.occurred_at>=tp.period_start and u.occurred_at<tp.period_end
  )
  select jsonb_build_object(
    'actorRole',v_role,
    'generatedAt',now(),
    'merchantCount',(select count(*)::integer from tenant_periods),
    'whatsapp',jsonb_build_object(
      'connected',(select count(*) filter(where whatsapp_connection_status='connected')::integer from tenant_periods),
      'errors',(select count(*) filter(where whatsapp_connection_status='error')::integer from tenant_periods),
      'pending',(select count(*) filter(where whatsapp_connection_status='pending')::integer from tenant_periods),
      'notConnected',(select count(*) filter(where whatsapp_connection_status='not_connected')::integer from tenant_periods)
    ),
    'ai',jsonb_build_object(
      'tenantsWithAttempts',ai.tenants_with_attempts,
      'attempts',ai.attempts,
      'successes',ai.successes,
      'nonSuccess',ai.non_success,
      'inputTokens',ai.input_tokens,
      'cachedInputTokens',ai.cached_input_tokens,
      'outputTokens',ai.output_tokens,
      'reasoningTokens',ai.reasoning_tokens,
      'totalTokens',ai.total_tokens,
      'meteredExternalOrderUnits',usage.metered_external_order_units,
      'catalogueItemsTotalMax',ai.catalogue_total_max,
      'catalogueItemsSentAvg',ai.catalogue_sent_avg,
      'catalogueAliasesSentAvg',ai.catalogue_aliases_avg,
      'latestObservedModel',ai.latest_model
    )
  ) into v_result
  from ai cross join usage;

  return v_result;
end;
$$;

revoke all on function public.platform_admin_bootstrap(uuid) from public,anon,authenticated;
revoke all on function public.platform_admin_operations_summary(uuid) from public,anon,authenticated;
grant execute on function public.platform_admin_bootstrap(uuid) to service_role;
grant execute on function public.platform_admin_operations_summary(uuid) to service_role;

commit;
