begin;

create or replace function public.guard_invoiced_order_items()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_has_invoice boolean := false;
  v_has_sensitive_payment boolean := false;
  v_other_item_count integer := 0;
begin
  v_order_id := case when tg_op='DELETE' then old.order_id else new.order_id end;

  select *
  into v_order
  from public.orders o
  where o.id=v_order_id;

  if not found then
    -- Governed business deletion removes the Tenant and then cascades through
    -- Orders -> Order Items. Permit only that parent-Tenant deletion path;
    -- a direct service-side Order deletion while the Tenant still exists must
    -- not bypass the financial lock.
    if tg_op='DELETE'
       and not exists (
         select 1 from public.tenants t where t.id=old.tenant_id
       ) then
      return old;
    end if;

    raise exception 'SellerTray order not found' using errcode='22023';
  end if;

  select exists (
    select 1
    from public.order_financial_documents d
    where d.order_id=v_order_id
      and d.document_type='invoice'
  )
  into v_has_invoice;

  if not v_has_invoice then
    return case when tg_op='DELETE' then old else new end;
  end if;

  select exists (
    select 1
    from public.order_payments p
    where p.order_id=v_order_id
      and p.status in ('pending_verification','confirmed')
  )
  into v_has_sensitive_payment;

  if not (
    v_order.status='accepted'
    and v_order.payment_status in ('unpaid','pending')
    and coalesce(v_order.amount_paid,0)=0
    and v_order.fulfillment_status='unassigned'
    and not v_has_sensitive_payment
  ) then
    raise exception
      'SellerTray invoiced order items are financially locked after payment claim, payment confirmation, or fulfillment start'
      using errcode='23514';
  end if;

  if tg_op in ('INSERT','UPDATE') then
    if new.unit_price is null then
      raise exception 'Accepted SellerTray order amendments require a selling price'
        using errcode='23514';
    end if;

    if new.match_source='unmatched' then
      raise exception 'Resolve the amended item before saving it to an accepted order'
        using errcode='23514';
    end if;
  end if;

  if tg_op='DELETE' then
    select count(*)
    into v_other_item_count
    from public.order_items oi
    where oi.order_id=v_order_id
      and oi.id<>old.id;

    if v_other_item_count=0 then
      raise exception 'Accepted SellerTray orders must keep at least one item'
        using errcode='23514';
    end if;
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$function$;

revoke all on function public.guard_invoiced_order_items()
from public,anon,authenticated;

commit;