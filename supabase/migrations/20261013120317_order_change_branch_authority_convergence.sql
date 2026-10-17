begin;

-- Reconcile the customer order-change resolver with SellerTray's shared
-- branch-operation authority. The earlier checkpoint referenced a helper name
-- that is not part of the governed branch capability foundation.
do $$
begin
  if to_regprocedure(
    'public.sellertray_user_can_operate_branch(uuid,uuid,uuid)'
  ) is null then
    raise exception
      'SellerTray branch operation authority is required before order-change governance';
  end if;
end
$$;

create or replace function public.resolve_sellertray_customer_order_change(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_request public.customer_order_change_requests%rowtype;
  v_order public.orders%rowtype;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_next_status text;
begin
  if p_request_id is null or p_actor_user_id is null then
    raise exception 'Request and staff member are required'
      using errcode='22023';
  end if;

  if v_action not in ('apply','resolve','reject') then
    raise exception 'Unsupported order request action'
      using errcode='22023';
  end if;

  select *
  into v_request
  from public.customer_order_change_requests r
  where r.id=p_request_id
  for update;

  if not found then
    raise exception 'Order change request not found'
      using errcode='P0002';
  end if;

  -- Retried execution must not repeat commercial effects.
  if v_request.status not in ('pending','reviewed') then
    return jsonb_build_object(
      'ok',true,
      'status',v_request.status,
      'alreadyHandled',true
    );
  end if;

  if not public.orderdesk_subscription_can_write(v_request.tenant_id) then
    raise exception 'SellerTray subscription is read-only'
      using errcode='42501';
  end if;

  if not public.sellertray_user_has_capability(
    v_request.tenant_id,
    p_actor_user_id,
    'can_manage_orders'
  ) then
    raise exception 'You do not have permission to manage orders'
      using errcode='42501';
  end if;

  if v_request.order_id is not null then
    select *
    into v_order
    from public.orders o
    where o.tenant_id=v_request.tenant_id
      and o.id=v_request.order_id
    for update;

    if not found then
      raise exception 'Affected order not found'
        using errcode='P0002';
    end if;

    if v_order.customer_id is distinct from v_request.customer_id then
      raise exception 'Order change request does not belong to the affected customer'
        using errcode='23514';
    end if;

    if v_order.branch_id is null
       or not public.sellertray_user_can_operate_branch(
         v_request.tenant_id,
         v_order.branch_id,
         p_actor_user_id
       ) then
      raise exception 'You do not have access to this order branch'
        using errcode='42501';
    end if;
  end if;

  if v_action='reject' then
    update public.customer_order_change_requests
    set status='rejected',
        resolved_by_user_id=p_actor_user_id,
        resolved_at=now(),
        updated_at=now()
    where id=v_request.id
      and tenant_id=v_request.tenant_id;

    update public.merchant_notifications
    set is_read=true,
        read_at=coalesce(read_at,now()),
        updated_at=now()
    where tenant_id=v_request.tenant_id
      and change_request_id=v_request.id
      and is_read=false;

    return jsonb_build_object(
      'ok',true,
      'status','rejected'
    );
  end if;

  if v_action='resolve' then
    update public.customer_order_change_requests
    set status='resolved',
        resolved_by_user_id=p_actor_user_id,
        resolved_at=now(),
        updated_at=now()
    where id=v_request.id
      and tenant_id=v_request.tenant_id;

    update public.merchant_notifications
    set is_read=true,
        read_at=coalesce(read_at,now()),
        updated_at=now()
    where tenant_id=v_request.tenant_id
      and change_request_id=v_request.id
      and is_read=false;

    return jsonb_build_object(
      'ok',true,
      'status','resolved'
    );
  end if;

  if v_request.order_id is null then
    raise exception 'Affected order is unavailable. Review the request manually.'
      using errcode='23514';
  end if;

  -- Automatic item edits remain blocked until the customer request preserves
  -- the selected UOM identity required by shared commerce.
  if v_request.request_kind in ('add_items','remove_items','change_items') then
    raise exception
      'Open the order, apply the requested item change, then mark the request handled.'
      using errcode='23514';
  end if;

  if v_request.request_kind<>'cancel_order' then
    raise exception
      'This request requires merchant review before it can be marked handled.'
      using errcode='23514';
  end if;

  if v_order.status in ('draft','needs_review') then
    v_next_status := 'rejected';
  elsif v_order.status in ('accepted','processing','ready') then
    v_next_status := 'cancelled';
  else
    raise exception
      'This order can no longer be cancelled from the customer request.'
      using errcode='23514';
  end if;

  -- The actor has already passed tenant, capability and branch authorization.
  -- Carry that identity only through SellerTray's private audit context.
  perform set_config(
    'sellertray.audit_actor_user_id',
    p_actor_user_id::text,
    true
  );

  update public.orders
  set status=v_next_status,
      status_reason='Customer requested cancellation via WhatsApp',
      updated_at=now()
  where tenant_id=v_request.tenant_id
    and id=v_request.order_id;

  update public.customer_order_change_requests
  set status='resolved',
      resolved_by_user_id=p_actor_user_id,
      resolved_at=now(),
      updated_at=now()
  where id=v_request.id
    and tenant_id=v_request.tenant_id;

  update public.merchant_notifications
  set is_read=true,
      read_at=coalesce(read_at,now()),
      updated_at=now()
  where tenant_id=v_request.tenant_id
    and change_request_id=v_request.id
    and is_read=false;

  return jsonb_build_object(
    'ok',true,
    'status','resolved',
    'applied','cancel_order',
    'orderStatus',v_next_status
  );
end;
$$;

revoke all on function public.resolve_sellertray_customer_order_change(
  uuid,uuid,text
) from public,anon,authenticated;

grant execute on function public.resolve_sellertray_customer_order_change(
  uuid,uuid,text
) to service_role;

commit;
