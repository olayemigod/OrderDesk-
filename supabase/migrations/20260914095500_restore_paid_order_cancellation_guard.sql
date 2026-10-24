create or replace function public.guard_order_status_transition()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_decision jsonb;
begin
  if new.status = old.status then return new; end if;

  if old.status in ('completed','rejected','cancelled') then
    raise exception 'Order status % is terminal',old.status using errcode='23514';
  end if;

  if new.status='accepted' then
    if old.status not in ('draft','needs_review') then
      raise exception 'Order cannot move from % to accepted',old.status using errcode='23514';
    end if;

    if not exists(
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id
    ) then
      raise exception 'Order must contain at least one item before acceptance' using errcode='23514';
    end if;

    if exists(
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id and oi.unit_price is null
    ) then
      raise exception 'All order items must be priced before acceptance' using errcode='23514';
    end if;

    if exists(
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id
        and oi.catalog_item_id is null
        and oi.match_source='unmatched'
    ) then
      raise exception 'Resolve unmatched catalogue items or explicitly keep them as one-off before acceptance' using errcode='23514';
    end if;

    return new;
  end if;

  if new.status='rejected' and old.status in ('draft','needs_review') then
    return new;
  end if;

  if new.status='processing' and old.status='accepted' then
    v_decision := public.sellertray_payment_gate_decision(new.id,'processing');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%',coalesce(v_decision->>'reason','Payment policy blocks processing') using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='ready' and old.status='processing' then
    v_decision := public.sellertray_payment_gate_decision(new.id,'ready');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%',coalesce(v_decision->>'reason','Payment policy blocks ready status') using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='completed' and old.status='ready' then
    if new.fulfillment_method is null
       or new.fulfillment_status not in ('delivered','collected')
       or new.fulfilled_at is null
       or new.fulfillment_confirmed_by not in ('merchant','customer_whatsapp') then
      raise exception 'Completed SellerTray orders require governed fulfillment evidence' using errcode='23514';
    end if;

    if new.fulfillment_method='customer_pickup' and new.fulfillment_status<>'collected' then
      raise exception 'Customer pickup must complete as collected' using errcode='23514';
    end if;

    if new.fulfillment_method in ('merchant_delivery','third_party_delivery')
       and new.fulfillment_status<>'delivered' then
      raise exception 'Delivery fulfillment must complete as delivered' using errcode='23514';
    end if;

    v_decision := public.sellertray_payment_gate_decision(new.id,'complete');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%',coalesce(v_decision->>'reason','Payment policy blocks completion') using errcode='23514';
    end if;

    return new;
  end if;

  if new.status='cancelled' and old.status in ('accepted','processing','ready') then
    if coalesce(old.amount_paid,0) > 0
       or old.payment_status in ('paid','verification_required','payment_issue') then
      raise exception 'Resolve the existing payment, verification, refund or reversal before cancelling this order'
        using errcode='23514';
    end if;
    return new;
  end if;

  raise exception 'Invalid order status transition: % -> %',old.status,new.status using errcode='23514';
end;
$$;
