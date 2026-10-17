create table if not exists public.subscription_plans (
  code text primary key,
  name text not null,
  billing_interval text not null default 'month' check (billing_interval in ('month')),
  currency text not null default 'NGN' check (char_length(currency) = 3),
  price_amount numeric(14,2) check (price_amount is null or price_amount >= 0),
  trial_days integer not null default 14 check (trial_days between 0 and 90),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.subscription_plans (code, name, billing_interval, currency, price_amount, trial_days, is_active)
values ('business', 'OrderDesk Business', 'month', 'NGN', null, 14, true)
on conflict (code) do update
set name = excluded.name,
    billing_interval = excluded.billing_interval,
    currency = excluded.currency,
    trial_days = excluded.trial_days,
    is_active = excluded.is_active,
    updated_at = now();

create table if not exists public.tenant_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_code text not null default 'business' references public.subscription_plans(code),
  status text not null default 'trial' check (
    status in ('trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled')
  ),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  provider text,
  provider_customer_ref text,
  provider_subscription_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.tenant_subscriptions (
  tenant_id,
  plan_code,
  status,
  trial_started_at,
  trial_ends_at
)
select
  t.id,
  'business',
  t.subscription_status,
  case when t.subscription_status = 'trial' then t.created_at else null end,
  case when t.subscription_status = 'trial' then t.created_at + make_interval(days => coalesce(p.trial_days, 14)) else null end
from public.tenants t
left join public.subscription_plans p on p.code = 'business'
on conflict (tenant_id) do nothing;

alter table public.subscription_plans enable row level security;
alter table public.tenant_subscriptions enable row level security;

revoke all on table public.subscription_plans from anon, authenticated;
revoke all on table public.tenant_subscriptions from anon, authenticated;
grant select on table public.subscription_plans to authenticated;
grant select on table public.tenant_subscriptions to authenticated;

create policy subscription_plans_select_authenticated
on public.subscription_plans
for select
to authenticated
using (true);

create policy tenant_subscriptions_select_member
on public.tenant_subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenant_subscriptions.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

create or replace function public.ensure_orderdesk_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial_days integer := 14;
begin
  select coalesce(p.trial_days, 14)
  into v_trial_days
  from public.subscription_plans p
  where p.code = 'business';

  insert into public.tenant_subscriptions (
    tenant_id,
    plan_code,
    status,
    trial_started_at,
    trial_ends_at
  ) values (
    new.id,
    'business',
    'trial',
    now(),
    now() + make_interval(days => v_trial_days)
  )
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

revoke all on function public.ensure_orderdesk_subscription() from public, anon, authenticated;

drop trigger if exists ensure_orderdesk_subscription on public.tenants;
create trigger ensure_orderdesk_subscription
after insert on public.tenants
for each row
execute function public.ensure_orderdesk_subscription();

create or replace function public.sync_orderdesk_subscription_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tenants
  set subscription_status = new.status,
      updated_at = now()
  where id = new.tenant_id
    and subscription_status is distinct from new.status;
  return new;
end;
$$;

revoke all on function public.sync_orderdesk_subscription_status() from public, anon, authenticated;

drop trigger if exists sync_orderdesk_subscription_status on public.tenant_subscriptions;
create trigger sync_orderdesk_subscription_status
after insert or update of status on public.tenant_subscriptions
for each row
execute function public.sync_orderdesk_subscription_status();

create or replace function public.get_orderdesk_subscription_access(p_tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'planCode', s.plan_code,
    'planName', p.name,
    'baseStatus', s.status,
    'effectiveStatus', case
      when s.status = 'trial' and s.trial_ends_at is not null and s.trial_ends_at <= now() then 'trial_expired'
      when s.status = 'grace' and s.grace_ends_at is not null and s.grace_ends_at <= now() then 'grace_expired'
      else s.status
    end,
    'accessMode', case
      when s.status = 'active' then 'full'
      when s.status = 'trial' and (s.trial_ends_at is null or s.trial_ends_at > now()) then 'full'
      when s.status = 'grace' and (s.grace_ends_at is null or s.grace_ends_at > now()) then 'full'
      else 'read_only'
    end,
    'trialStartedAt', s.trial_started_at,
    'trialEndsAt', s.trial_ends_at,
    'currentPeriodStart', s.current_period_start,
    'currentPeriodEnd', s.current_period_end,
    'graceEndsAt', s.grace_ends_at,
    'cancelAtPeriodEnd', s.cancel_at_period_end,
    'currency', p.currency,
    'priceAmount', p.price_amount,
    'billingInterval', p.billing_interval
  )
  from public.tenant_subscriptions s
  join public.subscription_plans p on p.code = s.plan_code
  where s.tenant_id = p_tenant_id;
$$;

revoke all on function public.get_orderdesk_subscription_access(uuid) from public, anon;
grant execute on function public.get_orderdesk_subscription_access(uuid) to authenticated, service_role;

create or replace function public.orderdesk_subscription_can_write(p_tenant_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when s.status = 'active' then true
        when s.status = 'trial' then s.trial_ends_at is null or s.trial_ends_at > now()
        when s.status = 'grace' then s.grace_ends_at is null or s.grace_ends_at > now()
        else false
      end
      from public.tenant_subscriptions s
      where s.tenant_id = p_tenant_id
    ),
    false
  );
$$;

revoke all on function public.orderdesk_subscription_can_write(uuid) from public, anon;
grant execute on function public.orderdesk_subscription_can_write(uuid) to authenticated, service_role;

create or replace function public.guard_orderdesk_subscription_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);

  if not public.orderdesk_subscription_can_write(v_tenant_id) then
    raise exception 'OrderDesk subscription is read-only. Renew or reactivate the business to make changes.'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_orderdesk_subscription_write() from public, anon, authenticated;

drop trigger if exists guard_subscription_orders on public.orders;
create trigger guard_subscription_orders
before insert or update or delete on public.orders
for each row execute function public.guard_orderdesk_subscription_write();

drop trigger if exists guard_subscription_order_items on public.order_items;
create trigger guard_subscription_order_items
before insert or update or delete on public.order_items
for each row execute function public.guard_orderdesk_subscription_write();

drop trigger if exists guard_subscription_catalog_items on public.catalog_items;
create trigger guard_subscription_catalog_items
before insert or update or delete on public.catalog_items
for each row execute function public.guard_orderdesk_subscription_write();

drop trigger if exists guard_subscription_catalog_aliases on public.catalog_item_aliases;
create trigger guard_subscription_catalog_aliases
before insert or update or delete on public.catalog_item_aliases
for each row execute function public.guard_orderdesk_subscription_write();

drop trigger if exists guard_subscription_notification_settings on public.tenant_notification_settings;
create trigger guard_subscription_notification_settings
before update on public.tenant_notification_settings
for each row execute function public.guard_orderdesk_subscription_write();
