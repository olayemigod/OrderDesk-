begin;

-- Extend the shared SellerTray permission vocabulary.
alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock',
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_review_shift',
      'can_print_receipt',
      'can_manage_devices',
      'can_manage_orders'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock',
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_review_shift',
      'can_print_receipt',
      'can_manage_devices',
      'can_manage_orders'
    ));

create or replace function public.sellertray_user_has_capability(
  p_tenant_id uuid,
  p_user_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_override boolean;
begin
  if p_tenant_id is null or p_user_id is null
     or p_capability not in (
       'can_receive_stock',
       'can_adjust_stock',
       'can_count_stock',
       'can_apply_stock_count',
       'can_transfer_stock',
       'can_open_shift',
       'can_record_cash_movement',
       'can_record_expense',
       'can_close_shift',
       'can_review_shift',
       'can_print_receipt',
       'can_manage_devices',
       'can_manage_orders'
     ) then
    return false;
  end if;

  select tm.role
  into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_user_id;

  if v_role is null then
    return false;
  end if;

  if v_role='owner' then
    return true;
  end if;

  select c.allowed
  into v_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_user_id
    and c.capability=p_capability;

  if found then
    return v_override;
  end if;

  if v_role='manager' then
    return true;
  end if;

  if v_role='staff' then
    return p_capability in (
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_print_receipt'
    );
  end if;

  return false;
end;
$$;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text)
  to service_role;


create or replace function public.set_sellertray_member_capability(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_capability text,
  p_allowed boolean,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_capability text := lower(btrim(coalesce(p_capability,'')));
  v_previous_override boolean;
  v_previous_effective boolean;
  v_changed boolean := false;
begin
  if p_tenant_id is null
     or p_target_user_id is null
     or p_actor_user_id is null
     or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required'
      using errcode='22023';
  end if;

  if v_capability not in (
    'can_receive_stock',
    'can_adjust_stock',
    'can_count_stock',
    'can_apply_stock_count',
    'can_transfer_stock',
    'can_open_shift',
    'can_record_cash_movement',
    'can_record_expense',
    'can_close_shift',
    'can_review_shift',
    'can_print_receipt',
    'can_manage_devices',
    'can_manage_orders'
  ) then
    raise exception 'Unknown SellerTray permission'
      using errcode='22023';
  end if;

  select tm.role
  into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  select tm.role
  into v_target_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions'
      using errcode='42501';
  end if;

  if v_target_role is null then
    raise exception 'Staff member does not belong to this business'
      using errcode='23503';
  end if;

  if v_target_role='owner' then
    raise exception 'Owner authority cannot be changed here'
      using errcode='42501';
  end if;

  if v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change permissions for Staff only'
      using errcode='42501';
  end if;

  v_previous_effective :=
    public.sellertray_user_has_capability(
      p_tenant_id,
      p_target_user_id,
      v_capability
    );

  select c.allowed
  into v_previous_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_target_user_id
    and c.capability=v_capability;

  if not found or v_previous_override is distinct from p_allowed then
    v_changed := true;
  end if;

  insert into public.tenant_member_capabilities(
    tenant_id,
    user_id,
    capability,
    allowed,
    granted_by,
    created_at,
    updated_at
  )
  values(
    p_tenant_id,
    p_target_user_id,
    v_capability,
    p_allowed,
    p_actor_user_id,
    now(),
    now()
  )
  on conflict(tenant_id,user_id,capability)
  do update set
    allowed=excluded.allowed,
    granted_by=excluded.granted_by,
    updated_at=now();

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,
      user_id,
      capability,
      previous_allowed,
      new_allowed,
      actor_user_id
    )
    values(
      p_tenant_id,
      p_target_user_id,
      v_capability,
      v_previous_effective,
      p_allowed,
      p_actor_user_id
    );
  end if;

  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(
  uuid,uuid,text,boolean,uuid
) from public,anon,authenticated;

grant execute on function public.set_sellertray_member_capability(
  uuid,uuid,text,boolean,uuid
) to service_role;


-- Governed service commands can carry an already-authorized merchant actor
-- into audit triggers without impersonating an authentication JWT.
create or replace function public.sellertray_current_audit_actor()
returns uuid
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_context text;
begin
  if v_actor is not null then
    return v_actor;
  end if;

  -- The explicit fallback is trusted only inside governed service-role
  -- commands. Ordinary database sessions cannot manufacture an audit actor.
  if current_user <> 'service_role' then
    return null;
  end if;

  v_context := nullif(
    current_setting('sellertray.audit_actor_user_id',true),
    ''
  );

  if v_context is null then
    return null;
  end if;

  begin
    return v_context::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

revoke all on function public.sellertray_current_audit_actor()
from public,anon,authenticated;

