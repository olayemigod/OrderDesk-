begin;

-- SellerTray purchasing stays bounded to supplier/order/receiving inventory.
-- Accounts payable and supplier accounting are intentionally not created here.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (nullif(btrim(name),'') is not null),
  contact_name text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id)
);

create unique index suppliers_tenant_name_unique
  on public.suppliers(tenant_id,lower(btrim(name)));
create index suppliers_tenant_active_name_idx
  on public.suppliers(tenant_id,is_active,name);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  supplier_id uuid not null,
  purchase_order_number text not null default ('PO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  status text not null default 'draft'
    check (status in ('draft','ordered','partially_received','received','cancelled')),
  currency text not null check (char_length(currency)=3),
  expected_date date,
  notes text,
  total_amount numeric(14,2) not null default 0 check (total_amount>=0),
  created_by_user_id uuid references auth.users(id) on delete set null,
  ordered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,purchase_order_number),
  constraint purchase_orders_branch_same_tenant
    foreign key (tenant_id,branch_id) references public.branches(tenant_id,id) on delete cascade,
  constraint purchase_orders_supplier_same_tenant
    foreign key (tenant_id,supplier_id) references public.suppliers(tenant_id,id) on delete cascade
);

create index purchase_orders_tenant_branch_created_idx on public.purchase_orders(tenant_id,branch_id,created_at desc);
create index purchase_orders_tenant_supplier_created_idx on public.purchase_orders(tenant_id,supplier_id,created_at desc);
create index purchase_orders_tenant_status_created_idx on public.purchase_orders(tenant_id,status,created_at desc);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  purchase_order_id uuid not null,
  catalog_item_id uuid not null,
  item_name text not null check (nullif(btrim(item_name),'') is not null),
  sku text,
  purchase_uom_id uuid,
  purchase_uom text not null check (nullif(btrim(purchase_uom),'') is not null),
  quantity_ordered numeric(18,6) not null check (quantity_ordered>0),
  conversion_factor numeric(18,6) not null check (conversion_factor>0),
  stock_uom text not null check (nullif(btrim(stock_uom),'') is not null),
  stock_quantity_ordered numeric(18,6) not null check (stock_quantity_ordered>0),
  allow_fractional boolean not null,
  unit_cost numeric(14,2) not null check (unit_cost>=0),
  line_total numeric(14,2) not null check (line_total>=0),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint purchase_order_items_order_same_tenant
    foreign key (tenant_id,purchase_order_id) references public.purchase_orders(tenant_id,id) on delete cascade
);

create index purchase_order_items_order_idx on public.purchase_order_items(tenant_id,purchase_order_id,id);
create index purchase_order_items_catalog_idx on public.purchase_order_items(tenant_id,catalog_item_id);

alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
revoke all on table public.suppliers from public,anon,authenticated;
revoke all on table public.purchase_orders from public,anon,authenticated;
revoke all on table public.purchase_order_items from public,anon,authenticated;
grant select on table public.suppliers to authenticated;
grant select on table public.purchase_orders to authenticated;
grant select on table public.purchase_order_items to authenticated;
grant all on table public.suppliers to service_role;
grant all on table public.purchase_orders to service_role;
grant all on table public.purchase_order_items to service_role;

create policy suppliers_select_management on public.suppliers
for select to authenticated using (exists (
  select 1 from public.tenant_members tm where tm.tenant_id=suppliers.tenant_id
    and tm.user_id=(select auth.uid()) and tm.role in ('owner','manager')
));
create policy purchase_orders_select_management on public.purchase_orders
for select to authenticated using (exists (
  select 1 from public.tenant_members tm where tm.tenant_id=purchase_orders.tenant_id
    and tm.user_id=(select auth.uid()) and tm.role in ('owner','manager')
));
create policy purchase_order_items_select_management on public.purchase_order_items
for select to authenticated using (exists (
  select 1 from public.tenant_members tm where tm.tenant_id=purchase_order_items.tenant_id
    and tm.user_id=(select auth.uid()) and tm.role in ('owner','manager')
));

