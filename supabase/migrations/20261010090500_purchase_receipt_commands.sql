begin;

alter table public.sellertray_purchase_order_items
  drop constraint sellertray_purchase_order_items_catalog_same_tenant,
  add constraint sellertray_purchase_order_items_catalog_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete no action deferrable initially deferred,
  drop constraint sellertray_purchase_order_items_uom_same_tenant,
  add constraint sellertray_purchase_order_items_uom_same_tenant
    foreign key (tenant_id,uom_id)
    references public.catalog_item_uoms(tenant_id,id)
    on delete no action deferrable initially deferred;

alter table public.sellertray_purchase_receipt_items
  drop constraint sellertray_purchase_receipt_items_order_item_same_tenant,
  add constraint sellertray_purchase_receipt_items_order_item_same_tenant
    foreign key (tenant_id,purchase_order_item_id)
    references public.sellertray_purchase_order_items(tenant_id,id)
    on delete no action deferrable initially deferred,
  drop constraint sellertray_purchase_receipt_items_catalog_same_tenant,
  add constraint sellertray_purchase_receipt_items_catalog_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete no action deferrable initially deferred,
  drop constraint sellertray_purchase_receipt_items_uom_same_tenant,
  add constraint sellertray_purchase_receipt_items_uom_same_tenant
    foreign key (tenant_id,uom_id)
    references public.catalog_item_uoms(tenant_id,id)
    on delete no action deferrable initially deferred,
  drop constraint sellertray_purchase_receipt_items_movement_same_tenant,
  add constraint sellertray_purchase_receipt_items_movement_same_tenant
    foreign key (tenant_id,inventory_movement_id)
    references public.inventory_movements(tenant_id,id)
    on delete no action deferrable initially deferred;

create or replace function public.get_sellertray_purchase_order_detail(
  p_tenant_id uuid,
  p_purchase_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_po public.sellertray_purchase_orders%rowtype;
  v_supplier_name text;
  v_branch_name text;
  v_items jsonb;
  v_receipts jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null then raise exception 'SellerTray business membership required' using errcode='42501'; end if;

  select po,s.name,b.name into v_po,v_supplier_name,v_branch_name
  from public.sellertray_purchase_orders po
  join public.sellertray_suppliers s on s.tenant_id=po.tenant_id and s.id=po.supplier_id
  join public.branches b on b.tenant_id=po.tenant_id and b.id=po.branch_id
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id;
  if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;

  if v_role='staff' and (
    v_po.status not in ('ordered','partially_received')
    or not public.sellertray_user_can_access_branch(p_tenant_id,v_po.branch_id,v_user_id)
    or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_receive_stock')
  ) then
    raise exception 'You do not have access to this purchase order' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId',i.id,'catalogItemId',i.catalog_item_id,'uomId',i.uom_id,'productName',i.product_name,
    'sku',i.sku,'selectedUom',i.selected_uom,'conversionFactor',i.conversion_factor,
    'orderedQuantity',i.ordered_quantity,'orderedStockQuantity',i.ordered_stock_quantity,
    'unitCost',i.unit_cost,'lineTotal',i.line_total,'receivedQuantity',i.received_quantity,
    'receivedStockQuantity',i.received_stock_quantity,
    'remainingQuantity',greatest(i.ordered_quantity-i.received_quantity,0)
  ) order by i.created_at,i.id),'[]'::jsonb)
  into v_items
  from public.sellertray_purchase_order_items i
  where i.tenant_id=p_tenant_id and i.purchase_order_id=v_po.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'receiptId',r.id,'reference',r.reference,'receivedAt',r.received_at,'notes',r.notes,
    'itemCount',coalesce(x.item_count,0)
  ) order by r.received_at desc,r.id),'[]'::jsonb)
  into v_receipts
  from public.sellertray_purchase_receipts r
  left join (
    select ri.receipt_id,count(*)::int as item_count
    from public.sellertray_purchase_receipt_items ri
    where ri.tenant_id=p_tenant_id
    group by ri.receipt_id
  ) x on x.receipt_id=r.id
  where r.tenant_id=p_tenant_id and r.purchase_order_id=v_po.id;

  return jsonb_build_object(
    'purchaseOrderId',v_po.id,'reference',v_po.reference,'status',v_po.status,
    'branchId',v_po.branch_id,'branchName',v_branch_name,
    'supplierId',v_po.supplier_id,'supplierName',v_supplier_name,
    'currency',v_po.currency,'totalAmount',v_po.total_amount,
    'expectedDate',v_po.expected_date,'notes',v_po.notes,
    'createdAt',v_po.created_at,'orderedAt',v_po.ordered_at,'receivedAt',v_po.received_at,
    'cancelledAt',v_po.cancelled_at,'cancelReason',v_po.cancel_reason,
    'items',v_items,'receipts',v_receipts
  );
