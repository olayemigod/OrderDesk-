begin;

-- Bank transfer at the counter is a payment claim, not settlement. The sale
-- remains unfulfilled and stock remains untouched until an authorised operator
-- confirms the transfer. Cash/card-terminal checkout keeps the existing
-- immediate-settlement path.
create or replace function public.initiate_sellertray_pos_bank_transfer(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_method_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_method public.merchant_payment_methods%rowtype;
  v_invoice_id uuid;
  v_payment_id uuid;
begin
  if p_tenant_id is null or p_order_id is null or p_payment_method_id is null or p_actor_user_id is null then
    raise exception 'Business, sale, payment method and operator are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id for update;
  if not found or v_order.source<>'pos' or v_order.branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to complete sales from this branch' using errcode='42501';
  end if;

  select * into v_method from public.merchant_payment_methods m
  where m.tenant_id=p_tenant_id and m.id=p_payment_method_id and m.is_enabled=true;
  if not found or v_method.method_type<>'bank_transfer' then
    raise exception 'Selected payment method is not an enabled bank transfer method' using errcode='23514';
  end if;
  if not exists(select 1 from public.sellertray_branch_payment_methods bpm
    where bpm.tenant_id=p_tenant_id and bpm.branch_id=v_order.branch_id
      and bpm.payment_method_id=p_payment_method_id and bpm.is_enabled=true) then
    raise exception 'Selected payment method is not assigned to this branch' using errcode='23514';
  end if;

  if v_order.status='accepted' and v_order.payment_status='unpaid' then
    select p.id into v_payment_id from public.order_payments p
    where p.tenant_id=p_tenant_id and p.order_id=p_order_id
      and p.payment_method_id=p_payment_method_id
      and p.status in ('initiated','pending_verification')
    order by p.created_at,p.id limit 1;
    if v_payment_id is not null then
      return jsonb_build_object('orderId',p_order_id,'paymentId',v_payment_id,
        'paymentMethodId',p_payment_method_id,'methodType','bank_transfer',
        'status','awaiting_payment_confirmation','paymentStatus','unpaid',
        'fulfillmentStatus',v_order.fulfillment_status,'inventoryMovementCount',0,
        'idempotentReplay',true);
    end if;
  end if;

  if v_order.status<>'draft' or v_order.payment_status<>'unpaid' then
    raise exception 'POS bank transfer requires an unpaid draft sale' using errcode='23514';
  end if;
  if not exists(select 1 from public.order_items oi where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id) then
    raise exception 'POS sale has no items' using errcode='23514';
  end if;
  if exists(select 1 from public.order_payments p where p.tenant_id=p_tenant_id and p.order_id=p_order_id)
     or exists(select 1 from public.inventory_movements im where im.tenant_id=p_tenant_id and im.reference_type='order' and im.reference_id=p_order_id::text and im.movement_type='sale') then
    raise exception 'POS draft already has payment or stock activity' using errcode='23514';
  end if;

  update public.orders set status='accepted',updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;
  v_invoice_id := public.ensure_sellertray_invoice_for_order(p_order_id);
  if v_invoice_id is null then raise exception 'POS sale could not create a payable invoice' using errcode='23514'; end if;

  v_payment_id := public.create_sellertray_order_payment_for_method(
    p_tenant_id,p_order_id,p_payment_method_id,'pending_verification',null,
    'pos-bank:' || p_order_id::text || ':' || p_payment_method_id::text,now()
  );

  return jsonb_build_object('orderId',p_order_id,'paymentId',v_payment_id,
    'paymentMethodId',p_payment_method_id,'methodType','bank_transfer',
    'status','awaiting_payment_confirmation','paymentStatus','unpaid',
    'fulfillmentStatus',v_order.fulfillment_status,'inventoryMovementCount',0,
    'idempotentReplay',false);
end;
$$;
revoke all on function public.initiate_sellertray_pos_bank_transfer(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.initiate_sellertray_pos_bank_transfer(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.finalize_sellertray_pos_confirmed_payment(
  p_payment_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.order_payments%rowtype;
  v_order public.orders%rowtype;
  v_stock_location_id uuid;
  v_existing integer;
  v_expected integer;
  v_on_hand numeric(18,6);
  v_item record;
  v_line record;
  v_count integer := 0;
begin
  select * into v_payment from public.order_payments p where p.id=p_payment_id for update;
  if not found or v_payment.status<>'confirmed' then
    raise exception 'POS payment must be confirmed before sale finalisation' using errcode='23514';
  end if;
  select * into v_order from public.orders o
  where o.tenant_id=v_payment.tenant_id and o.id=v_payment.order_id for update;
  if not found or v_order.source<>'pos' or v_order.branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(v_payment.tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to complete sales from this branch' using errcode='42501';
  end if;

  select count(*)::integer into v_expected from public.order_items oi
  where oi.tenant_id=v_payment.tenant_id and oi.order_id=v_order.id;
  select count(*)::integer into v_existing from public.inventory_movements im
  where im.tenant_id=v_payment.tenant_id and im.reference_type='order'
    and im.reference_id=v_order.id::text and im.movement_type='sale';
  if v_order.status='completed' and v_order.payment_status='paid' and v_order.fulfillment_status='collected' and v_existing=v_expected then
    return jsonb_build_object('orderId',v_order.id,'paymentId',v_payment.id,'status','completed','inventoryMovementCount',v_existing,'idempotentReplay',true);
  end if;
  if v_order.status<>'accepted' then
    raise exception 'POS sale is not awaiting payment settlement' using errcode='23514';
  end if;

  select sl.id into v_stock_location_id from public.stock_locations sl
  where sl.tenant_id=v_payment.tenant_id and sl.branch_id=v_order.branch_id
    and sl.is_default=true and sl.is_active=true order by sl.created_at,sl.id limit 1;
  if v_stock_location_id is null then raise exception 'POS branch has no active default stock location' using errcode='23514'; end if;

  for v_item in
    select oi.catalog_item_id,sum(oi.stock_quantity)::numeric(18,6) required_quantity,max(ci.name) product_name
    from public.order_items oi join public.catalog_items ci on ci.tenant_id=oi.tenant_id and ci.id=oi.catalog_item_id
    where oi.tenant_id=v_payment.tenant_id and oi.order_id=v_order.id
    group by oi.catalog_item_id order by oi.catalog_item_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_payment.tenant_id::text || ':' || v_order.branch_id::text || ':' || v_stock_location_id::text || ':' || v_item.catalog_item_id::text,0));
    select coalesce(sum(im.quantity_delta),0)::numeric(18,6) into v_on_hand
    from public.inventory_movements im where im.tenant_id=v_payment.tenant_id
      and im.branch_id=v_order.branch_id and im.stock_location_id=v_stock_location_id and im.catalog_item_id=v_item.catalog_item_id;
    if v_on_hand<v_item.required_quantity then
      raise exception 'Insufficient stock for % after payment confirmation: % available, % required',coalesce(v_item.product_name,'product'),v_on_hand,v_item.required_quantity using errcode='23514';
    end if;
  end loop;

  for v_line in select * from public.order_items oi
    where oi.tenant_id=v_payment.tenant_id and oi.order_id=v_order.id order by oi.id
  loop
    if v_line.catalog_item_id is null or v_line.selected_uom is null or v_line.quantity<=0 or v_line.conversion_factor<=0 or v_line.stock_quantity<=0 then
      raise exception 'POS sale line has incomplete UOM stock snapshot' using errcode='23514';
    end if;
    perform public.record_sellertray_inventory_movement(
      v_payment.tenant_id,v_order.branch_id,v_stock_location_id,v_line.catalog_item_id,'sale',-v_line.stock_quantity,
      v_line.selected_uom,v_line.quantity,v_line.conversion_factor,'order',v_order.id::text,
      'pos-sale:' || v_order.id::text || ':' || v_line.id::text,now(),p_actor_user_id,'Counter sale',
      jsonb_build_object('order_id',v_order.id,'public_order_id',v_order.public_order_id,'order_item_id',v_line.id,'payment_id',v_payment.id,'payment_method_id',v_payment.payment_method_id,'payment_method_type',v_payment.method_type,'unit_price',v_line.unit_price),null
    );
    v_count:=v_count+1;
  end loop;

  update public.orders set status='processing',updated_at=now() where tenant_id=v_payment.tenant_id and id=v_order.id;
  update public.orders set status='ready',updated_at=now() where tenant_id=v_payment.tenant_id and id=v_order.id;
  update public.orders set status='completed',fulfillment_method='customer_pickup',fulfillment_status='collected',fulfilled_at=now(),fulfillment_confirmed_by='merchant',updated_at=now()
  where tenant_id=v_payment.tenant_id and id=v_order.id;

  return jsonb_build_object('orderId',v_order.id,'paymentId',v_payment.id,'status','completed','inventoryMovementCount',v_count,'idempotentReplay',false);
end;
$$;
revoke all on function public.finalize_sellertray_pos_confirmed_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_sellertray_pos_confirmed_payment(uuid,uuid) to service_role;

-- Supersede the earlier confirmation implementation: POS bank transfers finalise
-- only after confirmation, while other offline payments preserve their existing path.
create or replace function public.confirm_sellertray_offline_payment(
  p_payment_id uuid,
  p_actor_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.order_payments%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_payment from public.order_payments p where p.id=p_payment_id for update;
  if not found then raise exception 'SellerTray payment not found' using errcode='22023'; end if;
  if v_payment.method_type not in ('bank_transfer','card_terminal','cash_on_delivery','pay_on_pickup','cash') then
    raise exception 'Only offline SellerTray payments can be confirmed manually' using errcode='23514';
  end if;
  if v_payment.status not in ('initiated','pending_verification') then
    raise exception 'SellerTray payment is not awaiting confirmation' using errcode='23514';
  end if;
  if not public.orderdesk_subscription_can_write(v_payment.tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order from public.orders o where o.tenant_id=v_payment.tenant_id and o.id=v_payment.order_id;
  if v_order.source='pos' then
    if v_order.branch_id is null or not public.sellertray_user_can_operate_branch(v_payment.tenant_id,v_order.branch_id,p_actor_user_id) then
      raise exception 'You do not have access to confirm payments for this branch' using errcode='42501';
    end if;
  elsif not public.sellertray_user_has_capability(v_payment.tenant_id,p_actor_user_id,'can_manage_payments') then
    raise exception 'Payment management permission is required' using errcode='42501';
  end if;

  perform public.transition_sellertray_order_payment(p_payment_id,'confirmed','staff',p_actor_user_id,null,null);
  perform public.record_sellertray_payment_event(v_payment.tenant_id,v_payment.order_id,v_payment.id,v_payment.provider,
    'staff:' || v_payment.id::text || ':' || p_actor_user_id::text,'manual_confirmation','staff','verified',null,null,null,
    jsonb_build_object('note',left(coalesce(p_note,''),500)));

  if v_order.source='pos' and v_payment.method_type='bank_transfer' then
    perform public.finalize_sellertray_pos_confirmed_payment(p_payment_id,p_actor_user_id);
  end if;
  return p_payment_id;
end;
$$;
revoke all on function public.confirm_sellertray_offline_payment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_sellertray_offline_payment(uuid,uuid,text) to service_role;

commit;