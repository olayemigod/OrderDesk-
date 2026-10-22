begin;

-- A sale return reverses merchandise value first. Monetary refund is only the
-- portion of the returned value that exceeds the receivable still outstanding.
-- Cash and Bank are payout sources; only Manager/Owner may complete a monetary refund.

alter table public.sale_returns
  alter column original_payment_id drop not null,
  add column refund_amount numeric(18,2) not null default 0,
  add column receivable_reduction_amount numeric(18,2) not null default 0,
  add column outstanding_before numeric(18,2) not null default 0,
  add column outstanding_after numeric(18,2) not null default 0,
  add column refund_source text,
  add column refund_payment_method_id uuid;

update public.sale_returns sr
set refund_amount=sr.amount,
    receivable_reduction_amount=0,
    refund_source='cash'
where exists (
  select 1 from public.payment_refunds pr
  where pr.tenant_id=sr.tenant_id and pr.sale_return_id=sr.id
);

alter table public.sale_returns
  add constraint sale_returns_refund_amount_check
    check (refund_amount>=0 and refund_amount<=amount),
  add constraint sale_returns_receivable_reduction_check
    check (receivable_reduction_amount>=0 and receivable_reduction_amount<=amount
      and abs((refund_amount+receivable_reduction_amount)-amount)<0.005),
  add constraint sale_returns_outstanding_check
    check (outstanding_before>=0 and outstanding_after>=0
      and outstanding_after<=outstanding_before+0.005),
  add constraint sale_returns_refund_source_check
    check ((refund_amount=0 and refund_source is null and refund_payment_method_id is null)
      or (refund_amount>0 and refund_source in ('cash','bank'))),
  add constraint sale_returns_refund_bank_same_tenant
    foreign key (tenant_id,refund_payment_method_id)
    references public.merchant_payment_methods(tenant_id,id) on delete restrict;

alter table public.payment_refunds
  add column refund_payment_method_id uuid;

alter table public.payment_refunds
  drop constraint payment_refunds_method_type_check,
  drop constraint payment_refunds_provider_check;

alter table public.payment_refunds
  add constraint payment_refunds_method_type_check
    check (method_type in ('cash','bank_transfer')),
  add constraint payment_refunds_provider_check
    check (provider in ('pos_cash','manual_bank')),
  add constraint payment_refunds_source_shape_check
    check (
      (method_type='cash' and provider='pos_cash' and refund_payment_method_id is null)
      or
      (method_type='bank_transfer' and provider='manual_bank' and refund_payment_method_id is not null)
    ),
  add constraint payment_refunds_bank_same_tenant
    foreign key (tenant_id,refund_payment_method_id)
    references public.merchant_payment_methods(tenant_id,id) on delete restrict;