grant execute on function public.sellertray_current_audit_actor()
to service_role;


-- Keep order history attributable when a governed service command performs
-- the mutation after independently authorizing the merchant actor.
create or replace function public.record_order_status_event()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid := public.sellertray_current_audit_actor();
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events (
      tenant_id,
      order_id,
      event_type,
      from_status,
      to_status,
      actor_user_id,
      actor_kind,
      reason,
      created_at
    ) values (
      new.tenant_id,
      new.id,
      'created',
      null,
      new.status,
      actor,
      case when actor is null then 'system' else 'merchant' end,
      new.status_reason,
      new.created_at
    );

    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_status_events (
      tenant_id,
      order_id,
      event_type,
      from_status,
      to_status,
      actor_user_id,
      actor_kind,
      reason
    ) values (
      new.tenant_id,
      new.id,
      'transition',
      old.status,
      new.status,
      actor,
      case when actor is null then 'system' else 'merchant' end,
      new.status_reason
    );
  end if;

  return new;
end;
$$;

revoke all on function public.record_order_status_event()
from public,anon,authenticated;


-- Preserve the same actor context for commercial item auditing.
create or replace function public.audit_sellertray_order_item_commercial_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := public.sellertray_current_audit_actor();
  v_tenant_id uuid;
  v_order_id uuid;
  v_customer_id uuid;
  v_currency text;
  v_requested_by text;
  v_action_type text;
  v_action_key text;
  v_risk text := 'medium';
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_financial_impact numeric;
  v_catalogue_created_now boolean := false;
begin
  v_tenant_id := coalesce(new.tenant_id,old.tenant_id);
  v_order_id := coalesce(new.order_id,old.order_id);

  -- Preserve the historical safety rule for unauthenticated, ungoverned
  -- service writes. Governed commands supply an explicit audit actor.
  if v_actor is null and tg_op in ('INSERT','DELETE') then
    return coalesce(new,old);
  end if;

  select o.customer_id,o.currency
  into v_customer_id,v_currency
  from public.orders o
  where o.id=v_order_id and o.tenant_id=v_tenant_id;

  v_requested_by :=
    public.sellertray_commercial_actor_kind(v_tenant_id,v_actor);

  if tg_op='INSERT' then
    v_action_type := 'order_item_added';
    v_action_key := 'order-item:add:'||new.id::text;
    v_after := jsonb_build_object(
      'order_item_id',new.id,
      'catalog_item_id',new.catalog_item_id,
      'item_name',new.item_name,
      'original_item_name',new.original_item_name,
      'quantity',new.quantity,
      'unit_price',new.unit_price,
      'match_source',new.match_source,
      'match_confidence',new.match_confidence
    );

    if new.unit_price is not null then
      v_financial_impact := new.quantity * new.unit_price;
    end if;

  elsif tg_op='DELETE' then
    v_action_type := 'order_item_removed';
    v_action_key := 'order-item:remove:'||old.id::text;
    v_before := jsonb_build_object(
      'order_item_id',old.id,
      'catalog_item_id',old.catalog_item_id,
      'item_name',old.item_name,
      'original_item_name',old.original_item_name,
      'quantity',old.quantity,
      'unit_price',old.unit_price,
      'match_source',old.match_source,
      'match_confidence',old.match_confidence
    );

    if old.unit_price is not null then
      v_financial_impact := -(old.quantity * old.unit_price);
    end if;

  else
    if row(
      old.catalog_item_id,
      old.item_name,
      old.quantity,
      old.unit_price,
      old.match_source,
      old.match_confidence
    ) is not distinct from row(
      new.catalog_item_id,
      new.item_name,
      new.quantity,
      new.unit_price,
      new.match_source,
      new.match_confidence
    ) then
      return new;
    end if;

    if old.match_source='unmatched'
       and new.match_source='merchant_match'
       and new.catalog_item_id is not null then

      select ci.created_at = transaction_timestamp()
      into v_catalogue_created_now
      from public.catalog_items ci
      where ci.id=new.catalog_item_id
        and ci.tenant_id=new.tenant_id;

      if coalesce(v_catalogue_created_now,false) then
        v_action_type := 'catalogue_item_created_from_order';
        v_action_key :=
          'catalogue-create:'||new.id::text||':'||new.catalog_item_id::text;
      else
        v_action_type := 'order_item_matched_to_catalogue';
        v_action_key :=
          'catalogue-match:'||new.id::text||':'||new.catalog_item_id::text;
      end if;

    elsif old.match_source='unmatched'
          and new.match_source='one_off' then

      v_action_type := 'order_item_kept_one_off';
      v_action_key := 'catalogue-one-off:'||new.id::text;

    else
      v_action_type := 'order_item_updated';
      v_action_key :=
        'order-item:update:'||new.id::text||':'||
        md5(
          jsonb_build_object(
            'old_name',old.item_name,
            'new_name',new.item_name,
            'old_qty',old.quantity,
            'new_qty',new.quantity,
            'old_price',old.unit_price,
            'new_price',new.unit_price,
            'old_catalog',old.catalog_item_id,
            'new_catalog',new.catalog_item_id,
            'old_match',old.match_source,
            'new_match',new.match_source
          )::text
        );
    end if;

    v_before := jsonb_build_object(
      'order_item_id',old.id,
      'catalog_item_id',old.catalog_item_id,
      'item_name',old.item_name,
      'original_item_name',old.original_item_name,
      'quantity',old.quantity,
      'unit_price',old.unit_price,
      'match_source',old.match_source,
      'match_confidence',old.match_confidence
    );

    v_after := jsonb_build_object(
      'order_item_id',new.id,
      'catalog_item_id',new.catalog_item_id,
      'item_name',new.item_name,
      'original_item_name',new.original_item_name,
      'quantity',new.quantity,
      'unit_price',new.unit_price,
      'match_source',new.match_source,
      'match_confidence',new.match_confidence
    );

    v_financial_impact :=
      coalesce(new.quantity * new.unit_price,0) -
      coalesce(old.quantity * old.unit_price,0);
  end if;

  insert into public.commercial_action_ledger(
    tenant_id,
    action_key,
    channel,
    customer_id,
    target_order_id,
    action_type,
    risk_class,
    requested_by,
    actor_user_id,
    policy_result,
    action_status,
    financial_impact,
    currency,
    before_state,
    after_state,
    metadata,
    applied_at
  )
  values(
    v_tenant_id,
    v_action_key,
    'merchant_app',
    v_customer_id,
    v_order_id,
    v_action_type,
    v_risk,
    v_requested_by,
    v_actor,
    'allowed',
    'applied',
    v_financial_impact,
    v_currency,
    v_before,
    v_after,
    jsonb_build_object(
      'order_item_id',coalesce(new.id,old.id),
      'customer_wording',
        coalesce(
          new.original_item_name,
          old.original_item_name,
          new.item_name,
          old.item_name
        )
    ),
    now()
  )
  on conflict(tenant_id,action_key) do nothing;

  return coalesce(new,old);
