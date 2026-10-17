alter table public.subscription_plans
  add column if not exists provider text,
  add column if not exists provider_plan_ref text;

update public.subscription_plans
set provider = 'paystack', updated_at = now()
where code = 'business' and provider is null;

create table if not exists public.billing_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_code text not null references public.subscription_plans(code),
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  billing_email text not null,
  provider text not null check (provider in ('paystack')),
  reference text not null unique,
  authorization_url text,
  status text not null default 'initialized' check (status in ('initialized', 'paid', 'failed', 'expired')),
  provider_customer_ref text,
  provider_subscription_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_checkout_sessions_tenant_created_idx
  on public.billing_checkout_sessions (tenant_id, created_at desc);
create index if not exists billing_checkout_sessions_plan_idx
  on public.billing_checkout_sessions (plan_code);
create index if not exists billing_checkout_sessions_requested_by_idx
  on public.billing_checkout_sessions (requested_by_user_id);
create index if not exists billing_checkout_sessions_email_created_idx
  on public.billing_checkout_sessions (lower(billing_email), created_at desc);

alter table public.billing_checkout_sessions enable row level security;
revoke all on table public.billing_checkout_sessions from anon, authenticated;
grant select on table public.billing_checkout_sessions to authenticated;

create policy billing_checkout_sessions_select_owner_manager
on public.billing_checkout_sessions
for select
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = billing_checkout_sessions.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create table if not exists public.billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('paystack')),
  event_fingerprint text not null unique,
  event_type text not null,
  tenant_id uuid references public.tenants(id) on delete set null,
  provider_reference text,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz not null default now()
);

create index if not exists billing_provider_events_tenant_received_idx
  on public.billing_provider_events (tenant_id, received_at desc)
  where tenant_id is not null;

alter table public.billing_provider_events enable row level security;
revoke all on table public.billing_provider_events from anon, authenticated;

create policy billing_provider_events_explicit_client_deny
on public.billing_provider_events
for all
to authenticated
using (false)
with check (false);
