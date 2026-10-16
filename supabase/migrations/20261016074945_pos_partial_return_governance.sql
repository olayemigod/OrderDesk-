begin;

alter table public.orders
  drop constraint if exists orders_return_status_check;
alter table public.orders
  add constraint orders_return_status_check
  check (return_status in ('none','partial','returned'));

alter table public.sale_returns
  drop constraint if exists sale_returns_tenant_id_order_id_key,
  drop constraint if exists sale_returns_return_type_check;
alter table public.sale_returns
  alter column return_type set default 'partial',
  add constraint sale_returns_return_type_check
    check (return_type in ('partial','full')),
  add column if not exists command_id_hash text,
  add column if not exists command_fingerprint text;

alter table public.sale_returns
  drop constraint if exists sale_returns_command_id_hash_check,
  add constraint sale_returns_command_id_hash_check
    check (command_id_hash is null or command_id_hash ~ '^[0-9a-f]{32}$'),
  drop constraint if exists sale_returns_command_fingerprint_check,
  add constraint sale_returns_command_fingerprint_check
    check (command_fingerprint is null or command_fingerprint ~ '^[0-9a-f]{32}$');

create unique index if not exists sale_returns_command_unique
  on public.sale_returns(tenant_id,command_id_hash)
  where command_id_hash is not null;
create index if not exists sale_returns_order_created_idx
  on public.sale_returns(tenant_id,order_id,created_at,id);

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
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_items jsonb;
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
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_refund_sale') then
    raise exception 'You do not have permission to refund completed sales' using errcode='42501';
  end if;
  if v_order.status<>'completed'
     or v_order.payment_status<>'paid'
     or v_order.fulfillment_status<>'collected'
     or v_order.return_status not in ('none','partial') then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;

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
      greatest(oi.line_total-coalesce(sum(sri.line_total),0),0)::numeric(18,2) remaining_value
    from public.order_items oi
    left join public.sale_return_items sri
      on sri.tenant_id=oi.tenant_id and sri.order_item_id=oi.id
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
    group by oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,oi.unit_price,oi.line_total
    having oi.quantity-coalesce(sum(sri.quantity),0)>0
  ) x;

  return jsonb_build_object(
    'orderId',v_order.id,
    'publicOrderId',v_order.public_order_id,
    'currency',v_order.currency,
    'returnStatus',v_order.return_status,
    'returnedAmount',v_order.returned_amount,
    'remainingAmount',greatest(v_order.total_amount-v_order.returned_amount,0),
    'items',v_items
  );
end;
$$;

