create or replace function public.prepare_orderdesk_usage_settlement(
  p_tenant_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.usage_settlements%rowtype;
  v_currency text;
  v_units integer;
  v_amount numeric(14, 2);
  v_settlement_id uuid;
  v_provider_reference text;
begin
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception 'Invalid usage settlement period';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(p_period_start::text || ':' || p_period_end::text)
  );

  select *
  into v_existing
  from public.usage_settlements
  where tenant_id = p_tenant_id
    and event_code = 'AI_ORDER_ACTIVITY'
    and period_start = p_period_start
    and period_end = p_period_end;

  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.status,
      'units', v_existing.units,
      'amount', v_existing.amount,
      'currency', v_existing.currency,
      'providerReference', v_existing.provider_reference,
      'existing', true
    );
  end if;

  select p.currency
    into v_currency
  from public.tenant_subscriptions s
  join public.subscription_plans p on p.code = s.plan_code
  where s.tenant_id = p_tenant_id;

  if v_currency is null then
    raise exception 'Subscription plan not found for usage settlement';
  end if;

  select
    coalesce(sum(u.quantity), 0)::integer,
    coalesce(sum(u.amount), 0)::numeric(14, 2)
  into v_units, v_amount
  from public.usage_events u
  where u.tenant_id = p_tenant_id
    and u.event_code = 'AI_ORDER_ACTIVITY'
    and u.billing_period_start = p_period_start
    and u.billing_period_end = p_period_end
    and u.amount is not null
    and u.amount > 0
    and not exists (
      select 1
      from public.usage_settlement_items usi
      where usi.usage_event_id = u.id
    );

  if v_units <= 0 or v_amount <= 0 then
    return jsonb_build_object(
      'status', 'empty',
      'units', 0,
      'amount', 0,
      'currency', v_currency,
      'existing', false
    );
  end if;

  v_settlement_id := gen_random_uuid();
  v_provider_reference := 'su-' || replace(v_settlement_id::text, '-', '');

  insert into public.usage_settlements (
    id, tenant_id, event_code, period_start, period_end, currency,
    units, amount, status, provider, provider_reference
  ) values (
    v_settlement_id, p_tenant_id, 'AI_ORDER_ACTIVITY', p_period_start, p_period_end,
    v_currency, v_units, v_amount, 'pending', 'paystack', v_provider_reference
  );

  insert into public.usage_settlement_items (settlement_id, usage_event_id, amount)
  select v_settlement_id, u.id, u.amount
  from public.usage_events u
  where u.tenant_id = p_tenant_id
    and u.event_code = 'AI_ORDER_ACTIVITY'
    and u.billing_period_start = p_period_start
    and u.billing_period_end = p_period_end
    and u.amount is not null
    and u.amount > 0
    and not exists (
      select 1
      from public.usage_settlement_items usi
      where usi.usage_event_id = u.id
    );

  return jsonb_build_object(
    'id', v_settlement_id,
    'status', 'pending',
    'units', v_units,
    'amount', v_amount,
    'currency', v_currency,
    'providerReference', v_provider_reference,
    'existing', false
  );
end;
$$;

revoke all on function public.prepare_orderdesk_usage_settlement(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.prepare_orderdesk_usage_settlement(uuid, timestamptz, timestamptz)
  to service_role;
