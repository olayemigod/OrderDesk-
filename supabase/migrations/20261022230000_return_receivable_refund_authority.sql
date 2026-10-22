begin;

-- A return is a commercial reversal first. Only the portion of returned value
-- that exceeds the remaining receivable becomes a monetary refund payout.
alter table public.sale_returns
  add column if not exists receivable_reduction numeric(18,2) not null default 0,
  add column if not exists refund_amount numeric(18,2) not null default 0;

-- Unpaid/pay-later returns have no original payment to reference.
alter table public.sale_returns
  alter column original_payment_id drop not null;

-- Existing return rows were created by the legacy paid-cash-only authority.
-- Backfill their settlement split from immutable refund evidence without
-- rewriting their commercial return value.
alter table public.sale_returns disable trigger prevent_sale_returns_update;
update public.sale_returns sr
set refund_amount=coalesce((
      select sum(pr.amount)::numeric(18,2)
      from public.payment_refunds pr
      where pr.tenant_id=sr.tenant_id
        and pr.sale_return_id=sr.id
        and pr.status='confirmed'
    ),0)::numeric(18,2),
    receivable_reduction=greatest(
      sr.amount-coalesce((
        select sum(pr.amount)::numeric(18,2)
        from public.payment_refunds pr
        where pr.tenant_id=sr.tenant_id
          and pr.sale_return_id=sr.id
          and pr.status='confirmed'
      ),0),0
    )::numeric(18,2);
alter table public.sale_returns enable trigger prevent_sale_returns_update;

alter table public.sale_returns
  drop constraint if exists sale_returns_settlement_split_check,
  add constraint sale_returns_settlement_split_check check (
    receivable_reduction>=0
    and refund_amount>=0
    and abs(amount-(receivable_reduction+refund_amount))<0.005
  );

-- A refund payout can be Cash or Bank. Cash uses the existing POS drawer
-- provider/trigger. Bank remains non-cash evidence and must not hit a drawer.
alter table public.payment_refunds
  drop constraint if exists payment_refunds_method_type_check,
  drop constraint if exists payment_refunds_provider_check,
  drop constraint if exists payment_refunds_method_provider_check;

alter table public.payment_refunds
  add constraint payment_refunds_method_type_check
    check (method_type in ('cash','bank_transfer')),
  add constraint payment_refunds_provider_check
    check (provider in ('pos_cash','sellertray_bank_refund')),
  add constraint payment_refunds_method_provider_check check (
    (method_type='cash' and provider='pos_cash')
    or (method_type='bank_transfer' and provider='sellertray_bank_refund')
  );

-- Preparation is available to an authenticated Business member who can operate
-- the Branch. Completion authority is returned explicitly so Mobile can let a
-- Cashier prepare a return without pretending the Cashier can pay money out.
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
  v_prior_refunds numeric(18,2):=0;
  v_outstanding numeric(18,2):=0;
  v_net_collected numeric(18,2):=0;
  v_can_complete_return boolean:=false;
  v_can_complete_refund boolean:=false;
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
     or coalesce(v_order.returned_amount,0)>=v_order.total_amount then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;
  if v_order.tax_posted_at is null then
    raise exception 'POS sale is missing its historical tax snapshot' using errcode='23514';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null then
    raise exception 'SellerTray business membership required' using errcode='42501';
  end if;

  select coalesce(sum(pr.amount),0)::numeric(18,2)
  into v_prior_refunds
  from public.payment_refunds pr
  where pr.tenant_id=p_tenant_id
    and pr.order_id=p_order_id
    and pr.status='confirmed';

  v_outstanding:=greatest(
    coalesce(v_order.total_amount,0)-coalesce(v_order.returned_amount,0)-coalesce(v_order.amount_paid,0),
    0
  )::numeric(18,2);
  v_net_collected:=greatest(coalesce(v_order.amount_paid,0)-v_prior_refunds,0)::numeric(18,2);
  v_can_complete_return:=public.orderdesk_subscription_can_write(p_tenant_id)
    and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_refund_sale');
  v_can_complete_refund:=v_can_complete_return and v_role in ('owner','manager');

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
      greatest(
        coalesce(oi.gross_line_total,oi.line_total)-coalesce(sum(sri.line_total),0),
        0
      )::numeric(18,2) remaining_value
    from public.order_items oi
    left join public.sale_return_items sri
      on sri.tenant_id=oi.tenant_id and sri.order_item_id=oi.id
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
    group by oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,
             oi.unit_price,oi.gross_line_total,oi.line_total
    having oi.quantity-coalesce(sum(sri.quantity),0)>0
  ) x;

  return jsonb_build_object(
    'orderId',v_order.id,
    'publicOrderId',v_order.public_order_id,
    'currency',v_order.currency,
    'returnStatus',v_order.return_status,
    'returnedAmount',v_order.returned_amount,
    'remainingAmount',greatest(v_order.total_amount-v_order.returned_amount,0),
    'confirmedPaid',coalesce(v_order.amount_paid,0),
    'priorRefundedAmount',v_prior_refunds,
    'netCollectedAmount',v_net_collected,
    'outstandingAmount',v_outstanding,
    'canCompleteReturn',v_can_complete_return,
    'canCompleteRefund',v_can_complete_refund,
    'role',v_role,
    'items',v_items
  );
