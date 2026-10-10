begin;

create table public.sellertray_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  contact_name text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id)
);

create unique index sellertray_suppliers_name_unique
  on public.sellertray_suppliers(tenant_id,lower(btrim(name)));
create index sellertray_suppliers_tenant_active_name_idx
  on public.sellertray_suppliers(tenant_id,is_active,name);

create table public.sellertray_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  supplier_id uuid not null,
  reference text not null check (char_length(btrim(reference)) between 1 and 80),
  status text not null default 'draft'
    check (status in ('draft','ordered','partially_received','received','cancelled')),
  currency text not null check (char_length(btrim(currency))=3),
  expected_date date,
  notes text,
  total_amount numeric(14,2) not null default 0 check (total_amount>=0),
  created_by uuid references auth.users(id) on delete set null,
  ordered_by uuid references auth.users(id) on delete set null,
  cancelled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ordered_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  unique (tenant_id,id),
  constraint sellertray_purchase_orders_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint sellertray_purchase_orders_supplier_same_tenant
    foreign key (tenant_id,supplier_id)
    references public.sellertray_suppliers(tenant_id,id)
    on delete cascade
);

create unique index sellertray_purchase_orders_reference_unique
  on public.sellertray_purchase_orders(tenant_id,lower(btrim(reference)));
create index sellertray_purchase_orders_tenant_status_created_idx
  on public.sellertray_purchase_orders(tenant_id,status,created_at desc);
create index sellertray_purchase_orders_branch_status_created_idx
  on public.sellertray_purchase_orders(tenant_id,branch_id,status,created_at desc);
create index sellertray_purchase_orders_supplier_created_idx
  on public.sellertray_purchase_orders(tenant_id,supplier_id,created_at desc);

create table public.sellertray_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  purchase_order_id uuid not null,
  catalog_item_id uuid not null,
  uom_id uuid not null,
  product_name text not null,
  sku text,
  selected_uom text not null,
  conversion_factor numeric(18,6) not null check (conversion_factor>0),
  ordered_quantity numeric(18,6) not null check (ordered_quantity>0),
  ordered_stock_quantity numeric(18,6) not null check (ordered_stock_quantity>0),
  unit_cost numeric(14,2) not null check (unit_cost>=0),
  line_total numeric(14,2) not null check (line_total>=0),
  received_quantity numeric(18,6) not null default 0 check (received_quantity>=0),
  received_stock_quantity numeric(18,6) not null default 0 check (received_stock_quantity>=0),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (purchase_order_id,catalog_item_id,uom_id),
  constraint sellertray_purchase_order_items_order_same_tenant
    foreign key (tenant_id,purchase_order_id)
    references public.sellertray_purchase_orders(tenant_id,id)
    on delete cascade,
  constraint sellertray_purchase_order_items_catalog_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete restrict,
  constraint sellertray_purchase_order_items_uom_same_tenant
    foreign key (tenant_id,uom_id)
    references public.catalog_item_uoms(tenant_id,id)
    on delete restrict
);

create index sellertray_purchase_order_items_order_idx
  on public.sellertray_purchase_order_items(tenant_id,purchase_order_id,created_at,id);

create table public.sellertray_purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null,
  branch_id uuid not null,
  supplier_id uuid not null,
  reference text not null check (char_length(btrim(reference)) between 1 and 120),
  notes text,
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint sellertray_purchase_receipts_order_same_tenant
    foreign key (tenant_id,purchase_order_id)
    references public.sellertray_purchase_orders(tenant_id,id)
    on delete cascade,
  constraint sellertray_purchase_receipts_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint sellertray_purchase_receipts_supplier_same_tenant
    foreign key (tenant_id,supplier_id)
    references public.sellertray_suppliers(tenant_id,id)
    on delete cascade
);

create unique index sellertray_purchase_receipts_reference_unique
  on public.sellertray_purchase_receipts(tenant_id,lower(btrim(reference)));
create index sellertray_purchase_receipts_order_received_idx
  on public.sellertray_purchase_receipts(tenant_id,purchase_order_id,received_at desc);

