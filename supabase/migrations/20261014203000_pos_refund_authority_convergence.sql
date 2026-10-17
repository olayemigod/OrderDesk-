begin;

alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
      'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_review_shift',
      'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
      'can_manage_payments','can_view_reports','can_refund_sale'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
      'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_review_shift',
      'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
      'can_manage_payments','can_view_reports','can_refund_sale'
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
       'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
       'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_review_shift',
       'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
       'can_manage_payments','can_view_reports','can_refund_sale'
     ) then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_user_id;

  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;

  select c.allowed into v_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id and c.user_id=p_user_id and c.capability=p_capability;
  if found then return v_override; end if;

  if v_role='manager' then return true; end if;
  if v_role='staff' then
    return p_capability in (
      'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_print_receipt'
    );
  end if;
  return false;
end;
$$;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text) to service_role;

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
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required' using errcode='22023';
  end if;
  if v_capability not in (
    'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
    'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_review_shift',
    'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
    'can_manage_payments','can_view_reports','can_refund_sale'
  ) then
    raise exception 'Unknown SellerTray permission' using errcode='22023';
  end if;

  select tm.role into v_actor_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  select tm.role into v_target_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions' using errcode='42501';
  end if;
  if v_target_role is null then raise exception 'Staff member does not belong to this business' using errcode='23503'; end if;
  if v_target_role='owner' then raise exception 'Owner authority cannot be changed here' using errcode='42501'; end if;
  if v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change permissions for Staff only' using errcode='42501';
  end if;

  v_previous_effective := public.sellertray_user_has_capability(p_tenant_id,p_target_user_id,v_capability);
  select c.allowed into v_previous_override from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id and c.user_id=p_target_user_id and c.capability=v_capability;
  if not found or v_previous_override is distinct from p_allowed then v_changed := true; end if;

  insert into public.tenant_member_capabilities(tenant_id,user_id,capability,allowed,granted_by,created_at,updated_at)
  values(p_tenant_id,p_target_user_id,v_capability,p_allowed,p_actor_user_id,now(),now())
  on conflict(tenant_id,user_id,capability) do update
    set allowed=excluded.allowed,granted_by=excluded.granted_by,updated_at=now();

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
    ) values(p_tenant_id,p_target_user_id,v_capability,v_previous_effective,p_allowed,p_actor_user_id);
  end if;
  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid) to service_role;

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
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can review Team access' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',tm.user_id,
    'role',tm.role,
    'usesDefaultBranchFallback',
      tm.role='staff' and not exists(
        select 1 from public.branch_user_access bua0
        where bua0.tenant_id=tm.tenant_id and bua0.user_id=tm.user_id
      ),
    'branchAccess',coalesce((
      select jsonb_object_agg(bua.branch_id::text,bua.can_operate)
      from public.branch_user_access bua
      where bua.tenant_id=tm.tenant_id and bua.user_id=tm.user_id
    ),'{}'::jsonb),
    'capabilities',jsonb_build_object(
      'can_manage_orders',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_orders'),
      'can_refund_sale',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_refund_sale'),
      'can_manage_products',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_products'),
      'can_receive_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_receive_stock'),
      'can_adjust_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_adjust_stock'),
      'can_count_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_count_stock'),
      'can_apply_stock_count',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_apply_stock_count'),
      'can_transfer_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_transfer_stock'),
      'can_manage_purchasing',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_purchasing'),
      'can_manage_payments',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_payments'),
      'can_open_shift',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_open_shift'),
      'can_record_cash_movement',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_record_cash_movement'),
      'can_record_expense',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_record_expense'),
      'can_close_shift',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_close_shift'),
      'can_review_shift',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_review_shift'),
      'can_print_receipt',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_print_receipt'),
      'can_manage_devices',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_devices'),
      'can_view_reports',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_view_reports')
    )
  ) order by case tm.role when 'owner' then 0 when 'manager' then 1 else 2 end,tm.created_at,tm.user_id),'[]'::jsonb)
  into v_result
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id;

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_team_access_matrix(uuid) from public,anon;
grant execute on function public.get_sellertray_team_access_matrix(uuid) to authenticated;