end;
$$;

revoke all on function public.get_sellertray_pos_returnable_items(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_pos_returnable_items(uuid,uuid) to authenticated;

-- Shared return authority. p_refund_method is a payout method, not the original
-- tender method. It must be null when no payout is due.
create or replace function public.return_sellertray_pos_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_items jsonb,
  p_command_id text,
  p_refund_method text
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
  v_refund_method text:=nullif(lower(btrim(coalesce(p_refund_method,''))),'');
  v_command_hash text;
  v_fingerprint text;
  v_legacy_fingerprint text;
  v_normalized_items jsonb;
  v_existing public.sale_returns%rowtype;
  v_existing_refund public.payment_refunds%rowtype;
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
  v_line_return_value numeric(18,2);
  v_return_subtotal numeric(18,2):=0;
  v_return_tax numeric(18,2):=0;
  v_return_value numeric(18,2):=0;
  v_prior_refunds numeric(18,2):=0;
  v_outstanding_before numeric(18,2):=0;
  v_receivable_reduction numeric(18,2):=0;
  v_refund_due numeric(18,2):=0;
  v_net_collected numeric(18,2):=0;
  v_outstanding_after numeric(18,2):=0;
  v_actor_role text;
  v_new_returned numeric(18,2);
  v_has_remaining boolean;
  v_return_status text;
  v_refund_provider text;
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
  if v_refund_method is not null and v_refund_method not in ('cash','bank') then
    raise exception 'Refund method must be Cash or Bank' using errcode='22023';
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception 'Choose at least one return item' using errcode='22023';
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
  v_fingerprint:=pg_catalog.md5(v_reason||'|'||v_normalized_items::text||'|'||coalesce(v_refund_method,''));
  v_legacy_fingerprint:=pg_catalog.md5(v_reason||'|'||v_normalized_items::text);

  select * into v_existing
  from public.sale_returns sr
  where sr.tenant_id=p_tenant_id and sr.command_id_hash=v_command_hash
  limit 1;
  if found then
    if v_existing.order_id<>p_order_id
       or v_existing.command_fingerprint not in (v_fingerprint,v_legacy_fingerprint) then
      raise exception 'Return retry identity is already used for different facts' using errcode='23505';
    end if;
    select * into v_existing_refund
    from public.payment_refunds pr
    where pr.tenant_id=p_tenant_id and pr.sale_return_id=v_existing.id;
    return jsonb_build_object(
      'orderId',p_order_id,
      'returnId',v_existing.id,
      'refundId',case when found then v_existing_refund.id else null end,
      'returnStatus',(select o.return_status from public.orders o where o.tenant_id=p_tenant_id and o.id=p_order_id),
      'returnedSubtotal',coalesce(v_existing.subtotal_amount,v_existing.amount),
      'returnedTax',coalesce(v_existing.tax_amount,0),
      'returnedValue',v_existing.amount,
      'receivableReduction',coalesce(v_existing.receivable_reduction,0),
      'refundedAmount',coalesce(v_existing.refund_amount,0),
      'refundMethod',case when found then case when v_existing_refund.method_type='cash' then 'cash' else 'bank' end else null end,
      'currency',v_existing.currency,
      'idempotentReplay',true
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
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_refund_sale') then
    raise exception 'You do not have permission to complete sale returns' using errcode='42501';
  end if;
  if v_order.status<>'completed'
     or v_order.fulfillment_status<>'collected'
     or v_order.return_status not in ('none','partial')
     or coalesce(v_order.returned_amount,0)>=v_order.total_amount then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;
  if v_order.tax_posted_at is null then
    raise exception 'POS sale is missing its historical tax snapshot' using errcode='23514';
  end if;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_actor_role is null then
    raise exception 'SellerTray business membership required' using errcode='42501';
  end if;

  select coalesce(sum(pr.amount),0)::numeric(18,2)
  into v_prior_refunds
  from public.payment_refunds pr
  where pr.tenant_id=p_tenant_id
    and pr.order_id=p_order_id
    and pr.status='confirmed';

  v_outstanding_before:=greatest(
    coalesce(v_order.total_amount,0)-coalesce(v_order.returned_amount,0)-coalesce(v_order.amount_paid,0),
    0
  )::numeric(18,2);
  v_net_collected:=greatest(coalesce(v_order.amount_paid,0)-v_prior_refunds,0)::numeric(18,2);

  select p.id into v_original_payment_id
  from public.order_payments p
  where p.tenant_id=p_tenant_id
    and p.order_id=p_order_id
    and p.status='confirmed'
    and coalesce(p.exception_state,'none')='none'
    and p.currency=v_order.currency
  order by p.confirmed_at,p.created_at,p.id
  limit 1;

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
           oi.conversion_factor,oi.stock_quantity,oi.unit_price,
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
    v_line_return_value:=(v_line_subtotal+v_line_tax)::numeric(18,2);
    v_return_subtotal:=v_return_subtotal+v_line_subtotal;
    v_return_tax:=v_return_tax+v_line_tax;
    v_return_value:=v_return_value+v_line_return_value;
  end loop;

  if v_return_value<=0
     or coalesce(v_order.returned_amount,0)+v_return_value>v_order.total_amount+0.005 then
    raise exception 'Return value exceeds the remaining sale amount' using errcode='23514';
  end if;

  v_receivable_reduction:=least(v_return_value,v_outstanding_before)::numeric(18,2);
  v_refund_due:=(v_return_value-v_receivable_reduction)::numeric(18,2);
  v_outstanding_after:=greatest(v_outstanding_before-v_receivable_reduction,0)::numeric(18,2);

  if v_refund_due>v_net_collected+0.005 then
    raise exception 'Refund exceeds net confirmed money collected for this sale' using errcode='23514';
  end if;
  if v_refund_due>0 then
    if v_actor_role not in ('owner','manager') then
      raise exception 'Only an Owner or Manager can complete a monetary refund' using errcode='42501';
    end if;
    if v_refund_method is null then
      raise exception 'Choose Cash or Bank for the monetary refund' using errcode='22023';
    end if;
    if v_original_payment_id is null then
      raise exception 'Refund requires confirmed payment evidence' using errcode='23514';
    end if;
  elsif v_refund_method is not null then
    raise exception 'No monetary refund is due; refund method must be empty' using errcode='22023';
  end if;

  insert into public.sale_returns(
    tenant_id,branch_id,order_id,original_payment_id,return_type,status,
    amount,currency,reason,actor_user_id,command_id_hash,command_fingerprint,
    subtotal_amount,tax_amount,tax_configuration_id,tax_configuration_revision,tax_rate_percent,
    receivable_reduction,refund_amount
  ) values(
    p_tenant_id,v_order.branch_id,p_order_id,v_original_payment_id,'partial','completed',
    v_return_value,v_order.currency,left(v_reason,500),p_actor_user_id,v_command_hash,v_fingerprint,
    v_return_subtotal,v_return_tax,v_order.tax_configuration_id,v_order.tax_configuration_revision,v_order.tax_rate_percent,
    v_receivable_reduction,v_refund_due
  ) returning id into v_return_id;

  for v_entry in select value from jsonb_array_elements(v_normalized_items)
  loop
    v_requested_qty:=(v_entry->>'quantity')::numeric(18,6);
    select oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,
           oi.conversion_factor,oi.stock_quantity,oi.unit_price,
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
    v_line_return_value:=(v_line_subtotal+v_line_tax)::numeric(18,2);

    insert into public.sale_return_items(
      tenant_id,sale_return_id,order_item_id,catalog_item_id,product_name,
      selected_uom,quantity,conversion_factor,stock_quantity,unit_price,line_total,
      subtotal_amount,tax_amount
    ) values(
      p_tenant_id,v_return_id,v_line.id,v_line.catalog_item_id,v_line.item_name,
      v_line.selected_uom,v_requested_qty,v_line.conversion_factor,
      (v_requested_qty*v_line.conversion_factor)::numeric(18,6),
      v_line.unit_price,v_line_return_value,v_line_subtotal,v_line_tax
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
        'returned_subtotal',v_line_subtotal,'returned_tax',v_line_tax,'returned_gross',v_line_return_value,
        'receivable_reduction',v_receivable_reduction,'refund_amount',v_refund_due
      ),null
    );
  end loop;

  if v_refund_due>0 then
    v_refund_provider:=case when v_refund_method='cash' then 'pos_cash' else 'sellertray_bank_refund' end;
    insert into public.payment_refunds(
      tenant_id,order_id,original_payment_id,sale_return_id,method_type,provider,status,
      amount,currency,reason,actor_user_id,idempotency_key
    ) values(
      p_tenant_id,p_order_id,v_original_payment_id,v_return_id,
      case when v_refund_method='cash' then 'cash' else 'bank_transfer' end,
      v_refund_provider,'confirmed',v_refund_due,v_order.currency,left(v_reason,500),p_actor_user_id,
      'pos-return-refund:'||p_order_id::text||':'||v_command_hash
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
    v_new_returned:=v_order.total_amount;
  end if;

  update public.orders
  set return_status=v_return_status,
      returned_amount=v_new_returned,
      returned_at=now(),
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
      'return_status',v_order.return_status,
      'returned_amount',v_order.returned_amount,
      'outstanding_amount',v_outstanding_before,
      'net_collected_amount',v_net_collected
    ),
    jsonb_build_object(
      'return_status',v_return_status,
      'returned_amount',v_new_returned,
      'outstanding_amount',v_outstanding_after,
      'refund_amount',v_refund_due
    ),
    jsonb_build_object(
      'return_id',v_return_id,
      'refund_id',v_refund_id,
      'refund_method',v_refund_method,
      'original_payment_id',v_original_payment_id,
      'reason',left(v_reason,500),
      'items',v_normalized_items,
      'returned_subtotal',v_return_subtotal,
      'returned_tax',v_return_tax,
      'returned_gross',v_return_value,
      'receivable_reduction',v_receivable_reduction,
      'refund_amount',v_refund_due
    ),now()
  ) on conflict(tenant_id,action_key) do nothing;

  return jsonb_build_object(
    'orderId',p_order_id,
    'returnId',v_return_id,
    'refundId',v_refund_id,
    'returnStatus',v_return_status,
    'returnedSubtotal',v_return_subtotal,
    'returnedTax',v_return_tax,
    'returnedValue',v_return_value,
    'receivableReduction',v_receivable_reduction,
    'refundedAmount',v_refund_due,
    'refundMethod',v_refund_method,
    'outstandingBefore',v_outstanding_before,
    'outstandingAfter',v_outstanding_after,
    'returnedAmount',v_new_returned,
    'currency',v_order.currency,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.return_sellertray_pos_sale(uuid,uuid,uuid,text,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_sale(uuid,uuid,uuid,text,jsonb,text,text)
  to service_role;

-- Legacy quantity-aware clients continue to mean Cash when an actual payout is
-- due. The shared authority still blocks Staff/Cashier monetary completion.
create or replace function public.return_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_items jsonb,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  return public.return_sellertray_pos_sale(
    p_tenant_id,p_order_id,p_actor_user_id,p_reason,p_items,p_command_id,'cash'
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  to service_role;

create or replace function public.apply_sellertray_pos_cash_return_internal(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_items jsonb;
  v_existing_return_id uuid;
  v_existing_refund_id uuid;
begin
  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if not found or v_order.branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to return sales from this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_refund_sale') then
    raise exception 'You do not have permission to complete sale returns' using errcode='42501';
  end if;

  if v_order.return_status='returned' then
    select sr.id into v_existing_return_id
    from public.sale_returns sr
    where sr.tenant_id=p_tenant_id and sr.order_id=p_order_id
    order by sr.created_at desc,sr.id desc limit 1;
    select pr.id into v_existing_refund_id
    from public.payment_refunds pr
    where pr.tenant_id=p_tenant_id and pr.sale_return_id=v_existing_return_id;
    return jsonb_build_object(
      'orderId',p_order_id,'returnId',v_existing_return_id,'refundId',v_existing_refund_id,
      'returnStatus','returned','returnedAmount',v_order.returned_amount,'idempotentReplay',true
    );
  end if;

  select jsonb_agg(jsonb_build_object(
    'orderItemId',oi.id,
    'quantity',(oi.quantity-coalesce(r.returned_quantity,0))
  ) order by oi.id)
  into v_items
  from public.order_items oi
  left join lateral (
    select sum(sri.quantity)::numeric(18,6) as returned_quantity
    from public.sale_return_items sri
    where sri.tenant_id=oi.tenant_id and sri.order_item_id=oi.id
  ) r on true
  where oi.tenant_id=p_tenant_id
    and oi.order_id=p_order_id
    and oi.quantity-coalesce(r.returned_quantity,0)>0;

  if v_items is null or jsonb_array_length(v_items)=0 then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;

  return public.return_sellertray_pos_sale(
    p_tenant_id,p_order_id,p_actor_user_id,p_reason,v_items,
    'legacy-full-return:'||p_order_id::text,'cash'
  );
end;
$$;

revoke all on function public.apply_sellertray_pos_cash_return_internal(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;

create or replace function public.return_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_branch_id uuid;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Business, sale and operator are required' using errcode='22023';
  end if;
  select o.branch_id into v_branch_id
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if not found or v_branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to return sales from this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_refund_sale') then
    raise exception 'You do not have permission to complete sale returns' using errcode='42501';
  end if;
  return public.apply_sellertray_pos_cash_return_internal(
    p_tenant_id,p_order_id,p_actor_user_id,p_reason
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  to service_role;

-- Merchant Web return history exposes commercial reversal separately from the
-- receivable reduction and actual payout.
create or replace function public.get_sellertray_returns_management_list(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_search text:=nullif(btrim(coalesce(p_search,'')),'');
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_offset integer:=greatest(coalesce(p_offset,0),0);
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if p_tenant_id is null or p_branch_id is null then raise exception 'Business and Branch are required' using errcode='22023'; end if;
  if not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id and tm.role in ('owner','manager')) then
    raise exception 'Owner or Manager access is required to manage returns' using errcode='42501';
  end if;
  if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then
    raise exception 'Branch not found' using errcode='P0002';
  end if;

  with filtered as materialized (
    select r.id,r.order_id,o.public_order_id,r.reason,r.amount as returned_amount,
      r.receivable_reduction,r.refund_amount,
      case when pr.method_type='cash' then 'cash' when pr.method_type='bank_transfer' then 'bank' else null end as refund_method,
      r.currency,coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Walk-in customer') as customer_name,
      r.created_at,coalesce((select count(*) from public.sale_return_items ri where ri.tenant_id=r.tenant_id and ri.sale_return_id=r.id),0) as line_count
    from public.sale_returns r
    join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id
    left join public.customers c on c.tenant_id=o.tenant_id and c.id=o.customer_id
    left join public.payment_refunds pr on pr.tenant_id=r.tenant_id and pr.sale_return_id=r.id
    where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.status='completed'
      and o.branch_id=p_branch_id and o.deleted_at is null and o.status='completed'
      and (v_search is null
        or lower(coalesce(o.public_order_id,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.display_name,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(c.phone,'')) like '%'||lower(v_search)||'%'
        or lower(coalesce(r.reason,'')) like '%'||lower(v_search)||'%'
        or exists(select 1 from public.sale_return_items ri where ri.tenant_id=r.tenant_id and ri.sale_return_id=r.id and lower(coalesce(ri.product_name,'')) like '%'||lower(v_search)||'%'))
  ), paged as (
    select * from filtered order by created_at desc,id desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'orderId',p.order_id,'publicOrderId',p.public_order_id,'customerName',p.customer_name,
      'reason',p.reason,'returnedAmount',p.returned_amount,'receivableReduction',p.receivable_reduction,
      'refundAmount',p.refund_amount,'refundMethod',p.refund_method,'currency',p.currency,
      'lineCount',p.line_count,'createdAt',p.created_at
    ) order by p.created_at desc,p.id desc) from paged p),'[]'::jsonb),
    'totalCount',(select count(*) from filtered),
    'returnedAmount',coalesce((select sum(f.returned_amount) from filtered f),0),
    'receivableReduction',coalesce((select sum(f.receivable_reduction) from filtered f),0),
    'refundAmount',coalesce((select sum(f.refund_amount) from filtered f),0),
    'returnedLines',coalesce((select sum(f.line_count) from filtered f),0),
    'currency',coalesce((select f.currency from filtered f order by f.created_at desc,f.id desc limit 1),'NGN'),
    'limit',v_limit,'offset',v_offset
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_sellertray_return_management_detail(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_return_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_return jsonb;
  v_items jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if p_tenant_id is null or p_branch_id is null or p_return_id is null then raise exception 'Business, Branch and return are required' using errcode='22023'; end if;
  if not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id and tm.role in ('owner','manager')) then
    raise exception 'Owner or Manager access is required to manage returns' using errcode='42501';
  end if;

  select jsonb_build_object(
    'id',r.id,'orderId',r.order_id,'publicOrderId',o.public_order_id,
    'customerName',coalesce(nullif(btrim(c.display_name),''),nullif(btrim(c.phone),''),'Walk-in customer'),
    'reason',r.reason,'returnedAmount',r.amount,'receivableReduction',r.receivable_reduction,
    'refundAmount',r.refund_amount,
    'refundMethod',case when pr.method_type='cash' then 'cash' when pr.method_type='bank_transfer' then 'bank' else null end,
    'currency',r.currency,'createdAt',r.created_at
  ) into v_return
  from public.sale_returns r
  join public.orders o on o.tenant_id=r.tenant_id and o.id=r.order_id
  left join public.customers c on c.tenant_id=o.tenant_id and c.id=o.customer_id
  left join public.payment_refunds pr on pr.tenant_id=r.tenant_id and pr.sale_return_id=r.id
  where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.status='completed'
    and o.branch_id=p_branch_id and r.id=p_return_id and o.deleted_at is null and o.status='completed';

  if v_return is null then raise exception 'Return not found' using errcode='P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ri.id,'orderItemId',ri.order_item_id,'itemName',ri.product_name,'selectedUom',ri.selected_uom,
    'returnedQuantity',ri.quantity,'returnedStockQuantity',ri.stock_quantity,'conversionFactor',ri.conversion_factor,
    'unitPrice',ri.unit_price,'lineAmount',ri.line_total
  ) order by ri.created_at,ri.id),'[]'::jsonb) into v_items
  from public.sale_return_items ri
  where ri.tenant_id=p_tenant_id and ri.sale_return_id=p_return_id;

  return v_return||jsonb_build_object('items',v_items);
end;
$$;

revoke all on function public.get_sellertray_returns_management_list(uuid,uuid,text,integer,integer) from public,anon;
revoke all on function public.get_sellertray_return_management_detail(uuid,uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_returns_management_list(uuid,uuid,text,integer,integer) to authenticated,service_role;
grant execute on function public.get_sellertray_return_management_detail(uuid,uuid,uuid) to authenticated,service_role;

-- Keep the legacy receivable reader aligned with the same net-of-returns basis
-- already used by the Merchant Web management read.
create or replace function public.get_sellertray_customer_receivables(
  p_tenant_id uuid,
  p_limit integer default 500
)
returns table(
  order_id uuid,public_order_id text,branch_id uuid,branch_name text,customer_id uuid,
  customer_name text,customer_phone text,source text,currency text,total_amount numeric,
  amount_paid numeric,outstanding_amount numeric,created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_limit integer:=greatest(1,least(coalesce(p_limit,500),1000));
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'You do not have permission to view customer balances' using errcode='42501';
  end if;
  return query
  select o.id,o.public_order_id,o.branch_id,b.name,o.customer_id,
    coalesce(c.display_name,c.phone,c.wa_id,'Customer'),c.phone,o.source,o.currency,o.total_amount,o.amount_paid,
    greatest(o.total_amount-coalesce(o.returned_amount,0)-o.amount_paid,0)::numeric,o.created_at
  from public.orders o
  join public.branches b on b.tenant_id=o.tenant_id and b.id=o.branch_id
  join public.customers c on c.tenant_id=o.tenant_id and c.id=o.customer_id
  where o.tenant_id=p_tenant_id and o.deleted_at is null and o.status='completed'
    and o.customer_id is not null
    and greatest(o.total_amount-coalesce(o.returned_amount,0)-o.amount_paid,0)>0
    and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
  order by o.created_at desc,o.id limit v_limit;
end;
$$;

revoke all on function public.get_sellertray_customer_receivables(uuid,integer) from public,anon;
grant execute on function public.get_sellertray_customer_receivables(uuid,integer) to authenticated,service_role;

commit;