end;
$$;

revoke all on function public.get_sellertray_purchase_order_detail(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_purchase_order_detail(uuid,uuid) to authenticated;

create or replace function public.receive_sellertray_purchase_order(
  p_tenant_id uuid,
  p_purchase_order_id uuid,
  p_reference text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_po public.sellertray_purchase_orders%rowtype;
  v_supplier_name text;
  v_existing_receipt public.sellertray_purchase_receipts%rowtype;
  v_receipt_id uuid;
  v_row jsonb;
  v_item_id uuid;
  v_quantity numeric(18,6);
  v_item public.sellertray_purchase_order_items%rowtype;
  v_current_factor numeric(18,6);
  v_current_uom text;
  v_result jsonb;
  v_movement_id uuid;
  v_stock_quantity numeric(18,6);
  v_count integer := 0;
  v_complete boolean;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if v_reference is null then raise exception 'Receipt reference is required' using errcode='22023'; end if;
  if char_length(v_reference)>120 then raise exception 'Receipt reference is too long' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>200 then
    raise exception 'Receipt must contain between 1 and 200 items' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select po,s.name into v_po,v_supplier_name
  from public.sellertray_purchase_orders po
  join public.sellertray_suppliers s on s.tenant_id=po.tenant_id and s.id=po.supplier_id
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id
  for update of po;
  if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;

  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_po.branch_id,v_user_id) then
    raise exception 'You do not have access to receive stock for this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_receive_stock') then
    raise exception 'You do not have permission to receive stock' using errcode='42501';
  end if;
  if v_po.status not in ('ordered','partially_received') then
    raise exception 'Only an ordered purchase can receive stock' using errcode='23514';
  end if;

  select * into v_existing_receipt
  from public.sellertray_purchase_receipts r
  where r.tenant_id=p_tenant_id and lower(btrim(r.reference))=lower(v_reference)
  limit 1;
  if found then
    if v_existing_receipt.purchase_order_id<>p_purchase_order_id then
      raise exception 'Receipt reference is already used for another purchase' using errcode='23505';
    end if;
    return jsonb_build_object(
      'receiptId',v_existing_receipt.id,'purchaseOrderId',v_existing_receipt.purchase_order_id,
      'reference',v_existing_receipt.reference,'status',v_po.status,'idempotentReplay',true
    );
  end if;

  v_receipt_id := gen_random_uuid();
  insert into public.sellertray_purchase_receipts(
    id,tenant_id,purchase_order_id,branch_id,supplier_id,reference,notes,received_by,received_at,created_at
  ) values(
    v_receipt_id,p_tenant_id,v_po.id,v_po.branch_id,v_po.supplier_id,v_reference,
    nullif(btrim(coalesce(p_notes,'')),''),v_user_id,now(),now()
  );

  for v_row in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    begin
      v_item_id := nullif(v_row->>'purchaseOrderItemId','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Receipt item % has an invalid purchase item',v_count using errcode='22023';
    end;
    v_quantity := nullif(v_row->>'quantity','')::numeric;
    if v_item_id is null or v_quantity is null or v_quantity<=0 then
      raise exception 'Receipt item % requires a positive quantity',v_count using errcode='22023';
    end if;

    select * into v_item
    from public.sellertray_purchase_order_items i
    where i.tenant_id=p_tenant_id and i.purchase_order_id=v_po.id and i.id=v_item_id
    for update;
    if not found then raise exception 'Receipt item % is not part of this purchase order',v_count using errcode='23503'; end if;
    if v_item.received_quantity+v_quantity>v_item.ordered_quantity then
      raise exception 'Receipt quantity for % exceeds the remaining ordered quantity',v_item.product_name using errcode='23514';
    end if;

    select u.conversion_factor,u.uom_name into v_current_factor,v_current_uom
    from public.catalog_item_uoms u
    where u.tenant_id=p_tenant_id and u.catalog_item_id=v_item.catalog_item_id and u.id=v_item.uom_id;
    if not found then
      raise exception 'The purchase unit for % is no longer available',v_item.product_name using errcode='23514';
    end if;
    if v_current_factor<>v_item.conversion_factor or lower(v_current_uom)<>lower(v_item.selected_uom) then
      raise exception 'The unit conversion for % changed after this purchase was placed; review the purchase before receiving stock',v_item.product_name using errcode='23514';
    end if;

    v_result := public.apply_sellertray_inventory_operation(
      p_tenant_id,
      v_po.branch_id,
      v_item.catalog_item_id,
      v_item.uom_id,
      'receive',
      v_quantity,
      null,
      left(v_reference || '/' || v_item.id::text,160),
      left('Purchase receipt ' || v_reference || ' from ' || coalesce(v_supplier_name,'supplier'),500),
      v_user_id
    );

    begin
      v_movement_id := nullif(v_result->>'movementId','')::uuid;
    exception when invalid_text_representation then
      v_movement_id := null;
    end;
    v_stock_quantity := round((v_quantity*v_item.conversion_factor)::numeric,6);
    if v_movement_id is null
       or abs(coalesce((v_result->>'quantityDelta')::numeric,0)-v_stock_quantity)>0.000001 then
      raise exception 'SellerTray could not confirm the stock movement for %',v_item.product_name using errcode='23514';
    end if;

    insert into public.sellertray_purchase_receipt_items(
      tenant_id,receipt_id,purchase_order_item_id,catalog_item_id,uom_id,selected_uom,
      conversion_factor,received_quantity,received_stock_quantity,inventory_movement_id,created_at
    ) values(
      p_tenant_id,v_receipt_id,v_item.id,v_item.catalog_item_id,v_item.uom_id,v_item.selected_uom,
      v_item.conversion_factor,v_quantity,v_stock_quantity,v_movement_id,now()
    );

    update public.sellertray_purchase_order_items
    set received_quantity=received_quantity+v_quantity,
        received_stock_quantity=received_stock_quantity+v_stock_quantity
    where tenant_id=p_tenant_id and id=v_item.id;
  end loop;

  select not exists(
    select 1 from public.sellertray_purchase_order_items i
    where i.tenant_id=p_tenant_id and i.purchase_order_id=v_po.id
      and i.received_quantity<i.ordered_quantity
  ) into v_complete;

  update public.sellertray_purchase_orders
  set status=case when v_complete then 'received' else 'partially_received' end,
      received_at=case when v_complete then coalesce(received_at,now()) else received_at end,
      updated_at=now()
  where tenant_id=p_tenant_id and id=v_po.id
  returning * into v_po;

  return jsonb_build_object(
    'receiptId',v_receipt_id,'purchaseOrderId',v_po.id,'reference',v_reference,
    'status',v_po.status,'itemCount',v_count,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)
  from public,anon;
grant execute on function public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb)
  to authenticated;

commit;
