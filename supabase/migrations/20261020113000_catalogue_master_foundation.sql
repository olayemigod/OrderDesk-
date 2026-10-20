begin;

create table if not exists public.sellertray_product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (nullif(btrim(name), '') is not null and char_length(btrim(name)) <= 120),
  normalized_name text generated always as (lower(btrim(name))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, normalized_name)
);

create table if not exists public.sellertray_uoms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (nullif(btrim(name), '') is not null and char_length(btrim(name)) <= 80),
  normalized_name text generated always as (lower(btrim(name))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, normalized_name)
);

create index if not exists sellertray_product_categories_tenant_active_name_idx
  on public.sellertray_product_categories (tenant_id, is_active, normalized_name);
create index if not exists sellertray_uoms_tenant_active_name_idx
  on public.sellertray_uoms (tenant_id, is_active, normalized_name);

alter table public.sellertray_product_categories enable row level security;
alter table public.sellertray_uoms enable row level security;

revoke all on table public.sellertray_product_categories from public, anon, authenticated;
revoke all on table public.sellertray_uoms from public, anon, authenticated;
grant all on table public.sellertray_product_categories to service_role;
grant all on table public.sellertray_uoms to service_role;

-- Preserve every existing catalogue value before making product-management
-- commands strict. Existing rows stay valid and become selectable masters.
insert into public.sellertray_product_categories (tenant_id, name)
select distinct on (ci.tenant_id, lower(btrim(ci.category)))
  ci.tenant_id,
  btrim(ci.category)
from public.catalog_items ci
where nullif(btrim(coalesce(ci.category, '')), '') is not null
order by ci.tenant_id, lower(btrim(ci.category)), ci.created_at, ci.id
on conflict (tenant_id, normalized_name) do nothing;

insert into public.sellertray_uoms (tenant_id, name)
select distinct on (source.tenant_id, lower(btrim(source.name)))
  source.tenant_id,
  btrim(source.name)
from (
  select ci.tenant_id, ci.stock_uom as name, ci.created_at, ci.id
  from public.catalog_items ci
  where nullif(btrim(coalesce(ci.stock_uom, '')), '') is not null
  union all
  select u.tenant_id, u.uom_name as name, u.created_at, u.id
  from public.catalog_item_uoms u
  where nullif(btrim(coalesce(u.uom_name, '')), '') is not null
) source
order by source.tenant_id, lower(btrim(source.name)), source.created_at, source.id
on conflict (tenant_id, normalized_name) do nothing;

-- `Each` is the long-standing default for new products. Seed it as an explicit
-- master so the new governed selector remains backwards compatible.
insert into public.sellertray_uoms (tenant_id, name)
select t.id, 'Each'
from public.tenants t
on conflict (tenant_id, normalized_name) do nothing;

-- Internal/legacy catalogue writers are retained for WhatsApp and migration
-- compatibility. When one of those governed server paths writes a previously
-- unseen value, register it in the same Business master rather than allowing a
-- second vocabulary to emerge. Mobile/Web product-management commands below
-- remain strict create/select boundaries.
create or replace function public.register_sellertray_catalogue_item_masters()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if nullif(btrim(coalesce(new.category, '')), '') is not null then
    insert into public.sellertray_product_categories (tenant_id, name)
    values (new.tenant_id, btrim(new.category))
    on conflict (tenant_id, normalized_name) do nothing;
  end if;

  if nullif(btrim(coalesce(new.stock_uom, '')), '') is not null then
    insert into public.sellertray_uoms (tenant_id, name)
    values (new.tenant_id, btrim(new.stock_uom))
    on conflict (tenant_id, normalized_name) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.register_sellertray_catalogue_item_masters() from public, anon, authenticated;

drop trigger if exists register_sellertray_catalogue_item_masters on public.catalog_items;
create trigger register_sellertray_catalogue_item_masters
after insert or update of category, stock_uom on public.catalog_items
for each row execute function public.register_sellertray_catalogue_item_masters();