revoke all on function public.get_sellertray_pos_returnable_items(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_pos_returnable_items(uuid,uuid) to authenticated;

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
declare
  v_order public.orders%rowtype;
  v_payment public.order_payments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_command_id text := nullif(btrim(coalesce(p_command_id,'')),'');
  v_command_hash text;
  v_fingerprint text;
  v_normalized_items jsonb;
  v_existing public.sale_returns%rowtype;
  v_existing_refund_id uuid;
  v_return_id uuid;
  v_refund_id uuid;
  v_stock_location_id uuid;
  v_item_count integer;
  v_existing_movement_count integer;
  v_request_count integer;
  v_distinct_count integer;
  v_entry jsonb;
  v_requested_qty numeric(18,6);
  v_line record;
  v_prior_qty numeric(18,6);
  v_prior_value numeric(18,2);
  v_remaining_qty numeric(18,6);
  v_line_refund numeric(18,2);
  v_refund_amount numeric(18,2) := 0;
  v_new_returned numeric(18,2);
  v_has_remaining boolean;
  v_return_status text;
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

  select jsonb_agg(e.value order by e.value->>'orderItemId')
  into v_normalized_items
  from jsonb_array_elements(p_items) e(value);

  select count(*)::integer,
         count(distinct value->>'orderItemId')::integer
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

  v_command_hash := pg_catalog.md5(p_tenant_id::text||'|'||p_order_id::text||'|'||v_command_id);
  v_fingerprint := pg_catalog.md5(v_reason||'|'||v_normalized_items::text);

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
      'refundedAmount',v_existing.amount,'currency',v_existing.currency,'idempotentReplay',true
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
    raise exception 'You do not have permission to refund completed sales' using errcode='42501';
  end if;
  if v_order.status<>'completed'
     or v_order.payment_status<>'paid'
     or v_order.fulfillment_status<>'collected'
     or v_order.return_status not in ('none','partial')
     or coalesce(v_order.returned_amount,0)>=v_order.total_amount then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;

  select * into v_payment
  from public.order_payments p
  where p.tenant_id=p_tenant_id and p.order_id=p_order_id
    and p.method_type='cash' and p.provider='pos_cash' and p.status='confirmed'
  order by p.confirmed_at,p.id
  limit 1;
  if not found then
    raise exception 'Completed POS sale has no confirmed counter cash payment' using errcode='23514';
  end if;
  if v_payment.amount<>v_order.total_amount or v_payment.currency<>v_order.currency then
    raise exception 'Completed POS cash value does not match the sale total' using errcode='23514';
  end if;

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
      v_requested_qty := (v_entry->>'quantity')::numeric(18,6);
    exception when others then
      raise exception 'Return quantity is invalid' using errcode='22023';
    end;
    if v_requested_qty<=0 then
      raise exception 'Return quantity must be greater than zero' using errcode='22023';
    end if;

    select oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,
           oi.conversion_factor,oi.stock_quantity,oi.unit_price,oi.line_total
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
       or v_line.line_total is null or v_line.line_total<0 then
      raise exception 'POS sale line has incomplete return snapshot' using errcode='23514';
    end if;

    select coalesce(sum(sri.quantity),0)::numeric(18,6),
           coalesce(sum(sri.line_total),0)::numeric(18,2)
    into v_prior_qty,v_prior_value
    from public.sale_return_items sri
    where sri.tenant_id=p_tenant_id and sri.order_item_id=v_line.id;

    v_remaining_qty := v_line.quantity-v_prior_qty;
    if v_remaining_qty<=0 or v_requested_qty>v_remaining_qty then
      raise exception 'Return quantity exceeds the quantity still available for this item' using errcode='23514';
    end if;

    if v_requested_qty=v_remaining_qty then
      v_line_refund := greatest(v_line.line_total-v_prior_value,0)::numeric(18,2);
    else
      v_line_refund := round((v_line.line_total*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
    end if;
    v_refund_amount := v_refund_amount+v_line_refund;
  end loop;

  if v_refund_amount<=0
     or coalesce(v_order.returned_amount,0)+v_refund_amount>v_order.total_amount then
    raise exception 'Return value exceeds the remaining refundable sale amount' using errcode='23514';
  end if;

  insert into public.sale_returns(
    tenant_id,branch_id,order_id,original_payment_id,return_type,status,
    amount,currency,reason,actor_user_id,command_id_hash,command_fingerprint
  ) values(
    p_tenant_id,v_order.branch_id,p_order_id,v_payment.id,'partial','completed',
    v_refund_amount,v_payment.currency,left(v_reason,500),p_actor_user_id,v_command_hash,v_fingerprint
  ) returning id into v_return_id;

  for v_entry in select value from jsonb_array_elements(v_normalized_items)
  loop
    v_requested_qty := (v_entry->>'quantity')::numeric(18,6);
    select oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,
           oi.conversion_factor,oi.stock_quantity,oi.unit_price,oi.line_total
    into v_line
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
      and oi.id=(v_entry->>'orderItemId')::uuid;

    select coalesce(sum(sri.quantity),0)::numeric(18,6),
           coalesce(sum(sri.line_total),0)::numeric(18,2)
    into v_prior_qty,v_prior_value
    from public.sale_return_items sri
    where sri.tenant_id=p_tenant_id and sri.order_item_id=v_line.id;
    v_remaining_qty := v_line.quantity-v_prior_qty;
    if v_requested_qty=v_remaining_qty then
      v_line_refund := greatest(v_line.line_total-v_prior_value,0)::numeric(18,2);
    else
      v_line_refund := round((v_line.line_total*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
    end if;

    insert into public.sale_return_items(
      tenant_id,sale_return_id,order_item_id,catalog_item_id,product_name,
      selected_uom,quantity,conversion_factor,stock_quantity,unit_price,line_total
    ) values(
      p_tenant_id,v_return_id,v_line.id,v_line.catalog_item_id,v_line.item_name,
      v_line.selected_uom,v_requested_qty,v_line.conversion_factor,
      (v_requested_qty*v_line.conversion_factor)::numeric(18,6),
      v_line.unit_price,v_line_refund
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
        'order_item_id',v_line.id,'original_payment_id',v_payment.id,'partial_return',true
      ),null
    );
  end loop;

  insert into public.payment_refunds(
    tenant_id,order_id,original_payment_id,sale_return_id,method_type,provider,status,
    amount,currency,reason,actor_user_id,idempotency_key
  ) values(
    p_tenant_id,p_order_id,v_payment.id,v_return_id,'cash','pos_cash','confirmed',
    v_refund_amount,v_payment.currency,left(v_reason,500),p_actor_user_id,
    'pos-cash-return:'||p_order_id::text||':'||v_command_hash
  ) returning id into v_refund_id;

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

  v_new_returned := (coalesce(v_order.returned_amount,0)+v_refund_amount)::numeric(18,2);
  if v_has_remaining then
    v_return_status := 'partial';
  else
    v_return_status := 'returned';
    v_new_returned := v_order.total_amount;
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
    'allowed','applied',-v_refund_amount,v_payment.currency,
    jsonb_build_object('return_status',v_order.return_status,'returned_amount',v_order.returned_amount),
    jsonb_build_object('return_status',v_return_status,'returned_amount',v_new_returned),
    jsonb_build_object(
      'return_id',v_return_id,'refund_id',v_refund_id,'original_payment_id',v_payment.id,
      'reason',left(v_reason,500),'items',v_normalized_items
    ),now()
  ) on conflict(tenant_id,action_key) do nothing;

  return jsonb_build_object(
    'orderId',p_order_id,'returnId',v_return_id,'refundId',v_refund_id,
    'returnStatus',v_return_status,'refundedAmount',v_refund_amount,
    'returnedAmount',v_new_returned,'currency',v_payment.currency,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  to service_role;

commit;
