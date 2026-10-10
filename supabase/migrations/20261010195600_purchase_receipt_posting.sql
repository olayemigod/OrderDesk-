begin;

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  supplier_id uuid not null,
  purchase_order_id uuid not null,
  purchase_receipt_number text not null default ('GRN-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  supplier_reference text,
  request_key text not null check (nullif(btrim(request_key),'') is not null),
  request_fingerprint text not null check (nullif(btrim(request_fingerprint),'') is not null),
  currency text not null check (char_length(currency)=3),
  total_cost numeric(14,2) not null check (total_cost>=0),
  received_at timestamptz not null,
  posted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,purchase_receipt_number),
  unique (tenant_id,request_key),
  constraint purchase_receipts_branch_same_tenant
    foreign key (tenant_id,branch_id) references public.branches(tenant_id,id) on delete cascade,
  constraint purchase_receipts_supplier_same_tenant
    foreign key (tenant_id,supplier_id) references public.suppliers(tenant_id,id) on delete cascade,
  constraint purchase_receipts_order_same_tenant
    foreign key (tenant_id,purchase_order_id) references public.purchase_orders(tenant_id,id) on delete cascade
);
create index purchase_receipts_order_time_idx on public.purchase_receipts(tenant_id,purchase_order_id,received_at desc);
create index purchase_receipts_branch_time_idx on public.purchase_receipts(tenant_id,branch_id,received_at desc);

create table public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  purchase_receipt_id uuid not null,
  purchase_order_item_id uuid not null,
  catalog_item_id uuid not null,
  item_name text not null check (nullif(btrim(item_name),'') is not null),
  sku text,
  purchase_uom text not null check (nullif(btrim(purchase_uom),'') is not null),
  quantity_received numeric(18,6) not null check (quantity_received>0),
  conversion_factor numeric(18,6) not null check (conversion_factor>0),
  stock_uom text not null check (nullif(btrim(stock_uom),'') is not null),
  stock_quantity_received numeric(18,6) not null check (stock_quantity_received>0),
  unit_cost numeric(14,2) not null check (unit_cost>=0),
  line_total numeric(14,2) not null check (line_total>=0),
  inventory_movement_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint purchase_receipt_items_receipt_same_tenant
    foreign key (tenant_id,purchase_receipt_id) references public.purchase_receipts(tenant_id,id) on delete cascade,
  constraint purchase_receipt_items_order_item_same_tenant
    foreign key (tenant_id,purchase_order_item_id) references public.purchase_order_items(tenant_id,id) on delete cascade
);
create index purchase_receipt_items_receipt_idx on public.purchase_receipt_items(tenant_id,purchase_receipt_id,id);
create index purchase_receipt_items_order_item_idx on public.purchase_receipt_items(tenant_id,purchase_order_item_id);

alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_items enable row level security;
revoke all on table public.purchase_receipts from public,anon,authenticated;
revoke all on table public.purchase_receipt_items from public,anon,authenticated;
grant select on table public.purchase_receipts to authenticated;
grant select on table public.purchase_receipt_items to authenticated;
grant all on table public.purchase_receipts to service_role;
grant all on table public.purchase_receipt_items to service_role;

create policy purchase_receipts_select_management on public.purchase_receipts
for select to authenticated using (exists (
  select 1 from public.tenant_members tm where tm.tenant_id=purchase_receipts.tenant_id
    and tm.user_id=(select auth.uid()) and tm.role in ('owner','manager')
));
create policy purchase_receipt_items_select_management on public.purchase_receipt_items
for select to authenticated using (exists (
  select 1 from public.tenant_members tm where tm.tenant_id=purchase_receipt_items.tenant_id
    and tm.user_id=(select auth.uid()) and tm.role in ('owner','manager')
));