end;
$$;

revoke all on function public.audit_sellertray_order_item_commercial_change()
from public,anon,authenticated;

-- One transaction owns the merchant decision.
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
       or not public.sellertray_user_can_access_branch(
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
  -- Automatic item edits remain blocked until the customer request
  -- preserves the selected UOM identity required by shared commerce.
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

-- Keep Team permission management aligned with the effective capability model.
create or replace function public.get_sellertray_team_access_matrix(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required'
      using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception
      'Only business Owners and Managers can review Team access'
      using errcode='42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId',tm.user_id,
        'role',tm.role,
        'usesDefaultBranchFallback',
          tm.role='staff'
          and not exists (
            select 1
            from public.branch_user_access bua0
            where bua0.tenant_id=tm.tenant_id
              and bua0.user_id=tm.user_id
          ),
        'branchAccess',
          coalesce(
            (
              select jsonb_object_agg(
                bua.branch_id::text,
                bua.can_operate
              )
              from public.branch_user_access bua
              where bua.tenant_id=tm.tenant_id
                and bua.user_id=tm.user_id
            ),
            '{}'::jsonb
          ),
        'capabilities',
          jsonb_build_object(
            'can_receive_stock',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_receive_stock'
              ),
            'can_adjust_stock',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_adjust_stock'
              ),
            'can_count_stock',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_count_stock'
              ),
            'can_apply_stock_count',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_apply_stock_count'
              ),
            'can_transfer_stock',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_transfer_stock'
              ),
            'can_open_shift',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_open_shift'
              ),
            'can_record_cash_movement',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_record_cash_movement'
              ),
            'can_record_expense',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_record_expense'
              ),
            'can_close_shift',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_close_shift'
              ),
            'can_review_shift',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_review_shift'
              ),
            'can_print_receipt',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_print_receipt'
              ),
            'can_manage_devices',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_manage_devices'
              ),
            'can_manage_orders',
              public.sellertray_user_has_capability(
                tm.tenant_id,tm.user_id,'can_manage_orders'
              )
          )
      )
      order by
        case tm.role
          when 'owner' then 0
          when 'manager' then 1
          else 2
        end,
        tm.created_at,
        tm.user_id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id;

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_team_access_matrix(uuid)
  from public,anon;

grant execute on function public.get_sellertray_team_access_matrix(uuid)
  to authenticated;

commit;

