begin;

alter table public.merchant_operational_policies
  add column if not exists allow_pos_price_override boolean not null default true,
  add column if not exists allow_pos_split_payments boolean not null default true,
  add column if not exists allow_pos_partial_payments boolean not null default false,
  add column if not exists allow_pos_pay_later boolean not null default false,
  add column if not exists pos_manual_confirmation_mode text not null default 'branch_operator';

alter table public.merchant_operational_policies
  drop constraint if exists merchant_operational_policies_pos_manual_confirmation_mode_check;
alter table public.merchant_operational_policies
  add constraint merchant_operational_policies_pos_manual_confirmation_mode_check
  check (pos_manual_confirmation_mode in ('branch_operator','payment_manager'));

create or replace function public.sellertray_get_pos_policy(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_policy public.merchant_operational_policies%rowtype;
  v_member boolean:=false;
  v_allow_price boolean:=true;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) into v_member;
  if not v_member then
    raise exception 'SellerTray business membership required' using errcode='42501';
  end if;

  select * into v_policy
  from public.merchant_operational_policies p
  where p.tenant_id=p_tenant_id;
  if found then
    v_allow_price:=v_policy.allow_pos_price_override;
  end if;

  return jsonb_build_object(
    'allowPriceOverride',coalesce(v_policy.allow_pos_price_override,true),
    'canOverridePrice',coalesce(v_allow_price,true)
      and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_orders'),
    'allowSplitPayments',coalesce(v_policy.allow_pos_split_payments,true),
    'allowPartialPayments',coalesce(v_policy.allow_pos_partial_payments,false),
    'allowPayLater',coalesce(v_policy.allow_pos_pay_later,false),
    'manualConfirmationMode',coalesce(v_policy.pos_manual_confirmation_mode,'branch_operator')
  );
end;
$$;

revoke all on function public.sellertray_get_pos_policy(uuid) from public,anon;
grant execute on function public.sellertray_get_pos_policy(uuid) to authenticated,service_role;

