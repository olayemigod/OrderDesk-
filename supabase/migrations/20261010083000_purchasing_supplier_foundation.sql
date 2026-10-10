begin;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (nullif(btrim(name),'') is not null),
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id)
);

create unique index suppliers_tenant_name_uidx
  on public.suppliers(tenant_id,lower(btrim(name)));
create index suppliers_tenant_active_name_idx
  on public.suppliers(tenant_id,is_active,name);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  supplier_id uuid not null,
  purchase_number text not null check (nullif(btrim(purchase_number),'') is not null),
  status text not null default 'draft'
    check (status in ('draft','ordered','partially_received','received','cancelled')),
  order_date date not null default current_date,
  expected_date date,
  currency text not null default 'NGN' check (char_length(btrim(currency))=3),
  total_amount numeric(18,2) not null default 0 check (total_amount>=0),
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  submitted_by_user_id uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  cancelled_by_user_id uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint purchase_orders_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict,
  constraint purchase_orders_supplier_same_tenant
    foreign key (tenant_id,supplier_id)
    references public.suppliers(tenant_id,id)
    on delete restrict,
  constraint purchase_orders_dates_check
    check (expected_date is null or expected_date>=order_date)
);

create unique index purchase_orders_tenant_number_uidx
  on public.purchase_orders(tenant_id,lower(btrim(purchase_number)));
create index purchase_orders_tenant_branch_status_date_idx
  on public.purchase_orders(tenant_id,branch_id,status,order_date desc,created_at desc);
create index purchase_orders_supplier_status_idx
  on public.purchase_orders(tenant_id,supplier_id,status,order_date desc);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  purchase_order_id uuid not null,
  catalog_item_id uuid not null,
  uom_id uuid not null,
  product_name_snapshot text not null,
  source_uom text not null check (nullif(btrim(source_uom),'') is not null),
  stock_uom text not null check (nullif(btrim(stock_uom),'') is not null),
  conversion_factor numeric(18,6) not null check (conversion_factor>0),
  allow_fractional boolean not null,
  quantity_ordered numeric(18,6) not null check (quantity_ordered>0),
  stock_quantity_ordered numeric(18,6) not null check (stock_quantity_ordered>0),
  unit_cost numeric(18,2) not null check (unit_cost>=0),
  line_total numeric(18,2) not null check (line_total>=0),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint purchase_order_items_order_same_tenant
    foreign key (tenant_id,purchase_order_id)
    references public.purchase_orders(tenant_id,id)
    on delete cascade,
  constraint purchase_order_items_product_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete restrict,
  constraint purchase_order_items_uom_same_tenant
    foreign key (tenant_id,uom_id)
    references public.catalog_item_uoms(tenant_id,id)
    on delete restrict,
  constraint purchase_order_items_stock_quantity_check
    check (round(stock_quantity_ordered::numeric,6)=round((quantity_ordered*conversion_factor)::numeric,6))
);

create index purchase_order_items_order_idx
  on public.purchase_order_items(tenant_id,purchase_order_id,created_at,id);
create index purchase_order_items_product_uom_idx
  on public.purchase_order_items(tenant_id,catalog_item_id,uom_id);

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  purchase_order_id uuid not null,
  branch_id uuid not null,
  supplier_id uuid not null,
  reference text not null check (nullif(btrim(reference),'') is not null),
  notes text,
  received_by_user_id uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint purchase_receipts_order_same_tenant
    foreign key (tenant_id,purchase_order_id)
    references public.purchase_orders(tenant_id,id)
    on delete restrict,
  constraint purchase_receipts_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict,
  constraint purchase_receipts_supplier_same_tenant
    foreign key (tenant_id,supplier_id)
    references public.suppliers(tenant_id,id)
    on delete restrict
);

create unique index purchase_receipts_order_reference_uidx
  on public.purchase_receipts(tenant_id,purchase_order_id,lower(btrim(reference)));
