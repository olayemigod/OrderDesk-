-- Restore the approved Mobile POS hold/resume authority boundary without regressing
-- later Resume Sale capabilities. Clean unpaid POS drafts remain editable by
-- authenticated Business members who can operate the owning Branch, including
-- governed Product/Unit additions. Controlled selling-price overrides still require
-- the stronger can_manage_orders capability inside this same command.

create or replace function public.update_sellertray_pos_draft_items(
  p_tenant_id uuid,
  p_order_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_order public.orders%rowtype;
  v_expected_count integer;
  v_existing_input_count integer;
  v_existing_distinct_count integer;
  v_row jsonb;
  v_item_id uuid;
  v_catalog_item_id uuid;
  v_uom_id uuid;
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

  begin
    select
      count(*) filter (where nullif(value->>'orderItemId','') is not null)::int,
      count(distinct nullif(value->>'orderItemId','')::uuid)::int
    into v_existing_input_count,v_existing_distinct_count
    from jsonb_array_elements(p_items);
  exception when invalid_text_representation then
    raise exception 'Draft item edit is invalid' using errcode='22023';
  end;

  if v_existing_input_count<>v_expected_count
     or v_existing_distinct_count<>v_expected_count then
    raise exception 'Submit each current draft item exactly once before adding new products' using errcode='22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item_id:=nullif(v_row->>'orderItemId','')::uuid;
      v_catalog_item_id:=nullif(v_row->>'catalogItemId','')::uuid;
      v_uom_id:=nullif(v_row->>'uomId','')::uuid;
      v_quantity:=nullif(v_row->>'quantity','')::numeric;
      v_has_price:=v_row ? 'unitPrice';
      v_requested_price:=case when v_has_price then nullif(v_row->>'unitPrice','')::numeric else null end;
    exception when invalid_text_representation then
      raise exception 'Draft item edit is invalid' using errcode='22023';
    end;

    if v_quantity is null or v_quantity<0 or v_quantity>9999 then
      raise exception 'Draft item quantity must be between zero and 9999' using errcode='22023';
    end if;
    if v_has_price and (v_requested_price is null or v_requested_price<0 or v_requested_price>999999999999.99) then
      raise exception 'Draft item price is invalid' using errcode='22023';
    end if;

    if v_item_id is not null then
      if v_catalog_item_id is not null or v_uom_id is not null then
        raise exception 'Existing draft items cannot change Product or Unit identity' using errcode='22023';
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
      v_catalog_item_id:=v_item.catalog_item_id;
    else
      if v_catalog_item_id is null or v_uom_id is null or v_quantity<=0 then
        raise exception 'New draft products need Product, Unit and a positive quantity' using errcode='22023';
      end if;

      select u.* into v_uom
      from public.catalog_item_uoms u
      where u.tenant_id=p_tenant_id
        and u.catalog_item_id=v_catalog_item_id
        and u.id=v_uom_id
        and u.selling_price is not null
        and u.selling_price>=0;
      if not found then
        raise exception 'The selected selling unit is no longer available' using errcode='23514';
      end if;

      if exists(
        select 1
        from public.order_items oi
        where oi.tenant_id=p_tenant_id
          and oi.order_id=p_order_id
          and oi.catalog_item_id=v_catalog_item_id
          and lower(btrim(oi.selected_uom))=lower(btrim(v_uom.uom_name))
      ) then
        raise exception 'This Product and Unit already exists in the saved sale; change its quantity instead' using errcode='23514';
      end if;
    end if;

    if not v_uom.allow_fractional and v_quantity<>trunc(v_quantity) then
      raise exception '% does not allow fractional quantity',v_uom.uom_name using errcode='23514';
    end if;

    select ci.name into v_product_name
    from public.catalog_items ci
    where ci.tenant_id=p_tenant_id and ci.id=v_catalog_item_id and ci.is_active=true;
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

    if v_item_id is not null then
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
    else
      insert into public.order_items(
        tenant_id,order_id,catalog_item_id,item_name,original_item_name,quantity,
        selected_uom,conversion_factor,stock_quantity,unit_price,match_source,match_confidence
      ) values(
        p_tenant_id,p_order_id,v_catalog_item_id,v_product_name,v_product_name,v_quantity,
        v_uom.uom_name,v_uom.conversion_factor,
        round((v_quantity*v_uom.conversion_factor)::numeric,6),
        v_effective_price,'manual',1
      );
    end if;
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
$function$;

comment on function public.update_sellertray_pos_draft_items(uuid,uuid,jsonb) is
  'Edits a clean unpaid POS draft for an authorised Branch operator, including governed Product/Unit additions. Price overrides remain separately capability-gated.';
