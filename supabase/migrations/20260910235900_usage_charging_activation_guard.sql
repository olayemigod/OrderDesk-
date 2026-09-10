alter table public.subscription_plans
  add column if not exists usage_charging_enabled boolean not null default false;

create or replace function public.orderdesk_usage_charging_enabled(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.usage_charging_enabled
    from public.tenant_subscriptions s
    join public.subscription_plans p on p.code = s.plan_code
    where s.tenant_id = p_tenant_id
  ), false);
$$;

revoke all on function public.orderdesk_usage_charging_enabled(uuid)
  from public, anon, authenticated;
grant execute on function public.orderdesk_usage_charging_enabled(uuid)
  to service_role;
