-- Keep merchant workflow transitions valid even if a client is bypassed.
-- Acceptance also requires at least one priced line item.

create or replace function public.guard_order_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status in ('completed', 'rejected', 'cancelled') then
    raise exception 'Order status % is terminal', old.status using errcode = '23514';
  end if;

  if new.status = 'accepted' then
    if old.status not in ('draft', 'needs_review') then
      raise exception 'Order cannot move from % to accepted', old.status using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.order_items oi
      where oi.tenant_id = new.tenant_id
        and oi.order_id = new.id
    ) then
      raise exception 'Order must contain at least one item before acceptance' using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.order_items oi
      where oi.tenant_id = new.tenant_id
        and oi.order_id = new.id
        and oi.unit_price is null
    ) then
      raise exception 'All order items must be priced before acceptance' using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status = 'rejected' and old.status in ('draft', 'needs_review') then
    return new;
  end if;

  if new.status = 'processing' and old.status = 'accepted' then
    return new;
  end if;

  if new.status = 'ready' and old.status = 'processing' then
    return new;
  end if;

  if new.status = 'completed' and old.status = 'ready' then
    return new;
  end if;

  if new.status = 'cancelled' and old.status in ('accepted', 'processing', 'ready') then
    return new;
  end if;

  raise exception 'Invalid order status transition: % -> %', old.status, new.status using errcode = '23514';
end;
$$;

drop trigger if exists guard_order_status_transition on public.orders;
create trigger guard_order_status_transition
before update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function public.guard_order_status_transition();