create or replace function public.register_sellertray_catalogue_uom_master()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if nullif(btrim(coalesce(new.uom_name, '')), '') is not null then
    insert into public.sellertray_uoms (tenant_id, name)
    values (new.tenant_id, btrim(new.uom_name))
    on conflict (tenant_id, normalized_name) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.register_sellertray_catalogue_uom_master() from public, anon, authenticated;

drop trigger if exists register_sellertray_catalogue_uom_master on public.catalog_item_uoms;
create trigger register_sellertray_catalogue_uom_master
after insert or update of uom_name on public.catalog_item_uoms
for each row execute function public.register_sellertray_catalogue_uom_master();

create or replace function public.get_sellertray_catalogue_masters(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_categories jsonb;
  v_uoms jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'You do not have access to this business catalogue' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'isActive', c.is_active
  ) order by c.normalized_name, c.id), '[]'::jsonb)
  into v_categories
  from public.sellertray_product_categories c
  where c.tenant_id=p_tenant_id and c.is_active=true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id,
    'name', u.name,
    'isActive', u.is_active
  ) order by u.normalized_name, u.id), '[]'::jsonb)
  into v_uoms
  from public.sellertray_uoms u
  where u.tenant_id=p_tenant_id and u.is_active=true;

  return jsonb_build_object('categories', v_categories, 'uoms', v_uoms);
end;
$$;

create or replace function public.create_sellertray_product_category(
  p_tenant_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_row public.sellertray_product_categories%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id, v_user_id) then
    raise exception 'You do not have permission to manage product categories' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_name is null or char_length(v_name)>120 then
    raise exception 'Enter a product category no longer than 120 characters' using errcode='22023';
  end if;

  insert into public.sellertray_product_categories (tenant_id, name, is_active, updated_at)
  values (p_tenant_id, v_name, true, now())
  on conflict (tenant_id, normalized_name)
  do update set name=excluded.name, is_active=true, updated_at=now()
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'isActive', v_row.is_active);
end;
$$;

create or replace function public.create_sellertray_uom(
  p_tenant_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_row public.sellertray_uoms%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id, v_user_id) then
    raise exception 'You do not have permission to manage units' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_name is null or char_length(v_name)>80 then
    raise exception 'Enter a unit no longer than 80 characters' using errcode='22023';
  end if;

  insert into public.sellertray_uoms (tenant_id, name, is_active, updated_at)
  values (p_tenant_id, v_name, true, now())
  on conflict (tenant_id, normalized_name)
  do update set name=excluded.name, is_active=true, updated_at=now()
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'isActive', v_row.is_active);
end;
$$;

