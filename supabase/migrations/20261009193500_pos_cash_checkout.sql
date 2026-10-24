begin;

alter table public.order_payments
  drop constraint if exists order_payments_method_type_check;

alter table public.order_payments
  add constraint order_payments_method_type_check
    check (method_type = any (array[
      'bank_transfer'::text,
      'paystack'::text,
      'flutterwave'::text,
      'cash_on_delivery'::text,
      'pay_on_pickup'::text,
      'cash'::text
    ]));

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
begin
  select * into v_payment
  from public.order_payments p
  where p.id=p_payment_id
  for update;

  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;

  if v_payment.method_type not in ('bank_transfer','cash_on_delivery','pay_on_pickup','cash') then
    raise exception 'Only offline SellerTray payments can be confirmed manually' using errcode='23514';
  end if;

  if v_payment.status not in ('initiated','pending_verification') then
    raise exception 'SellerTray payment is not awaiting confirmation' using errcode='23514';
  end if;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=v_payment.tenant_id and tm.user_id=p_actor_user_id
  ) then
    raise exception 'SellerTray payment confirmation requires a tenant member' using errcode='42501';
  end if;

  perform public.transition_sellertray_order_payment(
    p_payment_id,
    'confirmed',
    'staff',
    p_actor_user_id,
    null,
    null
  );

  perform public.record_sellertray_payment_event(
    v_payment.tenant_id,
    v_payment.order_id,
    v_payment.id,
    v_payment.provider,
    'staff:' || v_payment.id::text || ':' || p_actor_user_id::text,
    'manual_confirmation',
    'staff',
    'verified',
    null,
    null,
    null,
    jsonb_build_object('note',left(coalesce(p_note,''),500))
  );

  return p_payment_id;
end;
$$;

