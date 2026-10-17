create or replace function public.orderdesk_has_unsettled_usage(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usage_events u
    where u.tenant_id = p_tenant_id
      and u.amount is not null
      and u.amount > 0
      and not exists (
        select 1
        from public.usage_settlement_items usi
        join public.usage_settlements us on us.id = usi.settlement_id
        where usi.usage_event_id = u.id
          and us.status = 'paid'
      )
  );
$$;

revoke all on function public.orderdesk_has_unsettled_usage(uuid) from public, anon, authenticated;
grant execute on function public.orderdesk_has_unsettled_usage(uuid) to service_role;