create or replace function public.get_sellertray_purchase_order(p_tenant_id uuid,p_purchase_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_order jsonb; v_items jsonb; v_receipts jsonb;
begin
  perform public.sellertray_require_purchasing_management(p_tenant_id,false);
  select jsonb_build_object(
    'id',po.id,'purchaseOrderNumber',po.purchase_order_number,'branchId',po.branch_id,'branchName',b.name,
    'supplierId',po.supplier_id,'supplierName',s.name,'status',po.status,'currency',po.currency,
    'expectedDate',po.expected_date,'notes',po.notes,'totalAmount',po.total_amount,
    'orderedAt',po.ordered_at,'cancelledAt',po.cancelled_at,'createdAt',po.created_at,'updatedAt',po.updated_at
  ) into v_order
  from public.purchase_orders po join public.branches b on b.tenant_id=po.tenant_id and b.id=po.branch_id
  join public.suppliers s on s.tenant_id=po.tenant_id and s.id=po.supplier_id
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id;
  if v_order is null then raise exception 'Purchase Order not found' using errcode='P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',poi.id,'catalogItemId',poi.catalog_item_id,'itemName',poi.item_name,'sku',poi.sku,
    'purchaseUomId',poi.purchase_uom_id,'purchaseUom',poi.purchase_uom,'quantityOrdered',poi.quantity_ordered,
    'conversionFactor',poi.conversion_factor,'stockUom',poi.stock_uom,'stockQuantityOrdered',poi.stock_quantity_ordered,
    'allowFractional',poi.allow_fractional,'unitCost',poi.unit_cost,'lineTotal',poi.line_total,
    'stockQuantityReceived',coalesce((select sum(pri.stock_quantity_received) from public.purchase_receipt_items pri
      where pri.tenant_id=poi.tenant_id and pri.purchase_order_item_id=poi.id),0)
  ) order by poi.created_at,poi.id),'[]'::jsonb) into v_items
  from public.purchase_order_items poi where poi.tenant_id=p_tenant_id and poi.purchase_order_id=p_purchase_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',pr.id,'purchaseReceiptNumber',pr.purchase_receipt_number,'supplierReference',pr.supplier_reference,
    'totalCost',pr.total_cost,'receivedAt',pr.received_at,'createdAt',pr.created_at
  ) order by pr.received_at desc,pr.id desc),'[]'::jsonb) into v_receipts
  from public.purchase_receipts pr where pr.tenant_id=p_tenant_id and pr.purchase_order_id=p_purchase_order_id;

  return v_order || jsonb_build_object('items',v_items,'receipts',v_receipts);
end; $$;