create index purchase_receipts_order_time_idx
  on public.purchase_receipts(tenant_id,purchase_order_id,received_at desc,created_at desc);

create table public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  purchase_receipt_id uuid not null,
  purchase_order_item_id uuid not null,
  catalog_item_id uuid not null,
  source_uom text not null,
  source_quantity numeric(18,6) not null check (source_quantity>0),
  conversion_factor numeric(18,6) not null check (conversion_factor>0),
  stock_uom text not null,
  stock_quantity numeric(18,6) not null check (stock_quantity>0),
  unit_cost_snapshot numeric(18,2) not null check (unit_cost_snapshot>=0),
  inventory_movement_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,purchase_receipt_id,purchase_order_item_id),
  constraint purchase_receipt_items_receipt_same_tenant
    foreign key (tenant_id,purchase_receipt_id)
    references public.purchase_receipts(tenant_id,id)
    on delete cascade,
  constraint purchase_receipt_items_order_item_same_tenant
    foreign key (tenant_id,purchase_order_item_id)
    references public.purchase_order_items(tenant_id,id)
    on delete restrict,
  constraint purchase_receipt_items_product_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete restrict,
  constraint purchase_receipt_items_movement_same_tenant
    foreign key (tenant_id,inventory_movement_id)
    references public.inventory_movements(tenant_id,id)
    on delete restrict,
  constraint purchase_receipt_items_conversion_check
    check (round(stock_quantity::numeric,6)=round((source_quantity*conversion_factor)::numeric,6))
);

create index purchase_receipt_items_order_item_idx
  on public.purchase_receipt_items(tenant_id,purchase_order_item_id,created_at);

alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_items enable row level security;

revoke all on table public.suppliers from public,anon,authenticated;
revoke all on table public.purchase_orders from public,anon,authenticated;
revoke all on table public.purchase_order_items from public,anon,authenticated;
revoke all on table public.purchase_receipts from public,anon,authenticated;
revoke all on table public.purchase_receipt_items from public,anon,authenticated;
grant all on table public.suppliers to service_role;
grant all on table public.purchase_orders to service_role;
grant all on table public.purchase_order_items to service_role;
grant all on table public.purchase_receipts to service_role;
grant all on table public.purchase_receipt_items to service_role;

create or replace function public.sellertray_user_can_manage_purchasing(
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=p_user_id
      and tm.role in ('owner','manager')
  );
$$;