-- Product definitions now select from the Business masters. The existing
-- signature is preserved so Mobile/Web/legacy callers do not fork authority.
create or replace function public.save_sellertray_product(
  p_tenant_id uuid,p_product_id uuid,p_name text,p_sku text,p_category text,
  p_stock_uom text,p_allow_fractional_stock boolean,p_selling_price numeric
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid := auth.uid();
  v_product_id uuid := p_product_id;
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_sku text := nullif(btrim(coalesce(p_sku,'')),'');
  v_requested_category text := nullif(btrim(coalesce(p_category,'')),'');
  v_requested_stock_uom text := nullif(btrim(coalesce(p_stock_uom,'')),'');
  v_category text;
  v_stock_uom text;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then
    raise exception 'You do not have permission to manage products' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if v_name is null or v_requested_stock_uom is null or p_selling_price is null or p_selling_price<0 then raise exception 'Product name, Stock UOM and a valid selling price are required' using errcode='22023'; end if;
  if char_length(v_name)>160 or char_length(v_requested_stock_uom)>80 or char_length(coalesce(v_sku,''))>120 or char_length(coalesce(v_requested_category,''))>120 then raise exception 'Product details are too long' using errcode='22023'; end if;

  select u.name into v_stock_uom
  from public.sellertray_uoms u
  where u.tenant_id=p_tenant_id
    and u.normalized_name=lower(v_requested_stock_uom)
    and u.is_active=true
  limit 1;
  if v_stock_uom is null then
    raise exception 'Create or select a valid Stock UOM before saving this product' using errcode='22023';
  end if;

  if v_requested_category is not null then
    select c.name into v_category
    from public.sellertray_product_categories c
    where c.tenant_id=p_tenant_id
      and c.normalized_name=lower(v_requested_category)
      and c.is_active=true
    limit 1;
    if v_category is null then
      raise exception 'Create or select a valid product category before saving this product' using errcode='22023';
    end if;
  end if;

  if v_product_id is null then
    insert into public.catalog_items(tenant_id,name,sku,category,price_ngn,stock_uom,allow_fractional_stock,is_active)
    values(p_tenant_id,v_name,v_sku,v_category,round(p_selling_price::numeric,2),v_stock_uom,coalesce(p_allow_fractional_stock,true),true)
    returning id into v_product_id;
  else
    update public.catalog_items ci
    set name=v_name,sku=v_sku,category=v_category,price_ngn=round(p_selling_price::numeric,2),stock_uom=v_stock_uom,allow_fractional_stock=coalesce(p_allow_fractional_stock,true),updated_at=now()
    where ci.tenant_id=p_tenant_id and ci.id=v_product_id;
    if not found then raise exception 'Product not found' using errcode='22023'; end if;
  end if;
  return v_product_id;
end; $$;

create or replace function public.save_sellertray_product_uom(
  p_tenant_id uuid,p_product_id uuid,p_uom_id uuid,p_uom_name text,p_conversion_factor numeric,
  p_selling_price numeric,p_barcode text,p_allow_fractional boolean,p_is_default_selling boolean,p_is_default_purchase boolean
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid := auth.uid(); v_uom_id uuid := p_uom_id;
  v_requested_name text := nullif(btrim(coalesce(p_uom_name,'')),''); v_name text;
  v_barcode text := nullif(btrim(coalesce(p_barcode,'')),'');
  v_stock_uom text; v_existing public.catalog_item_uoms%rowtype;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then raise exception 'You do not have permission to manage product units' using errcode='42501'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if v_requested_name is null or p_conversion_factor is null or p_conversion_factor<=0 or (p_selling_price is not null and p_selling_price<0) then raise exception 'Unit name, positive conversion factor and valid price are required' using errcode='22023'; end if;
  if char_length(v_requested_name)>80 or char_length(coalesce(v_barcode,''))>160 then raise exception 'Unit name or barcode is too long' using errcode='22023'; end if;

  select m.name into v_name
  from public.sellertray_uoms m
  where m.tenant_id=p_tenant_id
    and m.normalized_name=lower(v_requested_name)
    and m.is_active=true
  limit 1;
  if v_name is null then
    raise exception 'Create or select a valid Business UOM before saving this product unit' using errcode='22023';
  end if;

  select ci.stock_uom into v_stock_uom from public.catalog_items ci where ci.tenant_id=p_tenant_id and ci.id=p_product_id;
  if v_stock_uom is null then raise exception 'Product not found' using errcode='22023'; end if;
  if v_uom_id is not null then
    select * into v_existing from public.catalog_item_uoms u where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=v_uom_id;
    if not found then raise exception 'Product unit not found' using errcode='22023'; end if;
    if lower(btrim(v_existing.uom_name))=lower(btrim(v_stock_uom)) and lower(v_name)<>lower(btrim(v_stock_uom)) then raise exception 'Stock UOM cannot be renamed from the unit editor' using errcode='23514'; end if;
    if v_existing.is_default_selling and not coalesce(p_is_default_selling,false) and not exists (select 1 from public.catalog_item_uoms u where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id<>v_uom_id and u.is_default_selling=true) then raise exception 'Choose another default selling unit before clearing this one' using errcode='23514'; end if;
    if v_existing.is_default_purchase and not coalesce(p_is_default_purchase,false) and not exists (select 1 from public.catalog_item_uoms u where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id<>v_uom_id and u.is_default_purchase=true) then raise exception 'Choose another default purchase unit before clearing this one' using errcode='23514'; end if;
  end if;
  if lower(v_name)=lower(btrim(v_stock_uom)) and p_conversion_factor<>1 then raise exception 'Stock UOM conversion factor must be 1' using errcode='23514'; end if;
  if coalesce(p_is_default_selling,false) then update public.catalog_item_uoms u set is_default_selling=false,updated_at=now() where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and (v_uom_id is null or u.id<>v_uom_id) and u.is_default_selling=true; end if;
  if coalesce(p_is_default_purchase,false) then update public.catalog_item_uoms u set is_default_purchase=false,updated_at=now() where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and (v_uom_id is null or u.id<>v_uom_id) and u.is_default_purchase=true; end if;
  if v_uom_id is null then
    insert into public.catalog_item_uoms(tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,barcode,allow_fractional,is_default_selling,is_default_purchase)
    values(p_tenant_id,p_product_id,v_name,p_conversion_factor,case when p_selling_price is null then null else round(p_selling_price::numeric,2) end,v_barcode,coalesce(p_allow_fractional,true),coalesce(p_is_default_selling,false),coalesce(p_is_default_purchase,false)) returning id into v_uom_id;
  else
    update public.catalog_item_uoms u set uom_name=v_name,conversion_factor=p_conversion_factor,selling_price=case when p_selling_price is null then null else round(p_selling_price::numeric,2) end,barcode=v_barcode,allow_fractional=coalesce(p_allow_fractional,true),is_default_selling=coalesce(p_is_default_selling,false),is_default_purchase=coalesce(p_is_default_purchase,false),updated_at=now()
    where u.tenant_id=p_tenant_id and u.catalog_item_id=p_product_id and u.id=v_uom_id;
  end if;
  return v_uom_id;
end; $$;

create or replace function public.get_sellertray_product_management_page(
  p_tenant_id uuid,
  p_search text default null,
  p_status text default 'active',
  p_category text default null,
  p_uom text default null,
  p_missing_barcode boolean default false,
  p_missing_price boolean default false,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_status text := lower(btrim(coalesce(p_status,'active')));
  v_category text := nullif(btrim(coalesce(p_category,'')),'');
  v_uom text := nullif(btrim(coalesce(p_uom,'')),'');
  v_page_size integer := greatest(10,least(coalesce(p_page_size,25),100));
  v_requested_page integer := greatest(1,coalesce(p_page,1));
  v_page integer;
  v_total integer;
  v_total_pages integer;
  v_items jsonb;
  v_categories jsonb;
  v_uoms jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then raise exception 'You do not have permission to manage products' using errcode='42501'; end if;
  if v_status not in ('active','archived','all') then raise exception 'Unknown product status filter' using errcode='22023'; end if;

  select count(*)::integer into v_total
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id
    and (v_status='all' or (v_status='active' and ci.is_active) or (v_status='archived' and not ci.is_active))
    and (v_category is null or lower(btrim(coalesce(ci.category,'')))=lower(v_category))
    and (v_uom is null or lower(btrim(ci.stock_uom))=lower(v_uom) or exists (select 1 from public.catalog_item_uoms u where u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id and lower(btrim(u.uom_name))=lower(v_uom)))
    and (not coalesce(p_missing_barcode,false) or not exists (select 1 from public.catalog_item_uoms u where u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id and nullif(btrim(coalesce(u.barcode,'')),'') is not null))
    and (not coalesce(p_missing_price,false) or ci.price_ngn is null)
    and (v_search is null or ci.name ilike '%'||v_search||'%' or coalesce(ci.sku,'') ilike '%'||v_search||'%' or coalesce(ci.category,'') ilike '%'||v_search||'%' or ci.stock_uom ilike '%'||v_search||'%' or exists (select 1 from public.catalog_item_uoms u where u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id and (u.uom_name ilike '%'||v_search||'%' or coalesce(u.barcode,'') ilike '%'||v_search||'%')));

  v_total_pages := greatest(1,ceil(v_total::numeric/v_page_size)::integer);
  v_page := least(v_requested_page,v_total_pages);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'name',x.name,'sku',x.sku,'category',x.category,'stockUom',x.stock_uom,
    'sellingPrice',x.price_ngn,'isActive',x.is_active,'unitCount',x.unit_count,'barcodeCount',x.barcode_count
  ) order by x.is_active desc,lower(x.name),x.id),'[]'::jsonb)
  into v_items
  from (
    select ci.id,ci.name,ci.sku,ci.category,ci.stock_uom,ci.price_ngn,ci.is_active,
      (select count(*)::integer from public.catalog_item_uoms u where u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id) as unit_count,
      (select count(*)::integer from public.catalog_item_uoms u where u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id and nullif(btrim(coalesce(u.barcode,'')),'') is not null) as barcode_count
    from public.catalog_items ci
    where ci.tenant_id=p_tenant_id
      and (v_status='all' or (v_status='active' and ci.is_active) or (v_status='archived' and not ci.is_active))
      and (v_category is null or lower(btrim(coalesce(ci.category,'')))=lower(v_category))
      and (v_uom is null or lower(btrim(ci.stock_uom))=lower(v_uom) or exists (select 1 from public.catalog_item_uoms u where u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id and lower(btrim(u.uom_name))=lower(v_uom)))
      and (not coalesce(p_missing_barcode,false) or not exists (select 1 from public.catalog_item_uoms u where u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id and nullif(btrim(coalesce(u.barcode,'')),'') is not null))
      and (not coalesce(p_missing_price,false) or ci.price_ngn is null)
      and (v_search is null or ci.name ilike '%'||v_search||'%' or coalesce(ci.sku,'') ilike '%'||v_search||'%' or coalesce(ci.category,'') ilike '%'||v_search||'%' or ci.stock_uom ilike '%'||v_search||'%' or exists (select 1 from public.catalog_item_uoms u where u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id and (u.uom_name ilike '%'||v_search||'%' or coalesce(u.barcode,'') ilike '%'||v_search||'%')))
    order by ci.is_active desc,lower(ci.name),ci.id
    limit v_page_size offset ((v_page-1)*v_page_size)
  ) x;

  select coalesce(jsonb_agg(c.name order by c.normalized_name,c.id),'[]'::jsonb)
  into v_categories
  from public.sellertray_product_categories c
  where c.tenant_id=p_tenant_id and c.is_active=true;

  select coalesce(jsonb_agg(u.name order by u.normalized_name,u.id),'[]'::jsonb)
  into v_uoms
  from public.sellertray_uoms u
  where u.tenant_id=p_tenant_id and u.is_active=true;

  return jsonb_build_object('page',v_page,'pageSize',v_page_size,'total',v_total,'totalPages',v_total_pages,'categories',v_categories,'uoms',v_uoms,'items',v_items);
end;
$$;

revoke all on function public.get_sellertray_catalogue_masters(uuid) from public, anon;
revoke all on function public.create_sellertray_product_category(uuid,text) from public, anon;
revoke all on function public.create_sellertray_uom(uuid,text) from public, anon;
revoke all on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric) from public, anon;
revoke all on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean) from public, anon;
revoke all on function public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer) from public, anon;

grant execute on function public.get_sellertray_catalogue_masters(uuid) to authenticated, service_role;
grant execute on function public.create_sellertray_product_category(uuid,text) to authenticated;
grant execute on function public.create_sellertray_uom(uuid,text) to authenticated;
grant execute on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric) to authenticated;
grant execute on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean) to authenticated;
grant execute on function public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer) to authenticated, service_role;

commit;
