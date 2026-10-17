create or replace function public.get_orderdesk_business_insights(p_tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with tenant_context as (
  select t.id, t.timezone
  from public.tenants t
  where t.id = p_tenant_id
),
order_values as (
  select
    o.id,
    o.status,
    o.created_at,
    case
      when count(oi.id) = 0 or bool_or(oi.unit_price is null) then null
      else coalesce(sum(oi.line_total), 0)
    end as order_value
  from public.orders o
  join tenant_context tc on tc.id = o.tenant_id
  left join public.order_items oi
    on oi.tenant_id = o.tenant_id and oi.order_id = o.id
  where o.created_at >= now() - interval '30 days'
  group by o.id, o.status, o.created_at
),
today_metrics as (
  select
    count(*) filter (
      where (ov.created_at at time zone tc.timezone)::date = (now() at time zone tc.timezone)::date
    )::integer as orders,
    count(*) filter (
      where (ov.created_at at time zone tc.timezone)::date = (now() at time zone tc.timezone)::date
        and ov.status in ('draft', 'needs_review')
    )::integer as needs_review,
    count(*) filter (
      where (ov.created_at at time zone tc.timezone)::date = (now() at time zone tc.timezone)::date
        and ov.status in ('accepted', 'processing', 'ready')
    )::integer as in_progress,
    count(*) filter (
      where (ov.created_at at time zone tc.timezone)::date = (now() at time zone tc.timezone)::date
        and ov.status = 'completed'
    )::integer as completed,
    coalesce(sum(ov.order_value) filter (
      where (ov.created_at at time zone tc.timezone)::date = (now() at time zone tc.timezone)::date
        and ov.status not in ('rejected', 'cancelled')
    ), 0) as known_value
  from tenant_context tc
  left join order_values ov on true
),
seven_day as (
  select
    count(*) filter (where ov.created_at >= now() - interval '7 days')::integer as orders,
    count(*) filter (where ov.created_at >= now() - interval '7 days' and ov.status = 'completed')::integer as completed,
    count(*) filter (where ov.created_at >= now() - interval '7 days' and ov.status in ('rejected', 'cancelled'))::integer as closed_unsuccessful,
    coalesce(sum(ov.order_value) filter (
      where ov.created_at >= now() - interval '7 days' and ov.status not in ('rejected', 'cancelled')
    ), 0) as known_value,
    count(*) filter (
      where ov.created_at >= now() - interval '14 days' and ov.created_at < now() - interval '7 days'
    )::integer as previous_orders,
    coalesce(sum(ov.order_value) filter (
      where ov.created_at >= now() - interval '14 days'
        and ov.created_at < now() - interval '7 days'
        and ov.status not in ('rejected', 'cancelled')
    ), 0) as previous_known_value
  from order_values ov
),
thirty_day as (
  select
    count(*)::integer as orders,
    count(*) filter (where ov.status = 'completed')::integer as completed,
    count(*) filter (where ov.status in ('rejected', 'cancelled'))::integer as closed_unsuccessful,
    coalesce(sum(ov.order_value) filter (where ov.status not in ('rejected', 'cancelled')), 0) as known_value
  from order_values ov
),
top_items as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', ranked.item_name,
      'quantity', ranked.quantity,
      'value', ranked.value
    ) order by ranked.quantity desc, ranked.value desc, ranked.item_name
  ), '[]'::jsonb) as items
  from (
    select
      oi.item_name,
      sum(oi.quantity) as quantity,
      coalesce(sum(oi.line_total), 0) as value
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.tenant_id = oi.tenant_id
    where o.tenant_id = p_tenant_id
      and o.created_at >= now() - interval '30 days'
      and o.status not in ('rejected', 'cancelled')
    group by oi.item_name
    order by sum(oi.quantity) desc, coalesce(sum(oi.line_total), 0) desc, oi.item_name
    limit 5
  ) ranked
)
select jsonb_build_object(
  'today', jsonb_build_object(
    'orders', coalesce(tm.orders, 0),
    'needsReview', coalesce(tm.needs_review, 0),
    'inProgress', coalesce(tm.in_progress, 0),
    'completed', coalesce(tm.completed, 0),
    'knownValue', coalesce(tm.known_value, 0)
  ),
  'sevenDays', jsonb_build_object(
    'orders', coalesce(sd.orders, 0),
    'completed', coalesce(sd.completed, 0),
    'closedUnsuccessful', coalesce(sd.closed_unsuccessful, 0),
    'knownValue', coalesce(sd.known_value, 0),
    'completionRate', case when coalesce(sd.orders, 0) = 0 then 0 else round((sd.completed::numeric / sd.orders::numeric) * 100, 1) end,
    'previousOrders', coalesce(sd.previous_orders, 0),
    'previousKnownValue', coalesce(sd.previous_known_value, 0)
  ),
  'thirtyDays', jsonb_build_object(
    'orders', coalesce(td.orders, 0),
    'completed', coalesce(td.completed, 0),
    'closedUnsuccessful', coalesce(td.closed_unsuccessful, 0),
    'knownValue', coalesce(td.known_value, 0),
    'completionRate', case when coalesce(td.orders, 0) = 0 then 0 else round((td.completed::numeric / td.orders::numeric) * 100, 1) end
  ),
  'topItems', coalesce(ti.items, '[]'::jsonb)
)
from today_metrics tm
cross join seven_day sd
cross join thirty_day td
cross join top_items ti;
$$;

revoke all on function public.get_orderdesk_business_insights(uuid) from public, anon;
grant execute on function public.get_orderdesk_business_insights(uuid) to authenticated;