create table public.sellertray_purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receipt_id uuid not null,
  purchase_order_item_id uuid not null,
  catalog_item_id uuid not null,
  uom_id uuid not null,
  selected_uom text not null,
  conversion_factor numeric(18,6) not null check (conversion_factor>0),
  received_quantity numeric(18,6) not null check (received_quantity>0),
  received_stock_quantity numeric(18,6) not null check (received_stock_quantity>0),
  inventory_movement_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (receipt_id,purchase_order_item_id),
  constraint sellertray_purchase_receipt_items_receipt_same_tenant
    foreign key (tenant_id,receipt_id)
    references public.sellertray_purchase_receipts(tenant_id,id)
    on delete cascade,
  constraint sellertray_purchase_receipt_items_order_item_same_tenant
    foreign key (tenant_id,purchase_order_item_id)
    references public.sellertray_purchase_order_items(tenant_id,id)
    on delete restrict,
  constraint sellertray_purchase_receipt_items_catalog_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete restrict,
  constraint sellertray_purchase_receipt_items_uom_same_tenant
    foreign key (tenant_id,uom_id)
    references public.catalog_item_uoms(tenant_id,id)
    on delete restrict,
  constraint sellertray_purchase_receipt_items_movement_same_tenant
    foreign key (tenant_id,inventory_movement_id)
    references public.inventory_movements(tenant_id,id)
    on delete restrict
);

create index sellertray_purchase_receipt_items_receipt_idx
  on public.sellertray_purchase_receipt_items(tenant_id,receipt_id,created_at,id);

alter table public.sellertray_suppliers enable row level security;
alter table public.sellertray_purchase_orders enable row level security;
alter table public.sellertray_purchase_order_items enable row level security;
alter table public.sellertray_purchase_receipts enable row level security;
alter table public.sellertray_purchase_receipt_items enable row level security;

revoke all on table public.sellertray_suppliers from public,anon,authenticated;
revoke all on table public.sellertray_purchase_orders from public,anon,authenticated;
revoke all on table public.sellertray_purchase_order_items from public,anon,authenticated;
revoke all on table public.sellertray_purchase_receipts from public,anon,authenticated;
revoke all on table public.sellertray_purchase_receipt_items from public,anon,authenticated;
grant all on table public.sellertray_suppliers to service_role;
grant all on table public.sellertray_purchase_orders to service_role;
grant all on table public.sellertray_purchase_order_items to service_role;
grant all on table public.sellertray_purchase_receipts to service_role;
grant all on table public.sellertray_purchase_receipt_items to service_role;

create or replace function public.sellertray_purchase_management_role(
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=p_user_id
      and tm.role in ('owner','manager')
  );
$$;

revoke all on function public.sellertray_purchase_management_role(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_purchase_management_role(uuid,uuid)
  to service_role;

create or replace function public.save_sellertray_supplier(
  p_tenant_id uuid,
  p_supplier_id uuid,
  p_name text,
  p_contact_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_notes text,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_supplier public.sellertray_suppliers%rowtype;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Owner or Manager access is required to manage suppliers' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_name is null or char_length(v_name)>160 or p_is_active is null then
    raise exception 'Supplier name and status are required' using errcode='22023';
  end if;

  if p_supplier_id is null then
    insert into public.sellertray_suppliers(
      tenant_id,name,contact_name,phone,email,address,notes,is_active,created_by,created_at,updated_at
    ) values(
      p_tenant_id,v_name,nullif(btrim(coalesce(p_contact_name,'')),''),
      nullif(btrim(coalesce(p_phone,'')),''),lower(nullif(btrim(coalesce(p_email,'')),'')),
      nullif(btrim(coalesce(p_address,'')),''),nullif(btrim(coalesce(p_notes,'')),''),
      p_is_active,v_user_id,now(),now()
    ) returning * into v_supplier;
  else
    select * into v_supplier
    from public.sellertray_suppliers s
    where s.tenant_id=p_tenant_id and s.id=p_supplier_id
    for update;
    if not found then raise exception 'Supplier not found' using errcode='P0002'; end if;
    if not p_is_active and exists(
      select 1 from public.sellertray_purchase_orders po
      where po.tenant_id=p_tenant_id and po.supplier_id=p_supplier_id
        and po.status in ('draft','ordered','partially_received')
    ) then
      raise exception 'Complete or cancel open purchase orders before deactivating this supplier' using errcode='23514';
    end if;
    update public.sellertray_suppliers
    set name=v_name,
        contact_name=nullif(btrim(coalesce(p_contact_name,'')),''),
        phone=nullif(btrim(coalesce(p_phone,'')),''),
        email=lower(nullif(btrim(coalesce(p_email,'')),'')),
        address=nullif(btrim(coalesce(p_address,'')),''),
        notes=nullif(btrim(coalesce(p_notes,'')),''),
        is_active=p_is_active,
        updated_at=now()
    where tenant_id=p_tenant_id and id=p_supplier_id
    returning * into v_supplier;
  end if;

  return jsonb_build_object(
    'supplierId',v_supplier.id,'name',v_supplier.name,'isActive',v_supplier.is_active
  );
end;
$$;

revoke all on function public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,text,boolean)
  from public,anon;
grant execute on function public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,text,boolean)
  to authenticated;