revoke all on function public.sellertray_user_can_manage_purchasing(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_manage_purchasing(uuid,uuid)
  to service_role;

create or replace function public.get_sellertray_suppliers(p_tenant_id uuid)
returns table(
  id uuid,
  name text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can view Suppliers' using errcode='42501';
  end if;

  return query
  select s.id,s.name,s.phone,s.email,s.address,s.notes,s.is_active,s.created_at,s.updated_at
  from public.suppliers s
  where s.tenant_id=p_tenant_id
  order by s.is_active desc,lower(s.name),s.created_at;
end;
$$;

revoke all on function public.get_sellertray_suppliers(uuid) from public,anon;
grant execute on function public.get_sellertray_suppliers(uuid) to authenticated;

create or replace function public.save_sellertray_supplier(
  p_tenant_id uuid,
  p_supplier_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_notes text,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_supplier_id uuid := p_supplier_id;
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_phone text := nullif(btrim(coalesce(p_phone,'')),'');
  v_email text := nullif(lower(btrim(coalesce(p_email,''))),'');
  v_address text := nullif(btrim(coalesce(p_address,'')),'');
  v_notes text := nullif(btrim(coalesce(p_notes,'')),'');
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can manage Suppliers' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_name is null or char_length(v_name)>160 then
    raise exception 'Supplier name is required and must be 160 characters or fewer' using errcode='22023';
  end if;
  if char_length(coalesce(v_phone,''))>40 or char_length(coalesce(v_email,''))>320
     or char_length(coalesce(v_address,''))>1000 or char_length(coalesce(v_notes,''))>2000 then
    raise exception 'Supplier details are too long' using errcode='22023';
  end if;
  if v_email is not null and position('@' in v_email)<=1 then
    raise exception 'Enter a valid Supplier email address' using errcode='22023';
  end if;

  if v_supplier_id is null then
    insert into public.suppliers(
      tenant_id,name,phone,email,address,notes,is_active,created_by_user_id,updated_by_user_id
    ) values(
      p_tenant_id,v_name,v_phone,v_email,v_address,v_notes,coalesce(p_is_active,true),v_user_id,v_user_id
    ) returning id into v_supplier_id;
  else
    update public.suppliers s
    set name=v_name,phone=v_phone,email=v_email,address=v_address,notes=v_notes,
        is_active=coalesce(p_is_active,true),updated_by_user_id=v_user_id,updated_at=now()
    where s.tenant_id=p_tenant_id and s.id=v_supplier_id;
    if not found then raise exception 'Supplier not found' using errcode='P0002'; end if;
  end if;

  return v_supplier_id;
end;
$$;

revoke all on function public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,boolean)
  from public,anon;
grant execute on function public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,boolean)
  to authenticated;

create or replace function public.save_sellertray_purchase_order(
  p_tenant_id uuid,
  p_purchase_order_id uuid,
  p_branch_id uuid,
  p_supplier_id uuid,
  p_order_date date,
  p_expected_date date,
  p_notes text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid := p_purchase_order_id;
  v_line jsonb;
  v_product_id uuid;
  v_uom_id uuid;
  v_quantity numeric(18,6);
  v_unit_cost numeric(18,2);
  v_product_name text;
  v_stock_uom text;
  v_uom_name text;
  v_conversion numeric(18,6);
  v_allow_fractional boolean;
  v_line_total numeric(18,2);
  v_total numeric(18,2) := 0;
  v_status text;
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can manage Purchase Orders' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if p_branch_id is null or p_supplier_id is null or p_order_date is null then
    raise exception 'Branch, Supplier and order date are required' using errcode='22023';
  end if;
  if p_expected_date is not null and p_expected_date<p_order_date then
    raise exception 'Expected date cannot be earlier than the order date' using errcode='22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'Add at least one product to the Purchase Order' using errcode='22023';
  end if;
  if jsonb_array_length(p_lines)>200 then
    raise exception 'Purchase Order cannot contain more than 200 lines' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id and b.is_active=true
  ) then
    raise exception 'Selected Branch is unavailable' using errcode='23514';
  end if;
  if not exists(
    select 1 from public.suppliers s
    where s.tenant_id=p_tenant_id and s.id=p_supplier_id and s.is_active=true
  ) then
    raise exception 'Selected Supplier is unavailable' using errcode='23514';
  end if;

  if v_order_id is null then
    insert into public.purchase_orders(
      tenant_id,branch_id,supplier_id,purchase_number,status,order_date,expected_date,currency,total_amount,notes,created_by_user_id
    ) values(
      p_tenant_id,p_branch_id,p_supplier_id,
      'PO-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
      'draft',p_order_date,p_expected_date,'NGN',0,nullif(btrim(coalesce(p_notes,'')),''),v_user_id
    ) returning id into v_order_id;
  else
    select po.status into v_status
    from public.purchase_orders po
    where po.tenant_id=p_tenant_id and po.id=v_order_id
    for update;
    if not found then raise exception 'Purchase Order not found' using errcode='P0002'; end if;
    if v_status<>'draft' then
      raise exception 'Only a draft Purchase Order can be edited' using errcode='23514';
    end if;
    update public.purchase_orders po
    set branch_id=p_branch_id,supplier_id=p_supplier_id,order_date=p_order_date,
        expected_date=p_expected_date,notes=nullif(btrim(coalesce(p_notes,'')),''),updated_at=now()
    where po.tenant_id=p_tenant_id and po.id=v_order_id;
    delete from public.purchase_order_items poi
    where poi.tenant_id=p_tenant_id and poi.purchase_order_id=v_order_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_product_id := nullif(v_line->>'productId','')::uuid;
      v_uom_id := nullif(v_line->>'uomId','')::uuid;
      v_quantity := nullif(v_line->>'quantity','')::numeric;
      v_unit_cost := nullif(v_line->>'unitCost','')::numeric;
    exception when others then
      raise exception 'Each Purchase Order line needs a valid product, unit, quantity and unit cost' using errcode='22023';
    end;

    if v_product_id is null or v_uom_id is null or v_quantity is null or v_quantity<=0
       or v_unit_cost is null or v_unit_cost<0 then
      raise exception 'Each Purchase Order line needs a valid product, unit, quantity and unit cost' using errcode='22023';
    end if;

    select ci.name,ci.stock_uom,u.uom_name,u.conversion_factor,u.allow_fractional
    into v_product_name,v_stock_uom,v_uom_name,v_conversion,v_allow_fractional
    from public.catalog_items ci
    join public.catalog_item_uoms u
      on u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id
    where ci.tenant_id=p_tenant_id and ci.id=v_product_id and ci.is_active=true and u.id=v_uom_id;

    if not found then
      raise exception 'A Purchase Order product or unit is unavailable' using errcode='23514';
    end if;
    if not v_allow_fractional and v_quantity<>trunc(v_quantity) then
      raise exception 'Unit % for % does not allow fractional quantity',v_uom_name,v_product_name using errcode='23514';
    end if;

    v_line_total := round((v_quantity*v_unit_cost)::numeric,2);
    v_total := v_total+v_line_total;

    insert into public.purchase_order_items(
      tenant_id,purchase_order_id,catalog_item_id,uom_id,product_name_snapshot,
      source_uom,stock_uom,conversion_factor,allow_fractional,quantity_ordered,
      stock_quantity_ordered,unit_cost,line_total
    ) values(
      p_tenant_id,v_order_id,v_product_id,v_uom_id,v_product_name,v_uom_name,v_stock_uom,
      v_conversion,v_allow_fractional,v_quantity,round((v_quantity*v_conversion)::numeric,6),
      round(v_unit_cost::numeric,2),v_line_total
    );
  end loop;

  update public.purchase_orders po
  set total_amount=round(v_total::numeric,2),updated_at=now()
  where po.tenant_id=p_tenant_id and po.id=v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,date,date,text,jsonb)
  from public,anon;
