alter table public.usage_events
  add column if not exists billing_period_start timestamptz,
  add column if not exists billing_period_end timestamptz;

alter table public.usage_events
  drop constraint if exists usage_events_billing_period_check,
  add constraint usage_events_billing_period_check
    check (
      (billing_period_start is null and billing_period_end is null)
      or (
        billing_period_start is not null
        and billing_period_end is not null
        and billing_period_end > billing_period_start
      )
    );

create index if not exists usage_events_billable_period_idx
  on public.usage_events (tenant_id, billing_period_end, billing_period_start)
  where amount is not null and amount > 0;

create table if not exists public.billing_payment_authorizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'paystack',
  billing_email text not null,
  provider_customer_ref text,
  authorization_ciphertext text not null,
  authorization_iv text not null,
  encryption_key_version integer not null default 1,
  channel text,
  reusable boolean not null default true,
  status text not null default 'active',
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_payment_authorizations_provider_check check (provider = 'paystack'),
  constraint billing_payment_authorizations_status_check check (status in ('active', 'disabled')),
  constraint billing_payment_authorizations_key_version_check check (encryption_key_version > 0),
  unique (tenant_id, provider)
);

alter table public.billing_payment_authorizations enable row level security;
revoke all on table public.billing_payment_authorizations from public, anon, authenticated;
grant all on table public.billing_payment_authorizations to service_role;

create table if not exists public.usage_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_code text not null default 'AI_ORDER_ACTIVITY',
  period_start timestamptz not null,
  period_end timestamptz not null,
  currency text not null,
  units integer not null,
  amount numeric(14, 2) not null,
  status text not null default 'pending',
  provider text not null default 'paystack',
  provider_reference text not null,
  provider_transaction_ref text,
  last_error text,
  prepared_at timestamptz not null default now(),
  submitted_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint usage_settlements_event_code_check check (event_code = 'AI_ORDER_ACTIVITY'),
  constraint usage_settlements_period_check check (period_end > period_start),
  constraint usage_settlements_units_check check (units > 0),
  constraint usage_settlements_amount_check check (amount > 0),
  constraint usage_settlements_provider_check check (provider = 'paystack'),
  constraint usage_settlements_status_check check (status in ('pending', 'submitted', 'paid', 'failed', 'cancelled')),
  unique (tenant_id, event_code, period_start, period_end),
  unique (provider_reference)
);

create index if not exists usage_settlements_tenant_status_idx
  on public.usage_settlements (tenant_id, status, period_end desc);

alter table public.usage_settlements enable row level security;
revoke all on table public.usage_settlements from public, anon, authenticated;
grant all on table public.usage_settlements to service_role;

create table if not exists public.usage_settlement_items (
  settlement_id uuid not null references public.usage_settlements(id) on delete cascade,
  usage_event_id uuid not null references public.usage_events(id) on delete cascade,
  amount numeric(14, 2) not null,
  primary key (settlement_id, usage_event_id),
  unique (usage_event_id),
  constraint usage_settlement_items_amount_check check (amount > 0)
);

alter table public.usage_settlement_items enable row level security;
revoke all on table public.usage_settlement_items from public, anon, authenticated;
grant all on table public.usage_settlement_items to service_role;

create or replace function public.record_orderdesk_ai_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_unit_price numeric(14, 2);
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if new.parser_source is distinct from 'external' or new.source_message_id is null then
    return new;
  end if;

  select
    s.status,
    p.usage_unit_price,
    s.current_period_start,
    s.current_period_end
  into
    v_status,
    v_unit_price,
    v_period_start,
    v_period_end
  from public.tenant_subscriptions s
  join public.subscription_plans p on p.code = s.plan_code
  where s.tenant_id = new.tenant_id;

  if v_status not in ('active', 'grace')
    or v_unit_price is null
    or v_unit_price <= 0
    or v_period_start is null
    or v_period_end is null
    or v_period_end <= v_period_start
  then
    v_unit_price := null;
    v_period_start := null;
    v_period_end := null;
  end if;

  insert into public.usage_events (
    tenant_id,
    source_message_id,
    event_code,
    quantity,
    unit_price,
    billing_period_start,
    billing_period_end
  ) values (
    new.tenant_id,
    new.source_message_id,
    'AI_ORDER_ACTIVITY',
    1,
    v_unit_price,
    v_period_start,
    v_period_end
  )
  on conflict (source_message_id, event_code) do nothing;

  return new;
end;
$$;

revoke all on function public.record_orderdesk_ai_usage() from public, anon, authenticated;
grant execute on function public.record_orderdesk_ai_usage() to service_role;

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
    id,
    tenant_id,
    event_code,
    period_start,
    period_end,
    currency,
    units,
    amount,
    status,
    provider,
    provider_reference
  ) values (
    v_settlement_id,
    p_tenant_id,
    'AI_ORDER_ACTIVITY',
    p_period_start,
    p_period_end,
    v_currency,
    v_units,
    v_amount,
    'pending',
    'paystack',
    v_provider_reference
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