create or replace function public.get_sellertray_suppliers(p_tenant_id uuid)
returns table(
  id uuid,
  name text,
  contact_name text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Owner or Manager access is required to review suppliers' using errcode='42501';
  end if;
  return query
  select s.id,s.name,s.contact_name,s.phone,s.email,s.address,s.notes,s.is_active,s.updated_at
  from public.sellertray_suppliers s
  where s.tenant_id=p_tenant_id
  order by s.is_active desc,s.name,s.id;
end;
$$;

revoke all on function public.get_sellertray_suppliers(uuid) from public,anon;
grant execute on function public.get_sellertray_suppliers(uuid) to authenticated;

create or replace function public.save_sellertray_purchase_order(
  p_tenant_id uuid,
  p_purchase_order_id uuid,
  p_branch_id uuid,
  p_supplier_id uuid,
  p_reference text,
  p_expected_date date,
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
  v_currency text;
  v_po public.sellertray_purchase_orders%rowtype;
  v_row jsonb;
  v_catalog_item_id uuid;
  v_uom_id uuid;
  v_quantity numeric(18,6);
  v_unit_cost numeric(14,2);
  v_product_name text;
  v_sku text;
  v_selected_uom text;
  v_conversion_factor numeric(18,6);
  v_allow_fractional boolean;
  v_stock_quantity numeric(18,6);
  v_line_total numeric(14,2);
  v_total numeric(14,2) := 0;
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Owner or Manager access is required to manage purchase orders' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if p_branch_id is null or p_supplier_id is null then
    raise exception 'Branch and supplier are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id and b.is_active=true) then
    raise exception 'Selected Branch is unavailable' using errcode='23514';
  end if;
  if not exists(select 1 from public.sellertray_suppliers s where s.tenant_id=p_tenant_id and s.id=p_supplier_id and s.is_active=true) then
    raise exception 'Selected supplier is unavailable' using errcode='23514';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>200 then
    raise exception 'Purchase order must contain between 1 and 200 items' using errcode='22023';
  end if;

  select t.currency into v_currency from public.tenants t where t.id=p_tenant_id;
  if v_currency is null then raise exception 'Business not found' using errcode='P0002'; end if;
  if v_reference is null then
    v_reference := 'PO-' || to_char(now(),'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  end if;
  if char_length(v_reference)>80 then raise exception 'Purchase order reference is too long' using errcode='22023'; end if;

  if p_purchase_order_id is null then
    insert into public.sellertray_purchase_orders(
      tenant_id,branch_id,supplier_id,reference,status,currency,expected_date,notes,total_amount,created_by,created_at,updated_at
    ) values(
      p_tenant_id,p_branch_id,p_supplier_id,v_reference,'draft',upper(v_currency),p_expected_date,
      nullif(btrim(coalesce(p_notes,'')),''),0,v_user_id,now(),now()
    ) returning * into v_po;
  else
    select * into v_po
    from public.sellertray_purchase_orders po
    where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id
    for update;
    if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;
    if v_po.status<>'draft' then
      raise exception 'Only a draft purchase order can be edited' using errcode='23514';
    end if;
    update public.sellertray_purchase_orders
    set branch_id=p_branch_id,supplier_id=p_supplier_id,reference=v_reference,
        expected_date=p_expected_date,notes=nullif(btrim(coalesce(p_notes,'')),''),updated_at=now()
    where tenant_id=p_tenant_id and id=p_purchase_order_id
    returning * into v_po;
    delete from public.sellertray_purchase_order_items
    where tenant_id=p_tenant_id and purchase_order_id=v_po.id;
  end if;

  for v_row in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    begin
      v_catalog_item_id := nullif(v_row->>'catalogItemId','')::uuid;
      v_uom_id := nullif(v_row->>'uomId','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Purchase item % has an invalid product or unit',v_count using errcode='22023';
    end;
    begin
      v_quantity := nullif(v_row->>'quantity','')::numeric;
      v_unit_cost := nullif(v_row->>'unitCost','')::numeric;
    exception when invalid_text_representation then
      raise exception 'Purchase item % has an invalid quantity or cost',v_count using errcode='22023';
    end;
    if v_catalog_item_id is null or v_uom_id is null or v_quantity is null or v_quantity<=0
       or v_unit_cost is null or v_unit_cost<0 then
      raise exception 'Purchase item % requires product, unit, quantity and non-negative cost',v_count using errcode='22023';
    end if;

    select ci.name,ci.sku,u.uom_name,u.conversion_factor,u.allow_fractional
    into v_product_name,v_sku,v_selected_uom,v_conversion_factor,v_allow_fractional
    from public.catalog_items ci
    join public.catalog_item_uoms u
      on u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id
    where ci.tenant_id=p_tenant_id and ci.id=v_catalog_item_id and ci.is_active=true and u.id=v_uom_id;
    if not found then raise exception 'Purchase item % uses an unavailable product unit',v_count using errcode='23514'; end if;
    if not v_allow_fractional and v_quantity<>trunc(v_quantity) then
      raise exception 'Purchase item % unit does not allow fractional quantity',v_count using errcode='23514';
    end if;

    v_stock_quantity := round((v_quantity*v_conversion_factor)::numeric,6);
    v_line_total := round((v_quantity*v_unit_cost)::numeric,2);
    v_total := v_total + v_line_total;

    insert into public.sellertray_purchase_order_items(
      tenant_id,purchase_order_id,catalog_item_id,uom_id,product_name,sku,selected_uom,
      conversion_factor,ordered_quantity,ordered_stock_quantity,unit_cost,line_total
    ) values(
      p_tenant_id,v_po.id,v_catalog_item_id,v_uom_id,v_product_name,v_sku,v_selected_uom,
      v_conversion_factor,v_quantity,v_stock_quantity,v_unit_cost,v_line_total
    );
  end loop;

  update public.sellertray_purchase_orders
  set total_amount=round(v_total,2),updated_at=now()
  where tenant_id=p_tenant_id and id=v_po.id
  returning * into v_po;

  return jsonb_build_object(
    'purchaseOrderId',v_po.id,'reference',v_po.reference,'status',v_po.status,
    'currency',v_po.currency,'itemCount',v_count,'totalAmount',v_po.total_amount
  );
end;
$$;

revoke all on function public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,text,date,text,jsonb)
  from public,anon;
grant execute on function public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,text,date,text,jsonb)
  to authenticated;

create or replace function public.place_sellertray_purchase_order(
  p_tenant_id uuid,
  p_purchase_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_user_id uuid := auth.uid(); v_po public.sellertray_purchase_orders%rowtype;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Owner or Manager access is required to place purchase orders' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  select * into v_po from public.sellertray_purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;
  if v_po.status='ordered' then return jsonb_build_object('purchaseOrderId',v_po.id,'reference',v_po.reference,'status',v_po.status,'idempotentReplay',true); end if;
  if v_po.status<>'draft' then raise exception 'Only a draft purchase order can be placed' using errcode='23514'; end if;
  if not exists(select 1 from public.sellertray_purchase_order_items i where i.tenant_id=p_tenant_id and i.purchase_order_id=v_po.id) then
    raise exception 'Purchase order has no items' using errcode='23514';
  end if;
  if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=v_po.branch_id and b.is_active=true) then
    raise exception 'Purchase Order Branch is unavailable' using errcode='23514';
  end if;
  if not exists(select 1 from public.sellertray_suppliers s where s.tenant_id=p_tenant_id and s.id=v_po.supplier_id and s.is_active=true) then
    raise exception 'Purchase Order supplier is unavailable' using errcode='23514';
  end if;
  update public.sellertray_purchase_orders
  set status='ordered',ordered_by=v_user_id,ordered_at=now(),updated_at=now()
  where tenant_id=p_tenant_id and id=v_po.id returning * into v_po;
  return jsonb_build_object('purchaseOrderId',v_po.id,'reference',v_po.reference,'status',v_po.status,'idempotentReplay',false);
end;
$$;

revoke all on function public.place_sellertray_purchase_order(uuid,uuid) from public,anon;
grant execute on function public.place_sellertray_purchase_order(uuid,uuid) to authenticated;

create or replace function public.cancel_sellertray_purchase_order(
  p_tenant_id uuid,
  p_purchase_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_user_id uuid := auth.uid(); v_po public.sellertray_purchase_orders%rowtype; v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'Owner or Manager access is required to cancel purchase orders' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if v_reason is null then raise exception 'Cancellation reason is required' using errcode='22023'; end if;
  select * into v_po from public.sellertray_purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found' using errcode='P0002'; end if;
  if v_po.status='cancelled' then return jsonb_build_object('purchaseOrderId',v_po.id,'status',v_po.status,'idempotentReplay',true); end if;
  if v_po.status not in ('draft','ordered') then
    raise exception 'A purchase order with received stock cannot be cancelled here' using errcode='23514';
  end if;
  if exists(select 1 from public.sellertray_purchase_receipts r where r.tenant_id=p_tenant_id and r.purchase_order_id=v_po.id) then
    raise exception 'A purchase order with receipts cannot be cancelled here' using errcode='23514';
  end if;
  update public.sellertray_purchase_orders
  set status='cancelled',cancelled_by=v_user_id,cancelled_at=now(),cancel_reason=v_reason,updated_at=now()
  where tenant_id=p_tenant_id and id=v_po.id returning * into v_po;
  return jsonb_build_object('purchaseOrderId',v_po.id,'status',v_po.status,'idempotentReplay',false);
end;
$$;

revoke all on function public.cancel_sellertray_purchase_order(uuid,uuid,text) from public,anon;
grant execute on function public.cancel_sellertray_purchase_order(uuid,uuid,text) to authenticated;

create or replace function public.get_sellertray_purchase_orders(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_limit integer default 100
)
returns table(
  id uuid,
  reference text,
  status text,
  branch_id uuid,
  branch_name text,
  supplier_id uuid,
  supplier_name text,
  currency text,
  total_amount numeric,
  item_count bigint,
  expected_date date,
  created_at timestamptz,
  ordered_at timestamptz,
  received_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_user_id uuid := auth.uid(); v_role text;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null then raise exception 'SellerTray business membership required' using errcode='42501'; end if;
  if p_branch_id is not null and not public.sellertray_user_can_access_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'SellerTray Branch access required' using errcode='42501';
  end if;
  if v_role='staff' and not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_receive_stock') then
    raise exception 'You do not have permission to receive stock' using errcode='42501';
  end if;

  return query
  select po.id,po.reference,po.status,po.branch_id,b.name,po.supplier_id,s.name,po.currency,po.total_amount,
         count(i.id),po.expected_date,po.created_at,po.ordered_at,po.received_at
  from public.sellertray_purchase_orders po
  join public.branches b on b.tenant_id=po.tenant_id and b.id=po.branch_id
  join public.sellertray_suppliers s on s.tenant_id=po.tenant_id and s.id=po.supplier_id
  left join public.sellertray_purchase_order_items i on i.tenant_id=po.tenant_id and i.purchase_order_id=po.id
  where po.tenant_id=p_tenant_id
    and (p_branch_id is null or po.branch_id=p_branch_id)
    and (v_role in ('owner','manager') or (po.status in ('ordered','partially_received') and public.sellertray_user_can_access_branch(p_tenant_id,po.branch_id,v_user_id)))
  group by po.id,b.name,s.name
  order by po.created_at desc,po.id desc
  limit greatest(1,least(coalesce(p_limit,100),500));
end;
$$;

revoke all on function public.get_sellertray_purchase_orders(uuid,uuid,integer) from public,anon;
grant execute on function public.get_sellertray_purchase_orders(uuid,uuid,integer) to authenticated;

commit;
