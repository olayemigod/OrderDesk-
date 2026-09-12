-- SellerTray Phase 1 hardening: a ready order may become completed only
-- when the same update records governed fulfillment evidence.
-- Existing historical completed orders remain untouched.

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
    if new.fulfillment_method is null
       or new.fulfillment_status not in ('delivered', 'collected')
       or new.fulfilled_at is null
       or new.fulfillment_confirmed_by not in ('merchant', 'customer_whatsapp') then
      raise exception 'Completed SellerTray orders require governed fulfillment evidence'
        using errcode = '23514';
    end if;

    if new.fulfillment_method = 'customer_pickup'
       and new.fulfillment_status <> 'collected' then
      raise exception 'Customer pickup must complete as collected'
        using errcode = '23514';
    end if;

    if new.fulfillment_method in ('merchant_delivery', 'third_party_delivery')
       and new.fulfillment_status <> 'delivered' then
      raise exception 'Delivery fulfillment must complete as delivered'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status = 'cancelled' and old.status in ('accepted', 'processing', 'ready') then
    return new;
  end if;

  raise exception 'Invalid order status transition: % -> %', old.status, new.status using errcode = '23514';
end;
$$;