create or replace function public.post_sellertray_purchase_receipt(
  p_tenant_id uuid,p_purchase_order_id uuid,p_supplier_reference text,p_received_at timestamptz,
  p_request_key text,p_items jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid(); v_order public.purchase_orders%rowtype; v_existing public.purchase_receipts%rowtype;
  v_request_key text:=nullif(btrim(coalesce(p_request_key,'')),'');
  v_reference text:=nullif(btrim(coalesce(p_supplier_reference,'')),'');
  v_received_at timestamptz:=coalesce(p_received_at,now()); v_fingerprint text;
  v_receipt_id uuid; v_receipt_number text; v_stock_location_id uuid; v_item jsonb;
  v_order_item_id uuid; v_quantity numeric; v_line public.purchase_order_items%rowtype;
  v_already_received numeric; v_stock_quantity numeric; v_line_total numeric(14,2); v_total numeric(14,2):=0;
  v_movement_id uuid; v_total_ordered_stock numeric; v_total_received_stock numeric;
begin
  perform public.sellertray_require_purchasing_management(p_tenant_id,true);
  if v_request_key is null or char_length(v_request_key)>160 then raise exception 'A receipt request key is required' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Add at least one received product' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'purchaseOrderItemId') from jsonb_array_elements(p_items)) then
    raise exception 'Each Purchase Order item can appear only once in a receipt' using errcode='22023';
  end if;

  v_fingerprint:=md5(jsonb_build_object('purchaseOrderId',p_purchase_order_id,'supplierReference',v_reference,'items',p_items)::text);
  select * into v_existing from public.purchase_receipts pr
  where pr.tenant_id=p_tenant_id and pr.request_key=v_request_key;
  if found then
    if v_existing.purchase_order_id<>p_purchase_order_id or v_existing.request_fingerprint<>v_fingerprint then
      raise exception 'Receipt request key is already used for a different receipt' using errcode='23505';
    end if;
    return jsonb_build_object('receiptId',v_existing.id,'purchaseReceiptNumber',v_existing.purchase_receipt_number,
      'purchaseOrderId',v_existing.purchase_order_id,'status',(select po.status from public.purchase_orders po
        where po.tenant_id=p_tenant_id and po.id=v_existing.purchase_order_id),
      'totalCost',v_existing.total_cost,'replayed',true);
  end if;

  select * into v_order from public.purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase Order not found' using errcode='P0002'; end if;
  if v_order.status not in ('ordered','partially_received') then
    raise exception 'Only an Ordered Purchase Order can receive stock' using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,v_user_id) then
    raise exception 'Purchase Order Branch is unavailable' using errcode='42501';
  end if;
  select sl.id into v_stock_location_id from public.stock_locations sl
  where sl.tenant_id=p_tenant_id and sl.branch_id=v_order.branch_id and sl.is_default and sl.is_active
  order by sl.created_at,sl.id limit 1;
  if v_stock_location_id is null then raise exception 'Purchase Order Branch has no active default stock location' using errcode='23514'; end if;

  -- First pass validates and locks every ordered line. No receipt evidence or
  -- stock movement exists until all lines are proven safe.
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_order_item_id:=nullif(v_item->>'purchaseOrderItemId','')::uuid;
      v_quantity:=(v_item->>'quantity')::numeric;
    exception when others then
      raise exception 'Each receipt line needs a valid Purchase Order item and Quantity' using errcode='22023';
    end;
    if v_order_item_id is null or v_quantity is null or v_quantity<=0 then
      raise exception 'Each receipt line needs a valid Purchase Order item and Quantity' using errcode='22023';
    end if;
    select * into v_line from public.purchase_order_items poi
    where poi.tenant_id=p_tenant_id and poi.purchase_order_id=v_order.id and poi.id=v_order_item_id for update;
    if not found then raise exception 'Purchase Order item not found' using errcode='23503'; end if;
    if not v_line.allow_fractional and v_quantity<>trunc(v_quantity) then
      raise exception 'This Purchase Unit does not allow fractional quantity' using errcode='23514';
    end if;
    select coalesce(sum(pri.stock_quantity_received),0) into v_already_received
    from public.purchase_receipt_items pri where pri.tenant_id=p_tenant_id and pri.purchase_order_item_id=v_line.id;
    v_stock_quantity:=round((v_quantity*v_line.conversion_factor)::numeric,6);
    if v_already_received+v_stock_quantity>v_line.stock_quantity_ordered then
      raise exception 'Received quantity exceeds the remaining Purchase Order quantity for %',v_line.item_name using errcode='23514';
    end if;
    v_total:=v_total+round((v_quantity*v_line.unit_cost)::numeric,2);
  end loop;

  insert into public.purchase_receipts(tenant_id,branch_id,supplier_id,purchase_order_id,supplier_reference,
    request_key,request_fingerprint,currency,total_cost,received_at,posted_by_user_id)
  values(p_tenant_id,v_order.branch_id,v_order.supplier_id,v_order.id,v_reference,v_request_key,v_fingerprint,
    v_order.currency,v_total,v_received_at,v_user_id)
  returning id,purchase_receipt_number into v_receipt_id,v_receipt_number;

  -- Second pass posts exactly one immutable receipt line and ledger movement per
  -- Purchase Order line using the frozen Purchase-UOM snapshot.
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_order_item_id:=(v_item->>'purchaseOrderItemId')::uuid;
    v_quantity:=(v_item->>'quantity')::numeric;
    select * into v_line from public.purchase_order_items poi
    where poi.tenant_id=p_tenant_id and poi.purchase_order_id=v_order.id and poi.id=v_order_item_id;
    v_stock_quantity:=round((v_quantity*v_line.conversion_factor)::numeric,6);
    v_line_total:=round((v_quantity*v_line.unit_cost)::numeric,2);
    perform pg_catalog.pg_advisory_xact_lock(public.sellertray_inventory_lock_key(
      p_tenant_id,v_order.branch_id,v_stock_location_id,v_line.catalog_item_id));
    v_movement_id:=public.record_sellertray_inventory_movement(
      p_tenant_id,v_order.branch_id,v_stock_location_id,v_line.catalog_item_id,'purchase_receipt',v_stock_quantity,
      v_line.purchase_uom,v_quantity,v_line.conversion_factor,'purchase_receipt',v_receipt_id::text,
      'purchase_receipt:'||v_receipt_id::text||':'||v_line.id::text,v_received_at,v_user_id,
      'Purchase receipt '||v_receipt_number,
      jsonb_build_object('purchaseOrderId',v_order.id,'purchaseOrderNumber',v_order.purchase_order_number,
        'supplierId',v_order.supplier_id,'supplierReference',v_reference,'purchaseOrderItemId',v_line.id),null
    );
    insert into public.purchase_receipt_items(tenant_id,purchase_receipt_id,purchase_order_item_id,catalog_item_id,
      item_name,sku,purchase_uom,quantity_received,conversion_factor,stock_uom,stock_quantity_received,
      unit_cost,line_total,inventory_movement_id)
    values(p_tenant_id,v_receipt_id,v_line.id,v_line.catalog_item_id,v_line.item_name,v_line.sku,v_line.purchase_uom,
      round(v_quantity,6),v_line.conversion_factor,v_line.stock_uom,v_stock_quantity,v_line.unit_cost,v_line_total,v_movement_id);
  end loop;

  select coalesce(sum(poi.stock_quantity_ordered),0) into v_total_ordered_stock
  from public.purchase_order_items poi where poi.tenant_id=p_tenant_id and poi.purchase_order_id=v_order.id;
  select coalesce(sum(pri.stock_quantity_received),0) into v_total_received_stock
  from public.purchase_receipt_items pri join public.purchase_order_items poi
    on poi.tenant_id=pri.tenant_id and poi.id=pri.purchase_order_item_id
  where poi.tenant_id=p_tenant_id and poi.purchase_order_id=v_order.id;
  update public.purchase_orders po
  set status=case when v_total_received_stock>=v_total_ordered_stock then 'received' else 'partially_received' end,
      updated_at=now()
  where po.tenant_id=p_tenant_id and po.id=v_order.id;

  return jsonb_build_object('receiptId',v_receipt_id,'purchaseReceiptNumber',v_receipt_number,'purchaseOrderId',v_order.id,
    'status',case when v_total_received_stock>=v_total_ordered_stock then 'received' else 'partially_received' end,
    'totalCost',v_total,'replayed',false);