create or replace function public.get_sellertray_pos_returnable_items(
  p_tenant_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_order public.orders%rowtype;
  v_role text;
  v_items jsonb;
  v_confirmed numeric(18,2):=0;
  v_prior_refunds numeric(18,2):=0;
  v_net_retained numeric(18,2):=0;
  v_adjusted_total numeric(18,2):=0;
  v_outstanding numeric(18,2):=0;
  v_cash_available numeric(18,2):=0;
  v_bank_accounts jsonb:='[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if not found or v_order.source<>'pos' then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if v_order.branch_id is null
     or not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,v_user_id) then
    raise exception 'You do not have access to return sales from this Branch' using errcode='42501';
  end if;
  if v_order.status<>'completed'
     or v_order.fulfillment_status<>'collected'
     or v_order.return_status not in ('none','partial')
     or coalesce(v_order.returned_amount,0)>=coalesce(v_order.total_amount,0) then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  select coalesce(sum(p.amount),0)::numeric(18,2)
  into v_confirmed
  from public.order_payments p
  where p.tenant_id=p_tenant_id and p.order_id=p_order_id
    and p.status='confirmed' and p.exception_state='none';

  select coalesce(sum(pr.amount),0)::numeric(18,2)
  into v_prior_refunds
  from public.payment_refunds pr
  where pr.tenant_id=p_tenant_id and pr.order_id=p_order_id
    and pr.status='confirmed';

  v_net_retained:=greatest(v_confirmed-v_prior_refunds,0)::numeric(18,2);
  v_adjusted_total:=greatest(coalesce(v_order.total_amount,0)-coalesce(v_order.returned_amount,0),0)::numeric(18,2);
  v_outstanding:=greatest(v_adjusted_total-v_net_retained,0)::numeric(18,2);

  select coalesce(jsonb_agg(jsonb_build_object(
    'orderItemId',x.order_item_id,
    'catalogItemId',x.catalog_item_id,
    'name',x.item_name,
    'selectedUom',x.selected_uom,
    'soldQuantity',x.sold_quantity,
    'returnedQuantity',x.returned_quantity,
    'remainingQuantity',x.remaining_quantity,
    'unitPrice',x.unit_price,
    'remainingValue',x.remaining_value
  ) order by x.item_name,x.order_item_id),'[]'::jsonb)
  into v_items
  from (
    select
      oi.id order_item_id,
      oi.catalog_item_id,
      oi.item_name,
      oi.selected_uom,
      oi.quantity sold_quantity,
      coalesce(sum(sri.quantity),0)::numeric(18,6) returned_quantity,
      (oi.quantity-coalesce(sum(sri.quantity),0))::numeric(18,6) remaining_quantity,
      oi.unit_price,
      greatest(coalesce(oi.gross_line_total,oi.line_total)-coalesce(sum(sri.line_total),0),0)::numeric(18,2) remaining_value
    from public.order_items oi
    left join public.sale_return_items sri
      on sri.tenant_id=oi.tenant_id and sri.order_item_id=oi.id
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
    group by oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,oi.unit_price,oi.line_total,oi.gross_line_total
    having oi.quantity-coalesce(sum(sri.quantity),0)>0
  ) x;

  select coalesce(max(t.expected_cash),0)::numeric(18,2)
  into v_cash_available
  from public.sellertray_cash_shifts s
  cross join lateral public.sellertray_cash_shift_totals(s.tenant_id,s.id) t
  where s.tenant_id=p_tenant_id
    and s.branch_id=v_order.branch_id
    and s.opened_by_user_id=v_user_id
    and s.status='open';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'displayName',m.display_name,'bankName',m.bank_name,
    'accountName',m.bank_account_name,'accountNumber',m.bank_account_number
  ) order by m.sort_order,m.display_name,m.id),'[]'::jsonb)
  into v_bank_accounts
  from public.merchant_payment_methods m
  where m.tenant_id=p_tenant_id and m.method_type='bank_transfer' and m.is_enabled=true;

  return jsonb_build_object(
    'orderId',v_order.id,
    'publicOrderId',v_order.public_order_id,
    'currency',v_order.currency,
    'returnStatus',v_order.return_status,
    'returnedAmount',v_order.returned_amount,
    'remainingAmount',v_adjusted_total,
    'confirmedPaymentAmount',v_confirmed,
    'priorRefundAmount',v_prior_refunds,
    'netMoneyRetained',v_net_retained,
    'outstandingAmount',v_outstanding,
    'canCompleteMonetaryRefund',v_role in ('owner','manager'),
    'cashRefundAvailableAmount',v_cash_available,
    'bankAccounts',v_bank_accounts,
    'items',v_items
  );
end;
$$;