grant execute on function public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,date,date,text,jsonb)
  to authenticated;

create or replace function public.submit_sellertray_purchase_order(
  p_tenant_id uuid,
  p_purchase_order_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can submit Purchase Orders' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if exists(
    select 1
    from public.purchase_order_items poi
    left join public.catalog_item_uoms u
      on u.tenant_id=poi.tenant_id and u.id=poi.uom_id and u.catalog_item_id=poi.catalog_item_id
    left join public.catalog_items ci
      on ci.tenant_id=poi.tenant_id and ci.id=poi.catalog_item_id
    where poi.tenant_id=p_tenant_id and poi.purchase_order_id=p_purchase_order_id
      and (
        u.id is null or ci.id is null or ci.is_active=false
        or lower(btrim(u.uom_name))<>lower(btrim(poi.source_uom))
        or u.conversion_factor<>poi.conversion_factor
      )
  ) then
    raise exception 'A product unit changed after this draft was prepared. Re-save the Purchase Order before submitting it.'
      using errcode='23514';
  end if;

  update public.purchase_orders po
  set status='ordered',submitted_by_user_id=v_user_id,submitted_at=now(),updated_at=now()
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id and po.status='draft'
    and exists(
      select 1 from public.purchase_order_items poi
      where poi.tenant_id=po.tenant_id and poi.purchase_order_id=po.id
    );
  if not found then
    raise exception 'Only a non-empty draft Purchase Order can be submitted' using errcode='23514';
  end if;
