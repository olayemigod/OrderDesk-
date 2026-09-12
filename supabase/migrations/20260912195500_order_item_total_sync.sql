-- Keep orders.total_amount aligned with editable order lines.
-- Financially issued invoices already lock order_items via guard_invoiced_order_items.

create or replace function public.sync_sellertray_order_total_from_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_old_order_id uuid;
begin
  v_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  v_old_order_id := case when tg_op = 'UPDATE' then old.order_id else null end;

  update public.orders o
  set total_amount = totals.total_amount,
      updated_at = now()
  from (
    select
      oi.order_id,
      case
        when count(*) = 0 then 0::numeric
        when count(*) filter (where oi.unit_price is null) > 0 then null::numeric
        else coalesce(sum(oi.quantity * oi.unit_price), 0)::numeric
      end as total_amount
    from public.order_items oi
    where oi.order_id = v_order_id
    group by oi.order_id
  ) totals
  where o.id = v_order_id
    and totals.order_id = o.id;

  if not exists (select 1 from public.order_items oi where oi.order_id = v_order_id) then
    update public.orders
    set total_amount = 0,
        updated_at = now()
    where id = v_order_id;
  end if;

  if v_old_order_id is not null and v_old_order_id is distinct from v_order_id then
    update public.orders o
    set total_amount = coalesce((
          select case
            when count(*) filter (where oi.unit_price is null) > 0 then null::numeric
            else coalesce(sum(oi.quantity * oi.unit_price), 0)::numeric
          end
          from public.order_items oi
          where oi.order_id = v_old_order_id
        ), 0),
        updated_at = now()
    where o.id = v_old_order_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_sellertray_order_total on public.order_items;
create trigger sync_sellertray_order_total
after insert or update of quantity, unit_price, order_id or delete
on public.order_items
for each row
execute function public.sync_sellertray_order_total_from_items();

-- Reconcile existing rows once so the stored financial basis matches item lines.
update public.orders o
set total_amount = totals.total_amount,
    updated_at = now()
from (
  select
    o2.id as order_id,
    case
      when count(oi.id) = 0 then 0::numeric
      when count(oi.id) filter (where oi.unit_price is null) > 0 then null::numeric
      else coalesce(sum(oi.quantity * oi.unit_price), 0)::numeric
    end as total_amount
  from public.orders o2
  left join public.order_items oi on oi.order_id = o2.id
  group by o2.id
) totals
where totals.order_id = o.id
  and o.total_amount is distinct from totals.total_amount;