revoke all on function public.get_sellertray_pos_returnable_items(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_pos_returnable_items(uuid,uuid)
  to authenticated,service_role;

create or replace function public.return_sellertray_pos_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_items jsonb,
  p_command_id text,
  p_refund_source text default null,
  p_refund_payment_method_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_command_id text:=nullif(btrim(coalesce(p_command_id,'')),'');
  v_source text:=nullif(lower(btrim(coalesce(p_refund_source,''))),'');
  v_role text;
  v_command_hash text;
  v_fingerprint text;
  v_normalized_items jsonb;
  v_existing public.sale_returns%rowtype;
  v_existing_refund_id uuid;
  v_return_id uuid;
  v_refund_id uuid;
  v_original_payment_id uuid;
  v_stock_location_id uuid;
  v_item_count integer;
  v_existing_movement_count integer;
  v_request_count integer;
  v_distinct_count integer;
  v_entry jsonb;
  v_requested_qty numeric(18,6);
  v_line record;
  v_prior_qty numeric(18,6);
  v_prior_subtotal numeric(18,2);
  v_prior_tax numeric(18,2);
  v_remaining_qty numeric(18,6);
  v_line_subtotal numeric(18,2);
  v_line_tax numeric(18,2);
  v_line_value numeric(18,2);
  v_return_subtotal numeric(18,2):=0;
  v_return_tax numeric(18,2):=0;
  v_return_value numeric(18,2):=0;
  v_confirmed_paid numeric(18,2):=0;
  v_prior_refunds numeric(18,2):=0;
  v_net_retained_before numeric(18,2):=0;
  v_adjusted_total_before numeric(18,2):=0;
  v_outstanding_before numeric(18,2):=0;
  v_receivable_reduction numeric(18,2):=0;
  v_refund_due numeric(18,2):=0;
  v_adjusted_total_after numeric(18,2):=0;
  v_net_retained_after numeric(18,2):=0;
  v_outstanding_after numeric(18,2):=0;
  v_new_returned numeric(18,2);
  v_has_remaining boolean;
  v_return_status text;
  v_payment_status text;
  v_bank public.merchant_payment_methods%rowtype;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null
     or v_reason is null or v_command_id is null then
    raise exception 'Business, sale, operator, return reason and retry identity are required' using errcode='22023';
  end if;
  if char_length(v_reason)>500 then
    raise exception 'Return reason is too long' using errcode='22023';
  end if;
  if char_length(v_command_id)<8 or char_length(v_command_id)>160
     or v_command_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$' then
    raise exception 'Return retry identity is invalid' using errcode='22023';
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception 'Choose at least one return item' using errcode='22023';
  end if;
  if v_source is not null and v_source not in ('cash','bank') then
    raise exception 'Choose Cash or Bank as the refund source' using errcode='22023';
  end if;

  select jsonb_agg(e.value order by e.value->>'orderItemId')
  into v_normalized_items
  from jsonb_array_elements(p_items) e(value);

  select count(*)::integer,count(distinct value->>'orderItemId')::integer
  into v_request_count,v_distinct_count
  from jsonb_array_elements(v_normalized_items);
  if v_request_count<>v_distinct_count
     or exists(
       select 1 from jsonb_array_elements(v_normalized_items) e(value)
       where nullif(btrim(coalesce(value->>'orderItemId','')),'') is null
          or nullif(btrim(coalesce(value->>'quantity','')),'') is null
     ) then
    raise exception 'Return items must contain unique sale lines and quantities' using errcode='22023';
  end if;

  v_command_hash:=pg_catalog.md5(p_tenant_id::text||'|'||p_order_id::text||'|'||v_command_id);
  v_fingerprint:=pg_catalog.md5(v_reason||'|'||v_normalized_items::text||'|'||coalesce(v_source,'')||'|'||coalesce(p_refund_payment_method_id::text,''));

  select * into v_existing
  from public.sale_returns sr
  where sr.tenant_id=p_tenant_id and sr.command_id_hash=v_command_hash
  limit 1;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.command_fingerprint is distinct from v_fingerprint then
      raise exception 'Return retry identity is already used for different facts' using errcode='23505';
    end if;
    select pr.id into v_existing_refund_id
    from public.payment_refunds pr
    where pr.tenant_id=p_tenant_id and pr.sale_return_id=v_existing.id;
    return jsonb_build_object(
      'orderId',p_order_id,'returnId',v_existing.id,'refundId',v_existing_refund_id,
      'returnStatus',(select o.return_status from public.orders o where o.tenant_id=p_tenant_id and o.id=p_order_id),
      'returnSubtotal',coalesce(v_existing.subtotal_amount,v_existing.amount),
      'returnTax',coalesce(v_existing.tax_amount,0),'returnedValue',v_existing.amount,
      'receivableReductionAmount',v_existing.receivable_reduction_amount,
      'refundedAmount',v_existing.refund_amount,
      'outstandingBefore',v_existing.outstanding_before,'outstandingAfter',v_existing.outstanding_after,
      'refundSource',v_existing.refund_source,'refundPaymentMethodId',v_existing.refund_payment_method_id,
      'currency',v_existing.currency,'idempotentReplay',true
    );
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;
  if not found or v_order.source<>'pos' then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if v_order.branch_id is null
     or not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to return sales from this Branch' using errcode='42501';
  end if;
  if v_order.status<>'completed'
     or v_order.fulfillment_status<>'collected'
     or v_order.return_status not in ('none','partial')
     or coalesce(v_order.returned_amount,0)>=coalesce(v_order.total_amount,0) then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;
  if v_order.tax_posted_at is null then
    raise exception 'POS sale is missing its historical tax snapshot' using errcode='23514';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role is null then
    raise exception 'SellerTray Business membership required' using errcode='42501';
  end if;

  select coalesce(sum(p.amount),0)::numeric(18,2)
  into v_confirmed_paid
  from public.order_payments p
  where p.tenant_id=p_tenant_id and p.order_id=p_order_id
    and p.status='confirmed' and p.exception_state='none';

  select coalesce(sum(pr.amount),0)::numeric(18,2)
  into v_prior_refunds
  from public.payment_refunds pr
  where pr.tenant_id=p_tenant_id and pr.order_id=p_order_id
    and pr.status='confirmed';

  v_net_retained_before:=greatest(v_confirmed_paid-v_prior_refunds,0)::numeric(18,2);
  v_adjusted_total_before:=greatest(coalesce(v_order.total_amount,0)-coalesce(v_order.returned_amount,0),0)::numeric(18,2);
  v_outstanding_before:=greatest(v_adjusted_total_before-v_net_retained_before,0)::numeric(18,2);

  select sl.id into v_stock_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id and sl.branch_id=v_order.branch_id
    and sl.is_default=true and sl.is_active=true
  order by sl.created_at,sl.id
  limit 1;
  if v_stock_location_id is null then
    raise exception 'POS branch has no active default stock location' using errcode='23514';
  end if;

  select count(*)::integer into v_item_count
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;
  select count(*)::integer into v_existing_movement_count
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id and im.reference_type='order'
    and im.reference_id=p_order_id::text and im.movement_type='sale';
  if v_item_count<1 or v_existing_movement_count<>v_item_count then
    raise exception 'POS sale stock history is incomplete and cannot be returned automatically' using errcode='23514';
  end if;

  for v_entry in select value from jsonb_array_elements(v_normalized_items)
  loop
    begin
      v_requested_qty:=(v_entry->>'quantity')::numeric(18,6);
    exception when others then
      raise exception 'Return quantity is invalid' using errcode='22023';
    end;
    if v_requested_qty<=0 then
      raise exception 'Return quantity must be greater than zero' using errcode='22023';
    end if;

    select oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,
           oi.conversion_factor,oi.stock_quantity,oi.unit_price,oi.line_total,
           oi.tax_basis_amount,oi.tax_amount as original_tax,oi.gross_line_total
    into v_line
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
      and oi.id=(v_entry->>'orderItemId')::uuid;
    if not found then
      raise exception 'Return item does not belong to this sale' using errcode='22023';
    end if;
    if v_line.catalog_item_id is null or v_line.selected_uom is null
       or v_line.quantity is null or v_line.quantity<=0
       or v_line.conversion_factor is null or v_line.conversion_factor<=0
       or v_line.stock_quantity is null or v_line.stock_quantity<=0
       or v_line.tax_basis_amount is null or v_line.original_tax is null
       or v_line.gross_line_total is null then
      raise exception 'POS sale line has incomplete return snapshot' using errcode='23514';
    end if;

    select coalesce(sum(sri.quantity),0)::numeric(18,6),
           coalesce(sum(coalesce(sri.subtotal_amount,sri.line_total)),0)::numeric(18,2),
           coalesce(sum(coalesce(sri.tax_amount,0)),0)::numeric(18,2)
    into v_prior_qty,v_prior_subtotal,v_prior_tax
    from public.sale_return_items sri
    where sri.tenant_id=p_tenant_id and sri.order_item_id=v_line.id;

    v_remaining_qty:=v_line.quantity-v_prior_qty;
    if v_remaining_qty<=0 or v_requested_qty>v_remaining_qty then
      raise exception 'Return quantity exceeds the quantity still available for this item' using errcode='23514';
    end if;

    if v_requested_qty=v_remaining_qty then
      v_line_subtotal:=greatest(v_line.tax_basis_amount-v_prior_subtotal,0)::numeric(18,2);
      v_line_tax:=greatest(v_line.original_tax-v_prior_tax,0)::numeric(18,2);
    else
      v_line_subtotal:=round((v_line.tax_basis_amount*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
      v_line_tax:=round((v_line.original_tax*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
    end if;
    v_line_value:=(v_line_subtotal+v_line_tax)::numeric(18,2);
    v_return_subtotal:=v_return_subtotal+v_line_subtotal;
    v_return_tax:=v_return_tax+v_line_tax;
    v_return_value:=v_return_value+v_line_value;
  end loop;

  if v_return_value<=0
     or coalesce(v_order.returned_amount,0)+v_return_value>coalesce(v_order.total_amount,0)+0.005 then
    raise exception 'Return value exceeds the remaining returnable sale amount' using errcode='23514';
  end if;

  v_receivable_reduction:=least(v_return_value,v_outstanding_before)::numeric(18,2);
  v_refund_due:=greatest(v_return_value-v_receivable_reduction,0)::numeric(18,2);
  v_adjusted_total_after:=greatest(v_adjusted_total_before-v_return_value,0)::numeric(18,2);
  v_net_retained_after:=greatest(v_net_retained_before-v_refund_due,0)::numeric(18,2);
  v_outstanding_after:=greatest(v_adjusted_total_after-v_net_retained_after,0)::numeric(18,2);

  if v_refund_due>0 then
    if v_role not in ('owner','manager') then
      raise exception 'Only the Business Owner or Manager can complete a monetary refund' using errcode='42501';
    end if;
    if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_refund_sale') then
      raise exception 'You do not have permission to refund completed sales' using errcode='42501';
    end if;
    if v_source is null then
      raise exception 'Choose Cash or Bank as the refund source' using errcode='22023';
    end if;
    if v_source='bank' then
      if p_refund_payment_method_id is null then
        raise exception 'Choose a Business bank account for this refund' using errcode='22023';
      end if;
      select * into v_bank
      from public.merchant_payment_methods m
      where m.tenant_id=p_tenant_id and m.id=p_refund_payment_method_id;
      if not found then
        raise exception 'Selected refund bank account does not belong to this Business' using errcode='42501';
      end if;
      if v_bank.method_type<>'bank_transfer' or not v_bank.is_enabled then
        raise exception 'Choose an enabled Business bank account for this refund' using errcode='23514';
      end if;
    elsif p_refund_payment_method_id is not null then
      raise exception 'Cash refund does not use a Business bank account' using errcode='22023';
    end if;

    select p.id into v_original_payment_id
    from public.order_payments p
    where p.tenant_id=p_tenant_id and p.order_id=p_order_id
      and p.status='confirmed' and p.exception_state='none'
    order by p.confirmed_at,p.created_at,p.id
    limit 1;
    if v_original_payment_id is null then
      raise exception 'Monetary refund has no confirmed payment history' using errcode='23514';
    end if;
  else
    v_source:=null;
    p_refund_payment_method_id:=null;
  end if;

  insert into public.sale_returns(
    tenant_id,branch_id,order_id,original_payment_id,return_type,status,
    amount,currency,reason,actor_user_id,command_id_hash,command_fingerprint,
    subtotal_amount,tax_amount,tax_configuration_id,tax_configuration_revision,tax_rate_percent,
    refund_amount,receivable_reduction_amount,outstanding_before,outstanding_after,
    refund_source,refund_payment_method_id
  ) values(
    p_tenant_id,v_order.branch_id,p_order_id,v_original_payment_id,'partial','completed',
    v_return_value,v_order.currency,left(v_reason,500),p_actor_user_id,v_command_hash,v_fingerprint,
    v_return_subtotal,v_return_tax,v_order.tax_configuration_id,v_order.tax_configuration_revision,v_order.tax_rate_percent,
    v_refund_due,v_receivable_reduction,v_outstanding_before,v_outstanding_after,
    v_source,p_refund_payment_method_id
  ) returning id into v_return_id;

  for v_entry in select value from jsonb_array_elements(v_normalized_items)
  loop
    v_requested_qty:=(v_entry->>'quantity')::numeric(18,6);
    select oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,
           oi.conversion_factor,oi.stock_quantity,oi.unit_price,oi.line_total,
           oi.tax_basis_amount,oi.tax_amount as original_tax,oi.gross_line_total
    into v_line
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
      and oi.id=(v_entry->>'orderItemId')::uuid;

    select coalesce(sum(sri.quantity),0)::numeric(18,6),
           coalesce(sum(coalesce(sri.subtotal_amount,sri.line_total)),0)::numeric(18,2),
           coalesce(sum(coalesce(sri.tax_amount,0)),0)::numeric(18,2)
    into v_prior_qty,v_prior_subtotal,v_prior_tax
    from public.sale_return_items sri
    where sri.tenant_id=p_tenant_id and sri.order_item_id=v_line.id;
    v_remaining_qty:=v_line.quantity-v_prior_qty;
    if v_requested_qty=v_remaining_qty then
      v_line_subtotal:=greatest(v_line.tax_basis_amount-v_prior_subtotal,0)::numeric(18,2);
      v_line_tax:=greatest(v_line.original_tax-v_prior_tax,0)::numeric(18,2);
    else
      v_line_subtotal:=round((v_line.tax_basis_amount*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
      v_line_tax:=round((v_line.original_tax*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
    end if;
    v_line_value:=(v_line_subtotal+v_line_tax)::numeric(18,2);

    insert into public.sale_return_items(
      tenant_id,sale_return_id,order_item_id,catalog_item_id,product_name,
      selected_uom,quantity,conversion_factor,stock_quantity,unit_price,line_total,
      subtotal_amount,tax_amount
    ) values(
      p_tenant_id,v_return_id,v_line.id,v_line.catalog_item_id,v_line.item_name,
      v_line.selected_uom,v_requested_qty,v_line.conversion_factor,
      (v_requested_qty*v_line.conversion_factor)::numeric(18,6),
      v_line.unit_price,v_line_value,v_line_subtotal,v_line_tax
    );

    perform public.record_sellertray_inventory_movement(
      p_tenant_id,v_order.branch_id,v_stock_location_id,v_line.catalog_item_id,
      'sale_return',(v_requested_qty*v_line.conversion_factor)::numeric(18,6),
      v_line.selected_uom,v_requested_qty,v_line.conversion_factor,
      'sale_return',v_return_id::text,
      'pos-return:'||v_return_id::text||':'||v_line.id::text,
      now(),p_actor_user_id,left(v_reason,500),
      jsonb_build_object(
        'return_id',v_return_id,'order_id',p_order_id,'public_order_id',v_order.public_order_id,
        'order_item_id',v_line.id,'original_payment_id',v_original_payment_id,'partial_return',true,
        'returned_subtotal',v_line_subtotal,'returned_tax',v_line_tax,'returned_gross',v_line_value,
        'receivable_reduction',v_receivable_reduction,'refund_due',v_refund_due
      ),null
    );
  end loop;

  if v_refund_due>0 then
    insert into public.payment_refunds(
      tenant_id,order_id,original_payment_id,sale_return_id,method_type,provider,status,
      amount,currency,reason,actor_user_id,idempotency_key,refund_payment_method_id
    ) values(
      p_tenant_id,p_order_id,v_original_payment_id,v_return_id,
      case when v_source='cash' then 'cash' else 'bank_transfer' end,
      case when v_source='cash' then 'pos_cash' else 'manual_bank' end,
      'confirmed',v_refund_due,v_order.currency,left(v_reason,500),p_actor_user_id,
      'pos-return:'||p_order_id::text||':'||v_command_hash,
      case when v_source='bank' then p_refund_payment_method_id else null end
    ) returning id into v_refund_id;
  end if;

  select exists(
    select 1
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
      and oi.quantity > coalesce((
        select sum(sri.quantity)
        from public.sale_return_items sri
        where sri.tenant_id=oi.tenant_id and sri.order_item_id=oi.id
      ),0)
  ) into v_has_remaining;

  v_new_returned:=(coalesce(v_order.returned_amount,0)+v_return_value)::numeric(18,2);
  if v_has_remaining then
    v_return_status:='partial';
  else
    v_return_status:='returned';
    v_new_returned:=coalesce(v_order.total_amount,0);
  end if;

  v_payment_status:=case
    when v_outstanding_after<=0.005 then 'paid'
    when v_net_retained_after>0 then 'pending'
    else 'unpaid'
  end;

  update public.orders
  set return_status=v_return_status,
      returned_amount=v_new_returned,
      returned_at=now(),
      amount_paid=v_net_retained_after,
      payment_status=v_payment_status,
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,action_type,risk_class,
    requested_by,actor_user_id,policy_result,action_status,financial_impact,currency,
    before_state,after_state,metadata,applied_at
  ) values(
    p_tenant_id,'pos-return:'||p_order_id::text||':'||v_command_hash,
    'merchant_app',v_order.customer_id,p_order_id,'sale_returned','high',
    public.sellertray_commercial_actor_kind(p_tenant_id,p_actor_user_id),p_actor_user_id,
    'allowed','applied',-v_return_value,v_order.currency,
    jsonb_build_object(
      'return_status',v_order.return_status,'returned_amount',v_order.returned_amount,
      'amount_paid',v_net_retained_before,'outstanding_amount',v_outstanding_before
    ),
    jsonb_build_object(
      'return_status',v_return_status,'returned_amount',v_new_returned,
      'amount_paid',v_net_retained_after,'outstanding_amount',v_outstanding_after
    ),
    jsonb_build_object(
      'return_id',v_return_id,'refund_id',v_refund_id,'original_payment_id',v_original_payment_id,
      'reason',left(v_reason,500),'items',v_normalized_items,
      'returned_subtotal',v_return_subtotal,'returned_tax',v_return_tax,'returned_gross',v_return_value,
      'receivable_reduction',v_receivable_reduction,'refund_due',v_refund_due,
      'refund_source',v_source,'refund_payment_method_id',p_refund_payment_method_id
    ),now()
  ) on conflict(tenant_id,action_key) do nothing;

  return jsonb_build_object(
    'orderId',p_order_id,'returnId',v_return_id,'refundId',v_refund_id,
    'returnStatus',v_return_status,'returnSubtotal',v_return_subtotal,
    'returnTax',v_return_tax,'returnedValue',v_return_value,
    'receivableReductionAmount',v_receivable_reduction,'refundedAmount',v_refund_due,
    'outstandingBefore',v_outstanding_before,'outstandingAfter',v_outstanding_after,
    'returnedAmount',v_new_returned,'refundSource',v_source,
    'refundPaymentMethodId',case when v_source='bank' then p_refund_payment_method_id else null end,
    'currency',v_order.currency,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.return_sellertray_pos_sale(uuid,uuid,uuid,text,jsonb,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_sale(uuid,uuid,uuid,text,jsonb,text,text,uuid)
  to service_role;

-- Compatibility wrapper: existing six-argument callers now pass through the governed
-- authority. It defaults to Cash only when an actual refund is due and cannot bypass
-- the Manager/Owner monetary-refund gate.
create or replace function public.return_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_items jsonb,
  p_command_id text
)
returns jsonb
language sql
security definer
set search_path=''
as $$
  select public.return_sellertray_pos_sale(
    p_tenant_id,p_order_id,p_actor_user_id,p_reason,p_items,p_command_id,'cash',null
  );
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  to service_role;

-- Keep order payment state aligned with net retained money after returns. A future
-- payment confirmation must not overwrite the receivable-first return settlement.
create or replace function public.sync_sellertray_order_payment_state()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
  v_tenant_id uuid;
  v_gross_paid numeric(14,2);
  v_refunded numeric(14,2);
  v_amount_paid numeric(14,2);
  v_returned numeric(14,2);
  v_adjusted_due numeric(14,2);
  v_confirmed_at timestamptz;
  v_payment_status text;
  v_invoice public.order_financial_documents%rowtype;
  v_settlement_payment_id uuid;
  v_has_exception boolean;
  v_has_pending_verification boolean;
  v_has_initiated boolean;
begin
  if tg_op='DELETE' then
    v_order_id:=old.order_id; v_tenant_id:=old.tenant_id;
  else
    v_order_id:=new.order_id; v_tenant_id:=new.tenant_id;
  end if;

  select * into v_invoice
  from public.order_financial_documents d
  where d.tenant_id=v_tenant_id and d.order_id=v_order_id
    and d.document_type='invoice' and d.status='issued';

  select coalesce(sum(p.amount) filter(where p.status='confirmed' and p.exception_state='none'),0)::numeric(14,2),
         max(p.confirmed_at) filter(where p.status='confirmed' and p.exception_state='none'),
         coalesce(bool_or(p.exception_state<>'none'),false),
         coalesce(bool_or(p.status='pending_verification'),false),
         coalesce(bool_or(p.status='initiated'),false)
  into v_gross_paid,v_confirmed_at,v_has_exception,v_has_pending_verification,v_has_initiated
  from public.order_payments p
  where p.tenant_id=v_tenant_id and p.order_id=v_order_id;

  select coalesce(sum(pr.amount),0)::numeric(14,2)
  into v_refunded
  from public.payment_refunds pr
  where pr.tenant_id=v_tenant_id and pr.order_id=v_order_id and pr.status='confirmed';

  select coalesce(sum(sr.amount),0)::numeric(14,2)
  into v_returned
  from public.sale_returns sr
  where sr.tenant_id=v_tenant_id and sr.order_id=v_order_id and sr.status='completed';

  v_amount_paid:=greatest(v_gross_paid-v_refunded,0)::numeric(14,2);
  v_adjusted_due:=greatest(coalesce(v_invoice.amount,0)-v_returned,0)::numeric(14,2);

  v_payment_status:=case
    when v_has_exception then 'payment_issue'
    when v_invoice.id is not null and v_amount_paid>=v_adjusted_due-0.005 then 'paid'
    when v_has_pending_verification then 'verification_required'
    when v_amount_paid>0 or v_has_initiated then 'pending'
    else 'unpaid'
  end;

  update public.orders
  set payment_status=v_payment_status,
      amount_paid=v_amount_paid,
      payment_confirmed_at=v_confirmed_at,
      updated_at=now()
  where id=v_order_id and tenant_id=v_tenant_id;

  if v_payment_status='paid' then
    if v_invoice.id is null then
      raise exception 'Paid SellerTray order is missing issued invoice' using errcode='23514';
    end if;
    select p.id into v_settlement_payment_id
    from public.order_payments p
    where p.tenant_id=v_tenant_id and p.order_id=v_order_id
      and p.status='confirmed' and p.exception_state='none'
    order by p.confirmed_at desc,p.id desc limit 1;
    if v_settlement_payment_id is not null then
      insert into public.order_financial_documents(
        tenant_id,order_id,document_type,document_reference,currency,amount,status,payment_id
      ) values(
        v_tenant_id,v_order_id,'receipt','',v_invoice.currency,v_adjusted_due,'issued',v_settlement_payment_id
      ) on conflict(order_id,document_type) do nothing;
    end if;
  end if;
  return null;
end;
$$;

commit;