create or replace function public.sellertray_require_purchasing_management(p_tenant_id uuid,p_require_write boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid(); v_role text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tm.role into v_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') then raise exception 'Only business management can use Purchasing' using errcode='42501'; end if;
  if p_require_write and not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  return v_role;
end; $$;
revoke all on function public.sellertray_require_purchasing_management(uuid,boolean) from public,anon,authenticated;
grant execute on function public.sellertray_require_purchasing_management(uuid,boolean) to service_role;

create or replace function public.get_sellertray_suppliers(p_tenant_id uuid,p_include_inactive boolean default true)
returns table(id uuid,name text,contact_name text,phone text,email text,address text,notes text,is_active boolean,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.sellertray_require_purchasing_management(p_tenant_id,false);
  return query select s.id,s.name,s.contact_name,s.phone,s.email,s.address,s.notes,s.is_active,s.created_at,s.updated_at
  from public.suppliers s where s.tenant_id=p_tenant_id and (coalesce(p_include_inactive,true) or s.is_active)
  order by s.is_active desc,lower(s.name),s.created_at;
end; $$;

create or replace function public.save_sellertray_supplier(
  p_tenant_id uuid,p_supplier_id uuid,p_name text,p_contact_name text default null,
  p_phone text default null,p_email text default null,p_address text default null,p_notes text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text:=nullif(btrim(coalesce(p_name,'')),''); v_email text:=nullif(lower(btrim(coalesce(p_email,''))),'');
begin
  perform public.sellertray_require_purchasing_management(p_tenant_id,true);
  if v_name is null then raise exception 'Supplier name is required' using errcode='22023'; end if;
  if v_email is not null and position('@' in v_email)<=1 then raise exception 'Enter a valid supplier email address' using errcode='22023'; end if;
  if p_supplier_id is null then
    insert into public.suppliers(tenant_id,name,contact_name,phone,email,address,notes)
    values(p_tenant_id,v_name,nullif(btrim(coalesce(p_contact_name,'')),''),nullif(btrim(coalesce(p_phone,'')),''),v_email,
      nullif(btrim(coalesce(p_address,'')),''),nullif(btrim(coalesce(p_notes,'')),'')) returning id into v_id;
  else
    update public.suppliers s set name=v_name,contact_name=nullif(btrim(coalesce(p_contact_name,'')),''),
      phone=nullif(btrim(coalesce(p_phone,'')),''),email=v_email,address=nullif(btrim(coalesce(p_address,'')),''),
      notes=nullif(btrim(coalesce(p_notes,'')),''),updated_at=now()
    where s.tenant_id=p_tenant_id and s.id=p_supplier_id returning s.id into v_id;
    if v_id is null then raise exception 'Supplier not found' using errcode='P0002'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.set_sellertray_supplier_active(p_tenant_id uuid,p_supplier_id uuid,p_active boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.sellertray_require_purchasing_management(p_tenant_id,true);
  if p_active is null then raise exception 'Supplier status is required' using errcode='22023'; end if;
  update public.suppliers s set is_active=p_active,updated_at=now() where s.tenant_id=p_tenant_id and s.id=p_supplier_id;
  if not found then raise exception 'Supplier not found' using errcode='P0002'; end if;
  return p_active;
end; $$;

create or replace function public.get_sellertray_purchase_orders(p_tenant_id uuid,p_branch_id uuid default null,p_limit integer default 100)
returns table(id uuid,purchase_order_number text,branch_id uuid,branch_name text,supplier_id uuid,supplier_name text,status text,currency text,expected_date date,total_amount numeric,ordered_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.sellertray_require_purchasing_management(p_tenant_id,false);
  return query select po.id,po.purchase_order_number,po.branch_id,b.name,po.supplier_id,s.name,po.status,po.currency,
    po.expected_date,po.total_amount,po.ordered_at,po.created_at
  from public.purchase_orders po join public.branches b on b.tenant_id=po.tenant_id and b.id=po.branch_id
  join public.suppliers s on s.tenant_id=po.tenant_id and s.id=po.supplier_id
  where po.tenant_id=p_tenant_id and (p_branch_id is null or po.branch_id=p_branch_id)
  order by po.created_at desc,po.id desc limit greatest(1,least(coalesce(p_limit,100),500));
end; $$;

create or replace function public.save_sellertray_purchase_order(
  p_tenant_id uuid,p_purchase_order_id uuid,p_branch_id uuid,p_supplier_id uuid,
  p_expected_date date,p_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid(); v_order_id uuid; v_currency text; v_status text; v_item jsonb;
  v_catalog_item_id uuid; v_uom_id uuid; v_quantity numeric; v_unit_cost numeric;
  v_item_name text; v_sku text; v_stock_uom text; v_uom_name text; v_conversion numeric; v_fractional boolean;
  v_total numeric(14,2):=0; v_line_total numeric(14,2);
begin
  perform public.sellertray_require_purchasing_management(p_tenant_id,true);
  if p_branch_id is null or p_supplier_id is null then raise exception 'Branch and Supplier are required' using errcode='22023'; end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'Selected Branch is unavailable for purchasing' using errcode='42501';
  end if;
  if not exists(select 1 from public.suppliers s where s.tenant_id=p_tenant_id and s.id=p_supplier_id and s.is_active) then
    raise exception 'Select an active Supplier' using errcode='23514';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Add at least one product to the Purchase Order' using errcode='22023';
  end if;
  select t.currency into v_currency from public.tenants t where t.id=p_tenant_id;
  if v_currency is null then raise exception 'Business not found' using errcode='P0002'; end if;

  if p_purchase_order_id is null then
    insert into public.purchase_orders(tenant_id,branch_id,supplier_id,currency,expected_date,notes,created_by_user_id)
    values(p_tenant_id,p_branch_id,p_supplier_id,v_currency,p_expected_date,nullif(btrim(coalesce(p_notes,'')),''),v_user_id)
    returning id into v_order_id;
  else
    select po.status into v_status from public.purchase_orders po
    where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id for update;
    if v_status is null then raise exception 'Purchase Order not found' using errcode='P0002'; end if;
    if v_status<>'draft' then raise exception 'Only a Draft Purchase Order can be edited' using errcode='23514'; end if;
    v_order_id:=p_purchase_order_id;
    update public.purchase_orders po set branch_id=p_branch_id,supplier_id=p_supplier_id,expected_date=p_expected_date,
      notes=nullif(btrim(coalesce(p_notes,'')),''),updated_at=now()
    where po.tenant_id=p_tenant_id and po.id=v_order_id;
    delete from public.purchase_order_items poi where poi.tenant_id=p_tenant_id and poi.purchase_order_id=v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_catalog_item_id:=nullif(v_item->>'catalogItemId','')::uuid;
      v_uom_id:=nullif(v_item->>'uomId','')::uuid;
      v_quantity:=(v_item->>'quantity')::numeric;
      v_unit_cost:=(v_item->>'unitCost')::numeric;
    exception when others then
      raise exception 'Each purchase line needs a valid Product, Unit, Quantity and Unit cost' using errcode='22023';
    end;
    if v_catalog_item_id is null or v_uom_id is null or v_quantity is null or v_quantity<=0 or v_unit_cost is null or v_unit_cost<0 then
      raise exception 'Each purchase line needs a valid Product, Unit, Quantity and Unit cost' using errcode='22023';
    end if;
    select ci.name,ci.sku,ci.stock_uom,u.uom_name,u.conversion_factor,u.allow_fractional
    into v_item_name,v_sku,v_stock_uom,v_uom_name,v_conversion,v_fractional
    from public.catalog_items ci join public.catalog_item_uoms u
      on u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id
    where ci.tenant_id=p_tenant_id and ci.id=v_catalog_item_id and ci.is_active and u.id=v_uom_id;
    if not found then raise exception 'A selected Product or Purchase Unit is unavailable' using errcode='23514'; end if;
    if not v_fractional and v_quantity<>trunc(v_quantity) then
      raise exception 'The selected Purchase Unit does not allow fractional quantity' using errcode='23514';
    end if;
    v_line_total:=round((v_quantity*v_unit_cost)::numeric,2); v_total:=v_total+v_line_total;
    insert into public.purchase_order_items(tenant_id,purchase_order_id,catalog_item_id,item_name,sku,purchase_uom_id,
      purchase_uom,quantity_ordered,conversion_factor,stock_uom,stock_quantity_ordered,allow_fractional,unit_cost,line_total)
    values(p_tenant_id,v_order_id,v_catalog_item_id,v_item_name,v_sku,v_uom_id,v_uom_name,round(v_quantity,6),v_conversion,
      v_stock_uom,round((v_quantity*v_conversion)::numeric,6),v_fractional,v_unit_cost,v_line_total);
  end loop;
  update public.purchase_orders po set total_amount=v_total,updated_at=now()
  where po.tenant_id=p_tenant_id and po.id=v_order_id;
  return v_order_id;
end; $$;

create or replace function public.submit_sellertray_purchase_order(p_tenant_id uuid,p_purchase_order_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid(); v_order public.purchase_orders%rowtype;
begin
  perform public.sellertray_require_purchasing_management(p_tenant_id,true);
  select * into v_order from public.purchase_orders po where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase Order not found' using errcode='P0002'; end if;
  if v_order.status<>'draft' then raise exception 'Only a Draft Purchase Order can be placed' using errcode='23514'; end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,v_user_id) then
    raise exception 'Purchase Order Branch is unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.suppliers s where s.tenant_id=p_tenant_id and s.id=v_order.supplier_id and s.is_active) then
    raise exception 'Supplier must be active before placing this Purchase Order' using errcode='23514';
  end if;
  update public.purchase_orders po set status='ordered',ordered_at=now(),updated_at=now()
  where po.tenant_id=p_tenant_id and po.id=v_order.id;
  return 'ordered';
end; $$;

create or replace function public.cancel_sellertray_purchase_order(p_tenant_id uuid,p_purchase_order_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_order public.purchase_orders%rowtype;
begin
  perform public.sellertray_require_purchasing_management(p_tenant_id,true);
  select * into v_order from public.purchase_orders po where po.tenant_id=p_tenant_id and po.id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase Order not found' using errcode='P0002'; end if;
  if v_order.status in ('received','cancelled') then raise exception 'This Purchase Order cannot be cancelled' using errcode='23514'; end if;
  update public.purchase_orders po set status='cancelled',cancelled_at=now(),updated_at=now()
  where po.tenant_id=p_tenant_id and po.id=v_order.id;
  return 'cancelled';
end; $$;

create or replace function public.prevent_sellertray_supplier_delete()
returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then return old; end if;
  raise exception 'Deactivate a Supplier instead of deleting purchasing history' using errcode='55000';
end; $$;
revoke all on function public.prevent_sellertray_supplier_delete() from public,anon,authenticated;
drop trigger if exists prevent_sellertray_supplier_delete on public.suppliers;
create trigger prevent_sellertray_supplier_delete before delete on public.suppliers
for each row execute function public.prevent_sellertray_supplier_delete();

revoke all on function public.get_sellertray_suppliers(uuid,boolean) from public,anon;
revoke all on function public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,text) from public,anon;
revoke all on function public.set_sellertray_supplier_active(uuid,uuid,boolean) from public,anon;
revoke all on function public.get_sellertray_purchase_orders(uuid,uuid,integer) from public,anon;
revoke all on function public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,date,text,jsonb) from public,anon;
revoke all on function public.submit_sellertray_purchase_order(uuid,uuid) from public,anon;
revoke all on function public.cancel_sellertray_purchase_order(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_suppliers(uuid,boolean) to authenticated,service_role;
grant execute on function public.save_sellertray_supplier(uuid,uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.set_sellertray_supplier_active(uuid,uuid,boolean) to authenticated;
grant execute on function public.get_sellertray_purchase_orders(uuid,uuid,integer) to authenticated,service_role;
grant execute on function public.save_sellertray_purchase_order(uuid,uuid,uuid,uuid,date,text,jsonb) to authenticated;
grant execute on function public.submit_sellertray_purchase_order(uuid,uuid) to authenticated;
grant execute on function public.cancel_sellertray_purchase_order(uuid,uuid) to authenticated;

commit;