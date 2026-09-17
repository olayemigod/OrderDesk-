-- SellerTray P1 audit hardening: order-item financial/lifecycle integrity must not
-- depend on an invoice already existing. Draft/review orders remain editable;
-- accepted orders may be amended only while still fully unpaid and unfulfilled.

create or replace function public.guard_invoiced_order_items()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_has_sensitive_payment boolean := false;
  v_other_item_count integer := 0;
begin
  v_order_id := case when tg_op='DELETE' then old.order_id else new.order_id end;

  select *
  into v_order
  from public.orders o
  where o.id = v_order_id;

  if not found then
    raise exception 'SellerTray order not found' using errcode='22023';
  end if;

  -- Before acceptance, normal governed review/editing remains available.
  if v_order.status in ('draft','needs_review') then
    return case when tg_op='DELETE' then old else new end;
  end if;

  -- Once accepted, amendments are allowed only before any money claim/receipt or
  -- fulfilment activity. Initiated payment attempts are intentionally not treated
  -- as sensitive here because the post-change synchronizer cancels stale attempts.
  if v_order.status = 'accepted' then
    select exists (
      select 1
      from public.order_payments p
      where p.order_id = v_order_id
        and p.status in ('pending_verification','confirmed')
    )
    into v_has_sensitive_payment;

    if not (
      v_order.payment_status in ('unpaid','pending')
      and coalesce(v_order.amount_paid,0) = 0
      and v_order.fulfillment_status = 'unassigned'
      and not v_has_sensitive_payment
    ) then
      raise exception
        'SellerTray accepted order items are financially locked after payment claim, payment confirmation, or fulfilment start'
        using errcode='23514';
    end if;

    if tg_op in ('INSERT','UPDATE') then
      if new.unit_price is null then
        raise exception 'Accepted SellerTray order amendments require a selling price'
          using errcode='23514';
      end if;

      if new.match_source = 'unmatched' then
        raise exception 'Resolve the amended item before saving it to an accepted order'
          using errcode='23514';
      end if;
    end if;

    if tg_op = 'DELETE' then
      select count(*)
      into v_other_item_count
      from public.order_items oi
      where oi.order_id = v_order_id
        and oi.id <> old.id;

      if v_other_item_count = 0 then
        raise exception 'Accepted SellerTray orders must keep at least one item'
          using errcode='23514';
      end if;
    end if;

    return case when tg_op='DELETE' then old else new end;
  end if;

  -- Rejected/processing/ready/completed/cancelled orders are immutable at the
  -- line-item layer. Operational state changes must use their governed workflows.
  raise exception
    'SellerTray order items cannot be changed after processing, completion, cancellation, or rejection'
    using errcode='23514';
end;
$function$;