end;
$$;

revoke all on function public.submit_sellertray_purchase_order(uuid,uuid) from public,anon;
grant execute on function public.submit_sellertray_purchase_order(uuid,uuid) to authenticated;

create or replace function public.cancel_sellertray_purchase_order(
  p_tenant_id uuid,
  p_purchase_order_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can cancel Purchase Orders' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if exists(
    select 1 from public.purchase_receipts pr
    where pr.tenant_id=p_tenant_id and pr.purchase_order_id=p_purchase_order_id
  ) then
    raise exception 'A Purchase Order with received stock cannot be cancelled' using errcode='23514';
  end if;

  update public.purchase_orders po
  set status='cancelled',cancelled_by_user_id=v_user_id,cancelled_at=now(),updated_at=now()
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id and po.status in ('draft','ordered');
  if not found then raise exception 'Purchase Order cannot be cancelled in its current status' using errcode='23514'; end if;
end;
$$;

revoke all on function public.cancel_sellertray_purchase_order(uuid,uuid) from public,anon;
grant execute on function public.cancel_sellertray_purchase_order(uuid,uuid) to authenticated;

create or replace function public.get_sellertray_purchase_orders(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_status text default null
)
returns table(
  id uuid,
  purchase_number text,
  branch_id uuid,
  branch_name text,
  supplier_id uuid,
  supplier_name text,
  status text,
  order_date date,
  expected_date date,
  total_amount numeric,
  received_line_count bigint,
  line_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id) then
    raise exception 'Only business Owners and Managers can view Purchase Orders' using errcode='42501';
  end if;
  if p_branch_id is not null and not public.sellertray_user_can_read_branch_history(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to this Branch history' using errcode='42501';
  end if;

  return query
  select po.id,po.purchase_number,po.branch_id,b.name,po.supplier_id,s.name,po.status,
         po.order_date,po.expected_date,po.total_amount,
         count(distinct pri.purchase_order_item_id) as received_line_count,
         count(distinct poi.id) as line_count,po.created_at,po.updated_at
  from public.purchase_orders po
  join public.branches b on b.tenant_id=po.tenant_id and b.id=po.branch_id
  join public.suppliers s on s.tenant_id=po.tenant_id and s.id=po.supplier_id
  left join public.purchase_order_items poi on poi.tenant_id=po.tenant_id and poi.purchase_order_id=po.id
  left join public.purchase_receipt_items pri on pri.tenant_id=poi.tenant_id and pri.purchase_order_item_id=poi.id
  where po.tenant_id=p_tenant_id
    and (p_branch_id is null or po.branch_id=p_branch_id)
    and (p_status is null or po.status=lower(btrim(p_status)))
  group by po.id,b.name,s.name
  order by po.order_date desc,po.created_at desc;
end;
$$;

revoke all on function public.get_sellertray_purchase_orders(uuid,uuid,text) from public,anon;
grant execute on function public.get_sellertray_purchase_orders(uuid,uuid,text) to authenticated;

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
  v_branch_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  select po.branch_id into v_branch_id
  from public.purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id;
  if v_branch_id is null then raise exception 'Purchase Order not found' using errcode='P0002'; end if;

  if not public.sellertray_user_can_manage_purchasing(p_tenant_id,v_user_id)
     and not (
       public.sellertray_user_can_read_branch_history(p_tenant_id,v_branch_id,v_user_id)
       and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_receive_stock')
     ) then
    raise exception 'You do not have access to this Purchase Order' using errcode='42501';
  end if;

  select jsonb_build_object(
    'id',po.id,'purchaseNumber',po.purchase_number,'branchId',po.branch_id,'branchName',b.name,
    'supplierId',po.supplier_id,'supplierName',s.name,'status',po.status,'orderDate',po.order_date,
    'expectedDate',po.expected_date,'currency',po.currency,'totalAmount',po.total_amount,'notes',po.notes,
    'createdAt',po.created_at,'submittedAt',po.submitted_at,'cancelledAt',po.cancelled_at,
    'lines',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',poi.id,'productId',poi.catalog_item_id,'productName',poi.product_name_snapshot,
        'uomId',poi.uom_id,'uom',poi.source_uom,'stockUom',poi.stock_uom,
        'conversionFactor',poi.conversion_factor,'allowFractional',poi.allow_fractional,
        'quantityOrdered',poi.quantity_ordered,'stockQuantityOrdered',poi.stock_quantity_ordered,
        'unitCost',poi.unit_cost,'lineTotal',poi.line_total,
        'quantityReceived',coalesce((select sum(pri.source_quantity) from public.purchase_receipt_items pri where pri.tenant_id=poi.tenant_id and pri.purchase_order_item_id=poi.id),0)
      ) order by poi.created_at,poi.id)
      from public.purchase_order_items poi
      where poi.tenant_id=po.tenant_id and poi.purchase_order_id=po.id
    ),'[]'::jsonb),
    'receipts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',pr.id,'reference',pr.reference,'notes',pr.notes,'receivedAt',pr.received_at,
        'items',coalesce((
          select jsonb_agg(jsonb_build_object(
            'purchaseOrderItemId',pri.purchase_order_item_id,'productId',pri.catalog_item_id,
            'uom',pri.source_uom,'quantity',pri.source_quantity,'stockUom',pri.stock_uom,
            'stockQuantity',pri.stock_quantity,'unitCost',pri.unit_cost_snapshot,
            'inventoryMovementId',pri.inventory_movement_id
          ) order by pri.created_at,pri.id)
          from public.purchase_receipt_items pri
          where pri.tenant_id=pr.tenant_id and pri.purchase_receipt_id=pr.id
        ),'[]'::jsonb)
      ) order by pr.received_at,pr.created_at)
      from public.purchase_receipts pr
      where pr.tenant_id=po.tenant_id and pr.purchase_order_id=po.id
    ),'[]'::jsonb)
  ) into v_result
  from public.purchase_orders po
  join public.branches b on b.tenant_id=po.tenant_id and b.id=po.branch_id
  join public.suppliers s on s.tenant_id=po.tenant_id and s.id=po.supplier_id
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id;

  return v_result;
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
  v_order public.purchase_orders%rowtype;
  v_receipt_id uuid;
  v_existing_receipt_id uuid;
  v_item jsonb;
  v_line_id uuid;
  v_quantity numeric(18,6);
  v_line public.purchase_order_items%rowtype;
  v_already_received numeric(18,6);
  v_stock_location_id uuid;
  v_movement_id uuid;
  v_status text;
  v_requested_count integer;
  v_existing_count integer;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_reference is null then raise exception 'Supplier receipt or delivery reference is required' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Enter at least one received quantity' using errcode='22023';
  end if;

  select * into v_order
  from public.purchase_orders po
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id
  for update;
  if not found then raise exception 'Purchase Order not found' using errcode='P0002'; end if;
  if v_order.status not in ('ordered','partially_received') then
    raise exception 'Only an ordered Purchase Order can receive stock' using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,v_user_id)
     or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_receive_stock') then
    raise exception 'You do not have permission to receive stock for this Branch' using errcode='42501';
  end if;

  select pr.id into v_existing_receipt_id
  from public.purchase_receipts pr
  where pr.tenant_id=p_tenant_id and pr.purchase_order_id=p_purchase_order_id
    and lower(btrim(pr.reference))=lower(v_reference);

  if v_existing_receipt_id is not null then
    v_requested_count:=jsonb_array_length(p_items);
    select count(*)::integer into v_existing_count
    from public.purchase_receipt_items pri
    where pri.tenant_id=p_tenant_id and pri.purchase_receipt_id=v_existing_receipt_id;
    if v_existing_count<>v_requested_count then
      raise exception 'This receipt reference was already used with different received quantities' using errcode='23505';
    end if;
    for v_item in select value from jsonb_array_elements(p_items)
    loop
      begin
        v_line_id:=nullif(v_item->>'lineId','')::uuid;
        v_quantity:=nullif(v_item->>'quantity','')::numeric;
      exception when others then
        raise exception 'Received quantities are invalid' using errcode='22023';
      end;
      if not exists(
        select 1 from public.purchase_receipt_items pri
        where pri.tenant_id=p_tenant_id and pri.purchase_receipt_id=v_existing_receipt_id
          and pri.purchase_order_item_id=v_line_id and pri.source_quantity=v_quantity
      ) then
        raise exception 'This receipt reference was already used with different received quantities' using errcode='23505';
      end if;
    end loop;
    return jsonb_build_object('receiptId',v_existing_receipt_id,'purchaseOrderId',p_purchase_order_id,'idempotentReplay',true);
  end if;

  select sl.id into v_stock_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id and sl.branch_id=v_order.branch_id
    and sl.is_default=true and sl.is_active=true
  order by sl.created_at,sl.id limit 1;
  if v_stock_location_id is null then
    raise exception 'This Branch has no active default stock location' using errcode='23514';
  end if;

  insert into public.purchase_receipts(
    tenant_id,purchase_order_id,branch_id,supplier_id,reference,notes,received_by_user_id
  ) values(
    p_tenant_id,p_purchase_order_id,v_order.branch_id,v_order.supplier_id,v_reference,
    nullif(btrim(coalesce(p_notes,'')),''),v_user_id
  ) returning id into v_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_line_id:=nullif(v_item->>'lineId','')::uuid;
      v_quantity:=nullif(v_item->>'quantity','')::numeric;
    exception when others then
      raise exception 'Received quantities are invalid' using errcode='22023';
    end;
    if v_line_id is null or v_quantity is null or v_quantity<=0 then
      raise exception 'Each received line needs a positive quantity' using errcode='22023';
    end if;

    select * into v_line
    from public.purchase_order_items poi
    where poi.tenant_id=p_tenant_id and poi.purchase_order_id=p_purchase_order_id and poi.id=v_line_id
    for update;
    if not found then raise exception 'Purchase Order line not found' using errcode='P0002'; end if;
    if not v_line.allow_fractional and v_quantity<>trunc(v_quantity) then
      raise exception 'Unit % does not allow fractional quantity',v_line.source_uom using errcode='23514';
    end if;

    select coalesce(sum(pri.source_quantity),0)::numeric(18,6) into v_already_received
    from public.purchase_receipt_items pri
    join public.purchase_receipts pr
      on pr.tenant_id=pri.tenant_id and pr.id=pri.purchase_receipt_id
    where pri.tenant_id=p_tenant_id and pri.purchase_order_item_id=v_line_id;

    if v_already_received+v_quantity>v_line.quantity_ordered then
      raise exception 'Received quantity for % exceeds the remaining Purchase Order quantity',v_line.product_name_snapshot using errcode='23514';
    end if;

    if not exists(
      select 1 from public.catalog_item_uoms u
      where u.tenant_id=p_tenant_id and u.id=v_line.uom_id and u.catalog_item_id=v_line.catalog_item_id
        and lower(btrim(u.uom_name))=lower(btrim(v_line.source_uom))
        and u.conversion_factor=v_line.conversion_factor
    ) then
      raise exception 'Purchase unit configuration changed before receipt; resolve the Purchase Order before receiving stock' using errcode='23514';
    end if;

    v_movement_id:=public.record_sellertray_inventory_movement(
      p_tenant_id,v_order.branch_id,v_stock_location_id,v_line.catalog_item_id,'purchase_receipt',
      round((v_quantity*v_line.conversion_factor)::numeric,6),v_line.source_uom,v_quantity,
      v_line.conversion_factor,'purchase_receipt',v_receipt_id::text,
      'purchase_receipt:'||v_receipt_id::text||':'||v_line.id::text,now(),v_user_id,
      'Purchase receipt '||v_reference,
      jsonb_build_object('purchaseOrderId',p_purchase_order_id,'purchaseOrderItemId',v_line.id,'supplierId',v_order.supplier_id,'reference',v_reference),
      null
    );

    insert into public.purchase_receipt_items(
      tenant_id,purchase_receipt_id,purchase_order_item_id,catalog_item_id,source_uom,
      source_quantity,conversion_factor,stock_uom,stock_quantity,unit_cost_snapshot,inventory_movement_id
    ) values(
      p_tenant_id,v_receipt_id,v_line.id,v_line.catalog_item_id,v_line.source_uom,v_quantity,
      v_line.conversion_factor,v_line.stock_uom,round((v_quantity*v_line.conversion_factor)::numeric,6),
      v_line.unit_cost,v_movement_id
    );
  end loop;

  if not exists(
    select 1
    from public.purchase_order_items poi
    where poi.tenant_id=p_tenant_id and poi.purchase_order_id=p_purchase_order_id
      and coalesce((
        select sum(pri.source_quantity)
        from public.purchase_receipt_items pri
        where pri.tenant_id=poi.tenant_id and pri.purchase_order_item_id=poi.id
      ),0)<poi.quantity_ordered
  ) then
    v_status:='received';
  else
    v_status:='partially_received';
  end if;

  update public.purchase_orders po
  set status=v_status,updated_at=now()
  where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id;

  return jsonb_build_object(
    'receiptId',v_receipt_id,'purchaseOrderId',p_purchase_order_id,'status',v_status,
    'branchId',v_order.branch_id,'supplierId',v_order.supplier_id,'reference',v_reference,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.receive_sellertray_purchase_order(uuid,uuid,text,text,jsonb) to authenticated;

create or replace function public.prevent_open_purchase_uom_redefinition()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='UPDATE'
     and new.uom_name is not distinct from old.uom_name
     and new.conversion_factor is not distinct from old.conversion_factor then
    return new;
  end if;

  if exists(
    select 1
    from public.purchase_order_items poi
    join public.purchase_orders po
      on po.tenant_id=poi.tenant_id and po.id=poi.purchase_order_id
    where poi.tenant_id=old.tenant_id and poi.uom_id=old.id
      and po.status in ('ordered','partially_received')
  ) then
    raise exception 'This unit is used by an open Purchase Order. Receive or cancel that order before changing its unit name or conversion.'
      using errcode='23514';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.prevent_open_purchase_uom_redefinition() from public,anon,authenticated;

drop trigger if exists prevent_open_purchase_uom_redefinition on public.catalog_item_uoms;
create trigger prevent_open_purchase_uom_redefinition
before update of uom_name,conversion_factor or delete on public.catalog_item_uoms
for each row execute function public.prevent_open_purchase_uom_redefinition();

create or replace function public.prevent_purchase_receipt_history_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Purchase receipt history is immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_purchase_receipt_history_mutation() from public,anon,authenticated;

drop trigger if exists prevent_purchase_receipt_update on public.purchase_receipts;
create trigger prevent_purchase_receipt_update before update on public.purchase_receipts
for each row execute function public.prevent_purchase_receipt_history_mutation();
drop trigger if exists prevent_purchase_receipt_delete on public.purchase_receipts;
create trigger prevent_purchase_receipt_delete before delete on public.purchase_receipts
for each row execute function public.prevent_purchase_receipt_history_mutation();
drop trigger if exists prevent_purchase_receipt_item_update on public.purchase_receipt_items;
create trigger prevent_purchase_receipt_item_update before update on public.purchase_receipt_items
for each row execute function public.prevent_purchase_receipt_history_mutation();
drop trigger if exists prevent_purchase_receipt_item_delete on public.purchase_receipt_items;
create trigger prevent_purchase_receipt_item_delete before delete on public.purchase_receipt_items
for each row execute function public.prevent_purchase_receipt_history_mutation();

commit;