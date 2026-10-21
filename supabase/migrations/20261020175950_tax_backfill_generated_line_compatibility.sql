begin;

-- PostgreSQL presents stored generated columns as NULL in NEW during BEFORE
-- UPDATE triggers. order_items.line_total is generated from quantity * unit_price,
-- so the temporary tax-backfill guard from 20261020175900 would otherwise treat
-- a tax-only historical snapshot update as a commercial-line mutation.
--
-- This migration is intentionally between the temporary guard and the Tax
-- Authority foundation. On databases where Tax Authority is already installed,
-- it is a no-op so a late migration-history repair cannot loosen the restored
-- runtime guard. 20261020180050 restores the normal invoiced-item guard after
-- the historical backfill completes.
do $migration$
begin
  if to_regclass('public.sellertray_tax_configurations') is null then
    execute $sql$
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
  v_old jsonb;
  v_new jsonb;
begin
  v_order_id := case when tg_op='DELETE' then old.order_id else new.order_id end;

  select *
  into v_order
  from public.orders o
  where o.id=v_order_id;

  if not found then
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

  if tg_op='UPDATE' then
    v_old:=to_jsonb(old);
    v_new:=to_jsonb(new);
    if v_old->>'tax_basis_amount' is null
       and v_old->>'tax_rate_percent' is null
       and v_old->>'tax_amount' is null
       and v_old->>'gross_line_total' is null
       and v_new->>'tax_basis_amount' is not null
       and v_new->>'tax_rate_percent' is not null
       and v_new->>'tax_amount' is not null
       and v_new->>'gross_line_total' is not null
       and (
         v_new - array[
           'tax_basis_amount','tax_rate_percent','tax_amount','gross_line_total','line_total'
         ]::text[]
       ) = (
         v_old - array[
           'tax_basis_amount','tax_rate_percent','tax_amount','gross_line_total','line_total'
         ]::text[]
       ) then
      return new;
    end if;
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
$sql$;
  end if;
end
$migration$;

revoke all on function public.guard_invoiced_order_items()
from public,anon,authenticated;

commit;
