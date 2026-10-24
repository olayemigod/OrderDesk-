begin;

-- Reconcile line-level rounding to the authoritative order tax in both
-- directions. Negative residuals are removed one cent at a time from eligible
-- lines so no immutable line tax snapshot can become negative.
create or replace function public.ensure_sellertray_invoice_for_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_existing_id uuid;
  v_config public.sellertray_tax_configurations%rowtype;
  v_latest public.sellertray_tax_configurations%rowtype;
  v_has_config boolean:=false;
  v_subtotal numeric(18,2);
  v_rate numeric(9,6):=0;
  v_tax numeric(18,2):=0;
  v_gross numeric(18,2);
  v_applied boolean:=false;
  v_display boolean:=false;
  v_document_id uuid;
  v_line_tax_total numeric(18,2):=0;
  v_delta numeric(18,2):=0;
  v_adjust_item_id uuid;
begin
  select * into v_order
  from public.orders o
  where o.id=p_order_id
  for update;
  if not found then
    raise exception 'SellerTray order not found' using errcode='22023';
  end if;

  select d.id into v_existing_id
  from public.order_financial_documents d
  where d.tenant_id=v_order.tenant_id
    and d.order_id=v_order.id
    and d.document_type='invoice';
  if found then return v_existing_id; end if;

  if v_order.status not in ('accepted','processing','ready','completed') then return null; end if;

  select coalesce(sum(round((oi.quantity*oi.unit_price)::numeric,2)),0)::numeric(18,2)
  into v_subtotal
  from public.order_items oi
  where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id;
  if not exists(
    select 1 from public.order_items oi
    where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id
  ) then
    raise exception 'SellerTray order has no invoiceable items' using errcode='23514';
  end if;
  if exists(
    select 1 from public.order_items oi
    where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id and oi.unit_price is null
  ) then
    raise exception 'SellerTray order has unpriced invoice items' using errcode='23514';
  end if;

  select * into v_latest
  from public.sellertray_tax_configurations c
  where c.tenant_id=v_order.tenant_id
  order by c.revision desc
  limit 1;

  if v_order.offline_tax_context_locked then
    if v_order.offline_tax_configuration_revision=0 then
      if found then
        raise exception 'Queued sale needs review because Business tax settings changed' using errcode='23514';
      end if;
      v_has_config:=false;
    else
      if not found
         or v_latest.id is distinct from v_order.offline_tax_configuration_id
         or v_latest.revision<>v_order.offline_tax_configuration_revision then
        raise exception 'Queued sale needs review because Business tax settings changed' using errcode='23514';
      end if;
      v_config:=v_latest;
      v_has_config:=true;
    end if;
  else
    if found then
      v_config:=v_latest;
      v_has_config:=true;
    end if;
  end if;

  if v_has_config and v_config.is_active then
    v_applied:=true;
    v_rate:=v_config.rate_percent;
    v_display:=v_config.display_tax_breakdown;
    v_tax:=round((v_subtotal*v_rate/100)::numeric,2);
  end if;
  v_gross:=(v_subtotal+v_tax)::numeric(18,2);

  update public.order_items oi
  set tax_basis_amount=round((oi.quantity*oi.unit_price)::numeric,2),
      tax_rate_percent=v_rate,
      tax_amount=case when v_applied
        then round((round((oi.quantity*oi.unit_price)::numeric,2)*v_rate/100)::numeric,2)
        else 0 end,
      gross_line_total=round((oi.quantity*oi.unit_price)::numeric,2)+case when v_applied
        then round((round((oi.quantity*oi.unit_price)::numeric,2)*v_rate/100)::numeric,2)
        else 0 end
  where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id;

  select coalesce(sum(oi.tax_amount),0)::numeric(18,2)
  into v_line_tax_total
  from public.order_items oi
  where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id;

  v_delta:=round((v_tax-v_line_tax_total)::numeric,2);

  if v_delta>=0.005 then
    select oi.id into v_adjust_item_id
    from public.order_items oi
    where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id
    order by oi.id desc
    limit 1;
    if v_adjust_item_id is null then
      raise exception 'SellerTray tax rounding could not select an invoice line' using errcode='23514';
    end if;
    update public.order_items oi
    set tax_amount=(oi.tax_amount+v_delta)::numeric(18,2),
        gross_line_total=(oi.gross_line_total+v_delta)::numeric(18,2)
    where oi.tenant_id=v_order.tenant_id and oi.id=v_adjust_item_id;
  elsif v_delta<=-0.005 then
    while v_delta<=-0.005 loop
      select oi.id into v_adjust_item_id
      from public.order_items oi
      where oi.tenant_id=v_order.tenant_id
        and oi.order_id=v_order.id
        and oi.tax_amount>=0.01
      order by oi.tax_amount desc,oi.id desc
      limit 1;
      if v_adjust_item_id is null then
        raise exception 'SellerTray tax rounding cannot reconcile without negative line tax' using errcode='23514';
      end if;
      update public.order_items oi
      set tax_amount=(oi.tax_amount-0.01)::numeric(18,2),
          gross_line_total=(oi.gross_line_total-0.01)::numeric(18,2)
      where oi.tenant_id=v_order.tenant_id and oi.id=v_adjust_item_id;
      v_delta:=round((v_delta+0.01)::numeric,2);
    end loop;
  end if;

  select coalesce(sum(oi.tax_amount),0)::numeric(18,2)
  into v_line_tax_total
  from public.order_items oi
  where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id;
  if abs(v_line_tax_total-v_tax)>=0.005 then
    raise exception 'SellerTray line tax does not reconcile to order tax' using errcode='23514';
  end if;

  update public.orders o
  set subtotal_amount=v_subtotal,
      tax_applied=v_applied,
      tax_configuration_id=case when v_has_config then v_config.id else null end,
      tax_configuration_revision=case when v_has_config then v_config.revision else null end,
      tax_rate_percent=v_rate,
      tax_amount=v_tax,
      tax_display_breakdown=v_display,
      gross_amount=v_gross,
      total_amount=v_gross,
      tax_posted_at=now(),
      updated_at=now()
  where o.tenant_id=v_order.tenant_id and o.id=v_order.id;

  insert into public.order_financial_documents(
    tenant_id,order_id,document_type,document_reference,currency,amount,status
  ) values(
    v_order.tenant_id,v_order.id,'invoice','',coalesce(v_order.currency,'NGN'),v_gross,'issued'
  ) returning id into v_document_id;

  return v_document_id;
end;
$$;

revoke all on function public.ensure_sellertray_invoice_for_order(uuid) from public,anon,authenticated;
grant execute on function public.ensure_sellertray_invoice_for_order(uuid) to service_role;

commit;