revoke all on function public.confirm_sellertray_offline_payment(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_offline_payment(uuid,uuid,text)
  to service_role;

create or replace function public.complete_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_branch_is_default boolean;
  v_stock_location_id uuid;
  v_payment_id uuid;
  v_invoice_id uuid;
  v_on_hand numeric(18,6);
  v_required numeric(18,6);
  v_product_name text;
  v_movement_count integer := 0;
  v_expected_lines integer := 0;
  v_existing_movements integer := 0;
  v_existing_cash_payments integer := 0;
  v_line record;
  v_item record;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Business, sale and operator are required' using errcode='22023';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id
    and o.id=p_order_id
  for update;

  if not found then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;

  if v_order.source<>'pos' then
    raise exception 'Only POS orders can use POS cash checkout' using errcode='23514';
  end if;

  if v_order.branch_id is null then
    raise exception 'POS sale requires a branch' using errcode='23514';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'SellerTray tenant membership required' using errcode='42501';
  end if;

  select b.is_default into v_branch_is_default
  from public.branches b
  where b.tenant_id=p_tenant_id
    and b.id=v_order.branch_id
    and b.is_active=true;

  if not found then
    raise exception 'Selected POS branch is unavailable' using errcode='23514';
  end if;

  if v_role='staff' then
    if exists (
      select 1
      from public.branch_user_access any_bua
      where any_bua.tenant_id=p_tenant_id
        and any_bua.user_id=p_actor_user_id
    ) then
      if not exists (
        select 1
        from public.branch_user_access bua
        where bua.tenant_id=p_tenant_id
          and bua.branch_id=v_order.branch_id
          and bua.user_id=p_actor_user_id
          and bua.can_operate=true
      ) then
        raise exception 'You do not have access to complete sales from this branch' using errcode='42501';
      end if;
    elsif v_branch_is_default is distinct from true then
      raise exception 'You do not have access to complete sales from this branch' using errcode='42501';
    end if;
  elsif v_role not in ('owner','manager') then
    raise exception 'Your SellerTray role cannot complete POS sales' using errcode='42501';
  end if;

  select sl.id into v_stock_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id
    and sl.branch_id=v_order.branch_id
    and sl.is_default=true
    and sl.is_active=true
  order by sl.created_at,sl.id
  limit 1;

  if v_stock_location_id is null then
    raise exception 'POS branch has no active default stock location' using errcode='23514';
  end if;

  select count(*)::integer into v_expected_lines
  from public.order_items oi
  where oi.tenant_id=p_tenant_id
    and oi.order_id=p_order_id;

  if v_expected_lines<1 then
    raise exception 'POS sale has no items' using errcode='23514';
  end if;

  select count(*)::integer into v_existing_movements
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id
    and im.reference_type='order'
    and im.reference_id=p_order_id::text
    and im.movement_type='sale';

  select count(*)::integer into v_existing_cash_payments
  from public.order_payments p
  where p.tenant_id=p_tenant_id
    and p.order_id=p_order_id
    and p.method_type='cash'
    and p.provider='pos_cash'
    and p.status='confirmed';

  if v_order.status='completed' then
    if v_order.payment_status='paid'
       and v_order.fulfillment_status='collected'
       and v_existing_cash_payments=1
       and v_existing_movements=v_expected_lines then
      select p.id into v_payment_id
      from public.order_payments p
      where p.tenant_id=p_tenant_id
        and p.order_id=p_order_id
        and p.method_type='cash'
        and p.provider='pos_cash'
        and p.status='confirmed'
      order by p.confirmed_at,p.id
      limit 1;

      return jsonb_build_object(
        'orderId',p_order_id,
        'paymentId',v_payment_id,
        'status','completed',
        'paymentStatus','paid',
        'fulfillmentStatus','collected',
        'inventoryMovementCount',v_existing_movements,
        'idempotentReplay',true
      );
    end if;

    raise exception 'Completed POS sale has inconsistent payment or stock state' using errcode='23514';
  end if;

  if v_order.status<>'draft' then
    raise exception 'POS cash checkout requires a draft sale' using errcode='23514';
  end if;

  if v_order.payment_status<>'unpaid'
     or exists (
       select 1 from public.order_payments p
       where p.tenant_id=p_tenant_id and p.order_id=p_order_id
     )
     or v_existing_movements>0 then
    raise exception 'POS draft already has payment or stock activity' using errcode='23514';
  end if;

  for v_item in
    select
      oi.catalog_item_id,
      sum(oi.stock_quantity)::numeric(18,6) as required_quantity,
      max(ci.name) as product_name
    from public.order_items oi
    join public.catalog_items ci
      on ci.tenant_id=oi.tenant_id
     and ci.id=oi.catalog_item_id
    where oi.tenant_id=p_tenant_id
      and oi.order_id=p_order_id
    group by oi.catalog_item_id
    order by oi.catalog_item_id
  loop
    if v_item.catalog_item_id is null
       or v_item.required_quantity is null
       or v_item.required_quantity<=0 then
      raise exception 'POS sale has an invalid stock quantity' using errcode='23514';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_tenant_id::text || ':' || v_order.branch_id::text || ':' ||
        v_stock_location_id::text || ':' || v_item.catalog_item_id::text,
        0
      )
    );

    select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
    into v_on_hand
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.branch_id=v_order.branch_id
      and im.stock_location_id=v_stock_location_id
      and im.catalog_item_id=v_item.catalog_item_id;

    v_required := v_item.required_quantity;
    v_product_name := v_item.product_name;

    if v_on_hand<v_required then
      raise exception 'Insufficient stock for %: % available, % required',
        coalesce(v_product_name,'product'),v_on_hand,v_required
        using errcode='23514';
    end if;
  end loop;

  update public.orders
  set status='accepted',updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  v_invoice_id := public.ensure_sellertray_invoice_for_order(p_order_id);
  if v_invoice_id is null then
    raise exception 'POS sale could not create a payable invoice' using errcode='23514';
  end if;

  v_payment_id := public.create_sellertray_order_payment(
    p_tenant_id,
    p_order_id,
    'cash',
    'pos_cash',
    'initiated',
    null,
    'pos-cash:' || p_order_id::text,
    null
  );

  perform public.confirm_sellertray_offline_payment(
    v_payment_id,
    p_actor_user_id,
    'Counter cash sale'
  );

  for v_line in
    select
      oi.id,
      oi.catalog_item_id,
      oi.selected_uom,
      oi.quantity,
      oi.conversion_factor,
      oi.stock_quantity,
      oi.unit_price
    from public.order_items oi
    where oi.tenant_id=p_tenant_id
      and oi.order_id=p_order_id
    order by oi.id
  loop
    if v_line.catalog_item_id is null
       or v_line.selected_uom is null
       or v_line.quantity is null
       or v_line.quantity<=0
       or v_line.conversion_factor is null
       or v_line.conversion_factor<=0
       or v_line.stock_quantity is null
       or v_line.stock_quantity<=0 then
      raise exception 'POS sale line has incomplete UOM stock snapshot' using errcode='23514';
    end if;

    perform public.record_sellertray_inventory_movement(
      p_tenant_id,
      v_order.branch_id,
      v_stock_location_id,
      v_line.catalog_item_id,
      'sale',
      -v_line.stock_quantity,
      v_line.selected_uom,
      v_line.quantity,
      v_line.conversion_factor,
      'order',
      p_order_id::text,
      'pos-sale:' || p_order_id::text || ':' || v_line.id::text,
      now(),
      p_actor_user_id,
      'Counter sale',
      jsonb_build_object(
        'order_id',p_order_id,
        'public_order_id',v_order.public_order_id,
        'order_item_id',v_line.id,
        'payment_id',v_payment_id,
        'unit_price',v_line.unit_price
      ),
      null
    );
    v_movement_count := v_movement_count+1;
  end loop;

  update public.orders
  set status='processing',updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  update public.orders
  set status='ready',updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  update public.orders
  set status='completed',
      fulfillment_method='customer_pickup',
      fulfillment_status='collected',
      fulfilled_at=now(),
      fulfillment_confirmed_by='merchant',
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  return jsonb_build_object(
    'orderId',p_order_id,
    'paymentId',v_payment_id,
    'status','completed',
    'paymentStatus','paid',
    'fulfillmentStatus','collected',
    'inventoryMovementCount',v_movement_count,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.complete_sellertray_pos_cash_sale(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.complete_sellertray_pos_cash_sale(uuid,uuid,uuid)
  to service_role;

commit;
