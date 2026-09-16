create or replace function public.sync_sellertray_unpaid_invoice_after_item_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_amount numeric(14,2);
begin
  v_order_id := case when tg_op='DELETE' then old.order_id else new.order_id end;

  select *
  into v_order
  from public.orders o
  where o.id=v_order_id;

  if not found
     or v_order.status<>'accepted'
     or v_order.fulfillment_status<>'unassigned'
     or coalesce(v_order.amount_paid,0)<>0
     or v_order.payment_status not in ('unpaid','pending') then
    return coalesce(new,old);
  end if;

  if exists (
    select 1
    from public.order_payments p
    where p.order_id=v_order_id
      and p.status in ('pending_verification','confirmed')
  ) then
    return coalesce(new,old);
  end if;

  select coalesce(sum(oi.quantity*oi.unit_price),0)::numeric(14,2)
  into v_amount
  from public.order_items oi
  where oi.order_id=v_order_id;

  update public.order_payments p
  set status='cancelled',
      failure_reason='Order amended before payment',
      updated_at=now()
  where p.order_id=v_order_id
    and p.status='initiated';

  update public.order_financial_documents d
  set amount=v_amount,
      pdf_storage_path=null,
      pdf_generated_at=null,
      pdf_version=d.pdf_version+1,
      updated_at=now()
  where d.order_id=v_order_id
    and d.document_type='invoice'
    and d.status='issued'
    and d.amount is distinct from v_amount;

  return coalesce(new,old);
end;
$function$;