create or replace function public.get_sellertray_pos_return_authority(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null then
    return false;
  end if;

  return public.orderdesk_subscription_can_write(p_tenant_id)
    and public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id)
    and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_refund_sale');
end;
$$;

revoke all on function public.get_sellertray_pos_return_authority(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_pos_return_authority(uuid,uuid) to authenticated;

create or replace function public.enforce_sellertray_sale_return_authority()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.actor_user_id is null then
    raise exception 'SellerTray return requires an accountable operator' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(new.tenant_id,new.branch_id,new.actor_user_id) then
    raise exception 'You do not have access to return sales from this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(new.tenant_id,new.actor_user_id,'can_refund_sale') then
    raise exception 'You do not have permission to refund completed sales' using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_sellertray_sale_return_authority() from public,anon,authenticated;

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
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_payment public.order_payments%rowtype;
  v_return_id uuid;
  v_refund_id uuid;
  v_stock_location_id uuid;
  v_existing_movement_count integer;
  v_item_count integer;
  v_line record;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null or v_reason is null then
    raise exception 'Business, sale, operator and return reason are required' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id for update;
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

  select sr.id into v_return_id
  from public.sale_returns sr
  where sr.tenant_id=p_tenant_id and sr.order_id=p_order_id;
  if found then
    select pr.id into v_refund_id from public.payment_refunds pr
    where pr.tenant_id=p_tenant_id and pr.sale_return_id=v_return_id;
    return jsonb_build_object(
      'orderId',p_order_id,'returnId',v_return_id,'refundId',v_refund_id,
      'returnStatus','returned','idempotentReplay',true
    );
  end if;

  if v_order.status<>'completed'
     or v_order.payment_status<>'paid'
     or v_order.fulfillment_status<>'collected'
     or v_order.return_status<>'none'
     or coalesce(v_order.returned_amount,0)<>0 then
    raise exception 'Only a completed, paid and unreturned counter sale can be returned' using errcode='23514';
  end if;

  select * into v_payment from public.order_payments p
  where p.tenant_id=p_tenant_id and p.order_id=p_order_id
    and p.method_type='cash' and p.provider='pos_cash' and p.status='confirmed'
  order by p.confirmed_at,p.id limit 1;
  if not found then raise exception 'Completed POS sale has no confirmed counter cash payment' using errcode='23514'; end if;
  if v_payment.amount<>v_order.total_amount or v_payment.currency<>v_order.currency then
    raise exception 'Completed POS cash value does not match the sale total' using errcode='23514';
  end if;

  select sl.id into v_stock_location_id from public.stock_locations sl
  where sl.tenant_id=p_tenant_id and sl.branch_id=v_order.branch_id
    and sl.is_default=true and sl.is_active=true
  order by sl.created_at,sl.id limit 1;
  if v_stock_location_id is null then raise exception 'POS branch has no active default stock location' using errcode='23514'; end if;

  select count(*)::integer into v_item_count from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;
  if v_item_count<1 then raise exception 'POS sale has no returnable items' using errcode='23514'; end if;

  select count(*)::integer into v_existing_movement_count
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id and im.reference_type='order'
    and im.reference_id=p_order_id::text and im.movement_type='sale';
  if v_existing_movement_count<>v_item_count then
    raise exception 'POS sale stock history is incomplete and cannot be returned automatically' using errcode='23514';
  end if;

  insert into public.sale_returns(
    tenant_id,branch_id,order_id,original_payment_id,amount,currency,reason,actor_user_id
  ) values(
    p_tenant_id,v_order.branch_id,p_order_id,v_payment.id,v_payment.amount,v_payment.currency,
    left(v_reason,500),p_actor_user_id
  ) returning id into v_return_id;

  for v_line in
    select oi.id,oi.catalog_item_id,ci.name as product_name,
      oi.selected_uom,oi.quantity,oi.conversion_factor,oi.stock_quantity,
      oi.unit_price,oi.line_total
    from public.order_items oi
    join public.catalog_items ci on ci.tenant_id=oi.tenant_id and ci.id=oi.catalog_item_id
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
    order by oi.id
  loop
    if v_line.catalog_item_id is null or v_line.selected_uom is null
       or v_line.quantity is null or v_line.quantity<=0
       or v_line.conversion_factor is null or v_line.conversion_factor<=0
       or v_line.stock_quantity is null or v_line.stock_quantity<=0 then
      raise exception 'POS sale line has incomplete return snapshot' using errcode='23514';
    end if;

    insert into public.sale_return_items(
      tenant_id,sale_return_id,order_item_id,catalog_item_id,product_name,
      selected_uom,quantity,conversion_factor,stock_quantity,unit_price,line_total
    ) values(
      p_tenant_id,v_return_id,v_line.id,v_line.catalog_item_id,v_line.product_name,
      v_line.selected_uom,v_line.quantity,v_line.conversion_factor,v_line.stock_quantity,
      v_line.unit_price,v_line.line_total
    );

    perform public.record_sellertray_inventory_movement(
      p_tenant_id,v_order.branch_id,v_stock_location_id,v_line.catalog_item_id,
      'sale_return',v_line.stock_quantity,v_line.selected_uom,v_line.quantity,
      v_line.conversion_factor,'sale_return',v_return_id::text,
      'pos-return:'||v_return_id::text||':'||v_line.id::text,
      now(),p_actor_user_id,left(v_reason,500),
      jsonb_build_object(
        'return_id',v_return_id,'order_id',p_order_id,'public_order_id',v_order.public_order_id,
        'order_item_id',v_line.id,'original_payment_id',v_payment.id
      ),null
    );
  end loop;

  insert into public.payment_refunds(
    tenant_id,order_id,original_payment_id,sale_return_id,method_type,provider,status,
    amount,currency,reason,actor_user_id,idempotency_key
  ) values(
    p_tenant_id,p_order_id,v_payment.id,v_return_id,'cash','pos_cash','confirmed',
    v_payment.amount,v_payment.currency,left(v_reason,500),p_actor_user_id,
    'pos-cash-return:'||p_order_id::text
  ) returning id into v_refund_id;

  update public.orders
  set return_status='returned',returned_amount=v_payment.amount,returned_at=now(),updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,action_type,risk_class,
    requested_by,actor_user_id,policy_result,action_status,financial_impact,currency,
    before_state,after_state,metadata,applied_at
  ) values(
    p_tenant_id,'pos-return:'||p_order_id::text,'merchant_app',v_order.customer_id,p_order_id,
    'sale_returned','high',public.sellertray_commercial_actor_kind(p_tenant_id,p_actor_user_id),
    p_actor_user_id,'allowed','applied',-v_payment.amount,v_payment.currency,
    jsonb_build_object('return_status','none','returned_amount',0,'payment_status',v_order.payment_status),
    jsonb_build_object('return_status','returned','returned_amount',v_payment.amount,'payment_status',v_order.payment_status),
    jsonb_build_object('return_id',v_return_id,'refund_id',v_refund_id,'original_payment_id',v_payment.id,'reason',left(v_reason,500)),
    now()
  ) on conflict(tenant_id,action_key) do nothing;

  return jsonb_build_object(
    'orderId',p_order_id,'returnId',v_return_id,'refundId',v_refund_id,
    'returnStatus','returned','refundedAmount',v_payment.amount,
    'currency',v_payment.currency,'idempotentReplay',false
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
    raise exception 'You do not have permission to refund completed sales' using errcode='42501';
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

commit;