end; $$;

create or replace function public.prevent_sellertray_purchase_receipt_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then return old; end if;
  raise exception 'Posted Purchase Receipts are immutable' using errcode='55000';
end; $$;
revoke all on function public.prevent_sellertray_purchase_receipt_mutation() from public,anon,authenticated;
drop trigger if exists prevent_purchase_receipt_update on public.purchase_receipts;
create trigger prevent_purchase_receipt_update before update on public.purchase_receipts for each row execute function public.prevent_sellertray_purchase_receipt_mutation();
drop trigger if exists prevent_purchase_receipt_delete on public.purchase_receipts;
create trigger prevent_purchase_receipt_delete before delete on public.purchase_receipts for each row execute function public.prevent_sellertray_purchase_receipt_mutation();
drop trigger if exists prevent_purchase_receipt_item_update on public.purchase_receipt_items;
create trigger prevent_purchase_receipt_item_update before update on public.purchase_receipt_items for each row execute function public.prevent_sellertray_purchase_receipt_mutation();
drop trigger if exists prevent_purchase_receipt_item_delete on public.purchase_receipt_items;
create trigger prevent_purchase_receipt_item_delete before delete on public.purchase_receipt_items for each row execute function public.prevent_sellertray_purchase_receipt_mutation();

revoke all on function public.get_sellertray_purchase_order(uuid,uuid) from public,anon;
revoke all on function public.post_sellertray_purchase_receipt(uuid,uuid,text,timestamptz,text,jsonb) from public,anon;
grant execute on function public.get_sellertray_purchase_order(uuid,uuid) to authenticated,service_role;
grant execute on function public.post_sellertray_purchase_receipt(uuid,uuid,text,timestamptz,text,jsonb) to authenticated;

commit;