begin;

-- Order workflow, line correction and fulfillment are shared commerce commands.
-- Historical Branch visibility remains readable, but mutations require the
-- actor to be able to operate the order Branch and to hold can_manage_orders.
create or replace function public.sellertray_user_can_manage_order_operation(
  p_tenant_id uuid,
  p_order_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.orders o
    where o.tenant_id=p_tenant_id
      and o.id=p_order_id
      and o.branch_id is not null
      and public.sellertray_user_can_operate_branch(
        p_tenant_id,
        o.branch_id,
        p_user_id
      )
      and public.sellertray_user_has_capability(
        p_tenant_id,
        p_user_id,
        'can_manage_orders'
      )
  );
$$;

revoke all on function public.sellertray_user_can_manage_order_operation(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_manage_order_operation(uuid,uuid,uuid)
  to service_role;

-- Read-only current-user authority for capability-aware clients.
create or replace function public.get_sellertray_order_action_authority(
  p_tenant_id uuid,
  p_order_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_tenant_id is null or p_order_id is null then
    return false;
  end if;

  return public.orderdesk_subscription_can_write(p_tenant_id)
    and public.sellertray_user_can_manage_order_operation(
      p_tenant_id,
      p_order_id,
      v_user_id
    );
end;
$$;

revoke all on function public.get_sellertray_order_action_authority(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_order_action_authority(uuid,uuid)
  to authenticated,service_role;

-- Merchant workflow transition command. Existing order triggers remain the
-- authority for legal state transitions, payment gates, fulfillment evidence
-- and paid-cancellation safety.
create or replace function public.transition_sellertray_order(
  p_tenant_id uuid,
  p_order_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_status text := lower(btrim(coalesce(p_status,'')));
  v_reason text := nullif(left(btrim(coalesce(p_reason,'')),500),'');
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_order_id is null then
    raise exception 'Business and order are required' using errcode='22023';
  end if;
  if v_status not in ('accepted','rejected','processing','ready','cancelled') then
    raise exception 'Unsupported order workflow action' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_order_operation(
    p_tenant_id,p_order_id,v_user_id
  ) then
    raise exception 'Order management permission and Branch access are required'
      using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;

  if not found then
    raise exception 'SellerTray order not found' using errcode='P0002';
  end if;
  if v_order.source='pos' then
    raise exception 'Use the sale workflow for POS orders' using errcode='23514';
  end if;

  perform set_config('sellertray.audit_actor_user_id',v_user_id::text,true);

  update public.orders
  set status=v_status,
      status_reason=v_reason,
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  return jsonb_build_object(
    'orderId',p_order_id,
    'status',v_status
  );
end;
$$;

revoke all on function public.transition_sellertray_order(uuid,uuid,text,text)
  from public,anon;
grant execute on function public.transition_sellertray_order(uuid,uuid,text,text)
  to authenticated,service_role;

-- Govern manual/customer-order line corrections. POS draft edits already use
-- update_sellertray_pos_draft_items and must not diverge into this command.
create or replace function public.mutate_sellertray_order_item(
  p_tenant_id uuid,
  p_order_id uuid,
  p_action text,
  p_item_id uuid default null,
  p_item_name text default null,
  p_quantity numeric default null,
  p_unit_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_name text := nullif(left(regexp_replace(btrim(coalesce(p_item_name,'')),'\\s+',' ','g'),200),'');
  v_item_id uuid := p_item_id;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_order_id is null then
    raise exception 'Business and order are required' using errcode='22023';
  end if;
  if v_action not in ('add','update','delete') then
    raise exception 'Unsupported order item action' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_order_operation(
    p_tenant_id,p_order_id,v_user_id
  ) then
    raise exception 'Order management permission and Branch access are required'
      using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;

  if not found then
    raise exception 'SellerTray order not found' using errcode='P0002';
  end if;
  if v_order.source='pos' then
    raise exception 'Use the sale editor for POS draft items' using errcode='23514';
  end if;

  perform set_config('sellertray.audit_actor_user_id',v_user_id::text,true);

  if v_action='add' then
    if v_name is null or p_quantity is null or p_quantity<=0 or p_quantity>9999 then
      raise exception 'Item name and a valid quantity are required' using errcode='22023';
    end if;
    if p_unit_price is not null and p_unit_price<0 then
      raise exception 'Item price cannot be negative' using errcode='22023';
    end if;

    insert into public.order_items(
      tenant_id,order_id,item_name,original_item_name,quantity,unit_price,
      match_source,match_confidence
    ) values(
      p_tenant_id,p_order_id,v_name,v_name,p_quantity,p_unit_price,
      'manual',null
    )
    returning id into v_item_id;

  elsif v_action='update' then
    if v_item_id is null then
      raise exception 'Order item is required' using errcode='22023';
    end if;
    if v_name is null or p_quantity is null or p_quantity<=0 or p_quantity>9999 then
      raise exception 'Item name and a valid quantity are required' using errcode='22023';
    end if;
    if p_unit_price is not null and p_unit_price<0 then
      raise exception 'Item price cannot be negative' using errcode='22023';
    end if;

    update public.order_items
    set item_name=v_name,
        quantity=p_quantity,
        unit_price=p_unit_price
    where tenant_id=p_tenant_id
      and order_id=p_order_id
      and id=v_item_id;

    if not found then
      raise exception 'SellerTray order item not found' using errcode='P0002';
    end if;

  else
    if v_item_id is null then
      raise exception 'Order item is required' using errcode='22023';
    end if;

    delete from public.order_items
    where tenant_id=p_tenant_id
      and order_id=p_order_id
      and id=v_item_id;

    if not found then
      raise exception 'SellerTray order item not found' using errcode='P0002';
    end if;
  end if;

  return jsonb_build_object(
    'orderId',p_order_id,
    'itemId',v_item_id,
    'action',v_action
  );
end;
$$;

revoke all on function public.mutate_sellertray_order_item(uuid,uuid,text,uuid,text,numeric,numeric)
  from public,anon;
grant execute on function public.mutate_sellertray_order_item(uuid,uuid,text,uuid,text,numeric,numeric)
  to authenticated,service_role;

-- Fulfillment is executed by the edge service, but all business effects are
-- committed in one database transaction so authority, payment policy, status
-- history and commercial audit cannot diverge.
create or replace function public.apply_sellertray_order_fulfillment(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_method text,
  p_provider text default null,
  p_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_method text := lower(btrim(coalesce(p_method,'')));
  v_provider text := nullif(left(regexp_replace(btrim(coalesce(p_provider,'')),'\\s+',' ','g'),120),'');
  v_reference text := nullif(left(regexp_replace(btrim(coalesce(p_reference,'')),'\\s+',' ','g'),120),'');
  v_note text := nullif(left(btrim(coalesce(p_note,'')),300),'');
  v_role text;
  v_decision jsonb;
  v_now timestamptz := now();
  v_action_type text;
  v_action_key text;
  v_before jsonb;
  v_after jsonb;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Business, order and staff member are required' using errcode='22023';
  end if;
  if v_action not in ('start_delivery','complete_fulfillment') then
    raise exception 'Unsupported fulfillment action' using errcode='22023';
  end if;
  if v_method not in ('customer_pickup','merchant_delivery','third_party_delivery') then
    raise exception 'Choose a valid fulfillment method' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_order_operation(
    p_tenant_id,p_order_id,p_actor_user_id
  ) then
    raise exception 'Order management permission and Branch access are required'
      using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;

  if not found then
    raise exception 'SellerTray order not found' using errcode='P0002';
  end if;
  if v_order.source='pos' then
    raise exception 'POS collection is completed through the sale workflow' using errcode='23514';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  v_before := jsonb_build_object(
    'status',v_order.status,
    'payment_status',v_order.payment_status,
    'amount_paid',v_order.amount_paid,
    'total_amount',v_order.total_amount,
    'fulfillment_method',v_order.fulfillment_method,
    'fulfillment_status',v_order.fulfillment_status,
    'delivery_provider',v_order.delivery_provider,
    'delivery_reference',v_order.delivery_reference,
    'dispatched_at',v_order.dispatched_at,
    'fulfilled_at',v_order.fulfilled_at,
    'fulfillment_confirmed_by',v_order.fulfillment_confirmed_by
  );

  perform set_config('sellertray.audit_actor_user_id',p_actor_user_id::text,true);

  if v_action='start_delivery' then
    if v_method='customer_pickup' then
      raise exception 'Customer pickup does not require a delivery start' using errcode='22023';
    end if;
    if v_order.status<>'ready' then
      raise exception 'Only a ready order can start delivery' using errcode='23514';
    end if;
    if v_order.fulfillment_status='out_for_delivery' then
      if v_order.fulfillment_method<>v_method then
        raise exception 'Delivery has already started with a different fulfillment method'
          using errcode='23514';
      end if;
      return jsonb_build_object(
        'orderId',p_order_id,
        'status','ready',
        'fulfillmentStatus','out_for_delivery',
        'alreadyStarted',true
      );
    end if;
    if v_order.fulfillment_status<>'unassigned' then
      raise exception 'This order fulfillment state cannot start delivery' using errcode='23514';
    end if;

    v_decision := public.sellertray_payment_gate_decision(p_order_id,'dispatch');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%',coalesce(v_decision->>'reason','Payment policy blocks dispatch')
        using errcode='23514';
    end if;

    update public.orders
    set fulfillment_method=v_method,
        fulfillment_status='out_for_delivery',
        delivery_provider=v_provider,
        delivery_reference=v_reference,
        delivery_note=v_note,
        dispatched_at=v_now,
        fulfilled_at=null,
        updated_at=v_now
    where tenant_id=p_tenant_id and id=p_order_id
    returning * into v_updated;

    v_action_type := 'delivery_started';
  else
    if v_order.status='completed' then
      return jsonb_build_object(
        'orderId',p_order_id,
        'status','completed',
        'fulfillmentStatus',v_order.fulfillment_status,
        'alreadyCompleted',true
      );
    end if;
    if v_order.status<>'ready' then
      raise exception 'Only a ready order can be completed' using errcode='23514';
    end if;

    v_decision := public.sellertray_payment_gate_decision(p_order_id,'complete');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%',coalesce(v_decision->>'reason','Payment policy blocks completion')
        using errcode='23514';
    end if;

    if v_method='customer_pickup' then
      if v_order.fulfillment_status<>'unassigned' then
        raise exception 'An order already in delivery cannot be completed as customer pickup'
          using errcode='23514';
      end if;

      update public.orders
      set status='completed',
          status_reason=null,
          fulfillment_method='customer_pickup',
          fulfillment_status='collected',
          fulfillment_confirmed_by='merchant',
          customer_confirmed_at=null,
          customer_confirmation_message_id=null,
          delivery_provider=null,
          delivery_reference=null,
          delivery_note=v_note,
          fulfilled_at=v_now,
          updated_at=v_now
      where tenant_id=p_tenant_id and id=p_order_id
      returning * into v_updated;

      v_action_type := 'pickup_completed';
    else
      if v_order.fulfillment_status<>'out_for_delivery' then
        raise exception 'Start delivery before marking this order delivered' using errcode='23514';
      end if;
      if v_order.fulfillment_method<>v_method then
        raise exception 'Fulfillment method does not match the active delivery' using errcode='23514';
      end if;

      update public.orders
      set status='completed',
          status_reason=null,
          fulfillment_status='delivered',
          fulfillment_confirmed_by='merchant',
          customer_confirmed_at=null,
          customer_confirmation_message_id=null,
          fulfilled_at=v_now,
          updated_at=v_now
      where tenant_id=p_tenant_id and id=p_order_id
      returning * into v_updated;

      v_action_type := 'delivery_completed';
    end if;
  end if;

  v_after := jsonb_build_object(
    'status',v_updated.status,
    'payment_status',v_updated.payment_status,
    'amount_paid',v_updated.amount_paid,
    'total_amount',v_updated.total_amount,
    'fulfillment_method',v_updated.fulfillment_method,
    'fulfillment_status',v_updated.fulfillment_status,
    'delivery_provider',v_updated.delivery_provider,
    'delivery_reference',v_updated.delivery_reference,
    'dispatched_at',v_updated.dispatched_at,
    'fulfilled_at',v_updated.fulfilled_at,
    'fulfillment_confirmed_by',v_updated.fulfillment_confirmed_by
  );

  v_action_key := 'fulfillment:'||p_order_id::text||':'||v_action_type||':'||
    coalesce(v_updated.dispatched_at,v_updated.fulfilled_at,v_now)::text;

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,action_type,
    risk_class,requested_by,actor_user_id,policy_result,action_status,
    financial_impact,currency,before_state,after_state,metadata,applied_at
  ) values(
    p_tenant_id,v_action_key,'merchant_app',v_updated.customer_id,p_order_id,v_action_type,
    case when v_action='start_delivery' then 'medium' else 'high' end,
    case when v_role='staff' then 'staff' else 'merchant' end,
    p_actor_user_id,'allowed','applied',null,v_updated.currency,v_before,v_after,
    jsonb_build_object(
      'public_order_id',v_updated.public_order_id,
      'delivery_provider',coalesce(v_updated.delivery_provider,v_provider),
      'delivery_reference',coalesce(v_updated.delivery_reference,v_reference),
      'note',coalesce(v_updated.delivery_note,v_note)
    ),
    v_now
  )
  on conflict(tenant_id,action_key) do nothing;

  return jsonb_build_object(
    'orderId',p_order_id,
    'status',v_updated.status,
    'fulfillmentStatus',v_updated.fulfillment_status
  );
end;
$$;

revoke all on function public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)
  to service_role;

-- Authenticated clients may read order history directly, but all business
-- mutations now go through governed commands above or dedicated POS commands.
revoke insert,update,delete on table public.orders from authenticated;
revoke update(status,status_reason,updated_at) on table public.orders from authenticated;

revoke insert,update,delete on table public.order_items from authenticated;
revoke insert(tenant_id,order_id,item_name,quantity,unit_price)
  on table public.order_items from authenticated;
revoke update(item_name,quantity,unit_price)
  on table public.order_items from authenticated;

grant select on table public.orders to authenticated;
grant select on table public.order_items to authenticated;

commit;