create or replace function public.sellertray_save_pos_policy(
  p_tenant_id uuid,
  p_allow_price_override boolean,
  p_allow_split_payments boolean,
  p_allow_partial_payments boolean,
  p_allow_pay_later boolean,
  p_manual_confirmation_mode text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_role text;
  v_mode text:=lower(btrim(coalesce(p_manual_confirmation_mode,'')));
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change POS policy' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_mode not in ('branch_operator','payment_manager') then
    raise exception 'Choose who can confirm manual payments' using errcode='22023';
  end if;

  insert into public.merchant_operational_policies(
    tenant_id,allow_pos_price_override,allow_pos_split_payments,
    allow_pos_partial_payments,allow_pos_pay_later,pos_manual_confirmation_mode,
    updated_by_user_id,updated_at
  ) values(
    p_tenant_id,coalesce(p_allow_price_override,true),coalesce(p_allow_split_payments,true),
    coalesce(p_allow_partial_payments,false),coalesce(p_allow_pay_later,false),v_mode,
    v_user_id,now()
  )
  on conflict(tenant_id) do update
    set allow_pos_price_override=excluded.allow_pos_price_override,
        allow_pos_split_payments=excluded.allow_pos_split_payments,
        allow_pos_partial_payments=excluded.allow_pos_partial_payments,
        allow_pos_pay_later=excluded.allow_pos_pay_later,
        pos_manual_confirmation_mode=excluded.pos_manual_confirmation_mode,
        updated_by_user_id=excluded.updated_by_user_id,
        updated_at=now();

  return public.sellertray_get_pos_policy(p_tenant_id);
end;
$$;

revoke all on function public.sellertray_save_pos_policy(uuid,boolean,boolean,boolean,boolean,text) from public,anon;
grant execute on function public.sellertray_save_pos_policy(uuid,boolean,boolean,boolean,boolean,text) to authenticated,service_role;

create or replace function public.sellertray_user_can_confirm_pos_manual_payment(
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
    left join public.merchant_operational_policies p on p.tenant_id=o.tenant_id
    where o.tenant_id=p_tenant_id
      and o.id=p_order_id
      and o.source='pos'
      and o.branch_id is not null
      and public.sellertray_user_can_operate_branch(p_tenant_id,o.branch_id,p_user_id)
      and (
        coalesce(p.pos_manual_confirmation_mode,'branch_operator')='branch_operator'
        or public.sellertray_user_has_capability(p_tenant_id,p_user_id,'can_manage_payments')
      )
  );
$$;

revoke all on function public.sellertray_user_can_confirm_pos_manual_payment(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_confirm_pos_manual_payment(uuid,uuid,uuid)
  to service_role;

create or replace function public.update_sellertray_pos_draft_items(
  p_tenant_id uuid,
  p_order_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_order public.orders%rowtype;
  v_expected_count integer;
  v_input_count integer;
  v_row jsonb;
  v_item_id uuid;
  v_quantity numeric(18,6);
  v_item public.order_items%rowtype;
  v_uom public.catalog_item_uoms%rowtype;
  v_product_name text;
  v_total numeric(14,2);
  v_remaining integer;
  v_requested_price numeric(14,2);
  v_has_price boolean;
  v_allow_price boolean:=true;
  v_effective_price numeric(14,2);
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_order_id is null then
    raise exception 'Business and draft sale are required' using errcode='22023';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception 'Draft sale must contain between 1 and 100 item edits' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;
  if not found then
    raise exception 'Draft sale not found' using errcode='P0002';
  end if;
  if v_order.source<>'pos' or v_order.status<>'draft'
     or v_order.payment_status<>'unpaid' or coalesce(v_order.amount_paid,0)<>0 then
    raise exception 'Only an unpaid POS draft can be edited' using errcode='23514';
  end if;
  if v_order.branch_id is null
     or not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,v_user_id) then
    raise exception 'You do not have access to edit this Branch sale' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_orders') then
    raise exception 'You do not have permission to edit draft orders' using errcode='42501';
  end if;
  if exists(select 1 from public.order_payments p where p.tenant_id=p_tenant_id and p.order_id=p_order_id)
     or exists(select 1 from public.order_financial_documents d where d.tenant_id=p_tenant_id and d.order_id=p_order_id)
     or exists(select 1 from public.inventory_movements im where im.tenant_id=p_tenant_id and im.reference_type='order' and im.reference_id=p_order_id::text) then
    raise exception 'This draft already has payment, financial document or stock activity and cannot be edited' using errcode='23514';
  end if;

  select coalesce(p.allow_pos_price_override,true)
  into v_allow_price
  from public.merchant_operational_policies p
  where p.tenant_id=p_tenant_id;
  if not found then v_allow_price:=true; end if;

  select count(*)::int into v_expected_count
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;
  select count(*)::int into v_input_count
  from (
    select distinct nullif(value->>'orderItemId','')::uuid as item_id
    from jsonb_array_elements(p_items)
  ) x
  where x.item_id is not null;
  if v_expected_count<>jsonb_array_length(p_items) or v_input_count<>v_expected_count then
    raise exception 'Submit each current draft item exactly once' using errcode='22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item_id:=nullif(v_row->>'orderItemId','')::uuid;
      v_quantity:=nullif(v_row->>'quantity','')::numeric;
      v_has_price:=v_row ? 'unitPrice';
      v_requested_price:=case when v_has_price then nullif(v_row->>'unitPrice','')::numeric else null end;
    exception when invalid_text_representation then
      raise exception 'Draft item edit is invalid' using errcode='22023';
    end;

    if v_item_id is null or v_quantity is null or v_quantity<0 or v_quantity>9999 then
      raise exception 'Draft item quantity must be between zero and 9999' using errcode='22023';
    end if;
    if v_has_price and (v_requested_price is null or v_requested_price<0 or v_requested_price>999999999999.99) then
      raise exception 'Draft item price is invalid' using errcode='22023';
    end if;

    select * into v_item
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id and oi.id=v_item_id
    for update;
    if not found then
      raise exception 'Draft item is not part of this sale' using errcode='23503';
    end if;
    if v_item.catalog_item_id is null then
      raise exception 'Unmatched draft items cannot be edited in POS' using errcode='23514';
    end if;
    if v_quantity=0 then
      delete from public.order_items
      where tenant_id=p_tenant_id and order_id=p_order_id and id=v_item_id;
      continue;
    end if;

    select u.* into v_uom
    from public.catalog_item_uoms u
    where u.tenant_id=p_tenant_id
      and u.catalog_item_id=v_item.catalog_item_id
      and lower(btrim(u.uom_name))=lower(btrim(v_item.selected_uom))
      and u.selling_price is not null
      and u.selling_price>=0
    limit 1;
    if not found then
      raise exception 'The selling unit for % is no longer available',v_item.item_name using errcode='23514';
    end if;
    if not v_uom.allow_fractional and v_quantity<>trunc(v_quantity) then
      raise exception '% does not allow fractional quantity',v_uom.uom_name using errcode='23514';
    end if;

    select ci.name into v_product_name
    from public.catalog_items ci
    where ci.tenant_id=p_tenant_id and ci.id=v_item.catalog_item_id and ci.is_active=true;
    if v_product_name is null then
      raise exception 'Product is no longer available for sale' using errcode='23514';
    end if;

    v_effective_price:=v_uom.selling_price;
    if v_has_price and abs(v_requested_price-v_uom.selling_price)>0.004 then
      if not v_allow_price then
        raise exception 'Price editing is disabled in SellerTray settings' using errcode='42501';
      end if;
      if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_orders') then
        raise exception 'You do not have permission to change selling price' using errcode='42501';
      end if;
      v_effective_price:=v_requested_price;
    end if;

    update public.order_items
    set item_name=v_product_name,
        quantity=v_quantity,
        selected_uom=v_uom.uom_name,
        conversion_factor=v_uom.conversion_factor,
        stock_quantity=round((v_quantity*v_uom.conversion_factor)::numeric,6),
        unit_price=v_effective_price,
        match_source='manual',
        match_confidence=1
    where tenant_id=p_tenant_id and order_id=p_order_id and id=v_item_id;
  end loop;

  select count(*)::int into v_remaining
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;
  if v_remaining<1 then
    raise exception 'A draft sale must keep at least one item' using errcode='23514';
  end if;

  select coalesce(sum(oi.quantity*oi.unit_price),0)::numeric(14,2)
  into v_total
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;

  update public.orders
  set total_amount=v_total,updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  return jsonb_build_object(
    'orderId',p_order_id,
    'status','draft',
    'itemCount',v_remaining,
    'totalAmount',v_total
  );
end;
$$;

revoke all on function public.update_sellertray_pos_draft_items(uuid,uuid,jsonb) from public,anon;
grant execute on function public.update_sellertray_pos_draft_items(uuid,uuid,jsonb) to authenticated;

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
  select * into v_payment
  from public.order_payments p
  where p.id=p_payment_id
  for update;
  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;
  if v_payment.method_type not in ('bank_transfer','card_terminal','cash_on_delivery','pay_on_pickup','cash') then
    raise exception 'Only offline SellerTray payments can be confirmed manually' using errcode='23514';
  end if;
  if v_payment.status not in ('initiated','pending_verification') then
    raise exception 'SellerTray payment is not awaiting confirmation' using errcode='23514';
  end if;
  if not public.orderdesk_subscription_can_write(v_payment.tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=v_payment.tenant_id and o.id=v_payment.order_id;
  if not found then
    raise exception 'SellerTray order not found' using errcode='22023';
  end if;

  if v_order.source='pos' then
    if not public.sellertray_user_can_confirm_pos_manual_payment(
      v_payment.tenant_id,v_order.id,p_actor_user_id
    ) then
      raise exception 'You do not have permission to confirm manual payments for this Branch' using errcode='42501';
    end if;
  elsif not public.sellertray_user_can_manage_order_payment(
    v_payment.tenant_id,v_order.id,p_actor_user_id
  ) then
    raise exception 'Payment management permission and Branch access are required' using errcode='42501';
  end if;

  perform public.transition_sellertray_order_payment(
    p_payment_id,'confirmed','staff',p_actor_user_id,null,null
  );
  perform public.record_sellertray_payment_event(
    v_payment.tenant_id,v_payment.order_id,v_payment.id,v_payment.provider,
    'staff:'||v_payment.id::text||':'||p_actor_user_id::text,
    'manual_confirmation','staff','verified',null,null,null,
    jsonb_build_object('note',left(coalesce(p_note,''),500))
  );

  if v_order.source='pos' and v_payment.method_type='bank_transfer' then
    perform public.finalize_sellertray_pos_confirmed_payment(p_payment_id,p_actor_user_id);
  end if;
  return p_payment_id;
end;
$$;

revoke all on function public.confirm_sellertray_offline_payment(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_offline_payment(uuid,uuid,text)
  to service_role;

commit;
