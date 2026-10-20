begin;

-- SellerTray catalogue master-data authority.
-- Product-specific UOM rows continue to own conversion, price and barcode rules;
-- these Business-scoped masters own the reusable category/UOM vocabulary shared
-- by Mobile, Merchant Web, WhatsApp and governed commerce services.

create table public.catalogue_categories (
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

create table public.business_uoms (
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

create index catalogue_categories_tenant_active_name_idx
  on public.catalogue_categories (tenant_id, is_active, normalized_name);
create index business_uoms_tenant_active_name_idx
  on public.business_uoms (tenant_id, is_active, normalized_name);

alter table public.catalogue_categories enable row level security;
alter table public.business_uoms enable row level security;

-- Master tables are command/read-model only. Browser/mobile clients do not
-- receive raw DML or SELECT authority over catalogue governance tables.
revoke all on table public.catalogue_categories from public, anon, authenticated;
revoke all on table public.business_uoms from public, anon, authenticated;
grant all on table public.catalogue_categories to service_role;
grant all on table public.business_uoms to service_role;

-- Preserve every catalogue value already in commercial use before validation
-- becomes strict. Canonical case is retained from the first matching value.
insert into public.catalogue_categories (tenant_id, name)
select x.tenant_id, x.name
from (
  select distinct on (ci.tenant_id, lower(btrim(ci.category)))
    ci.tenant_id,
    btrim(ci.category) as name
  from public.catalog_items ci
  where nullif(btrim(coalesce(ci.category, '')), '') is not null
  order by ci.tenant_id, lower(btrim(ci.category)), ci.created_at, ci.id
) x
on conflict (tenant_id, normalized_name) do nothing;

insert into public.business_uoms (tenant_id, name)
select x.tenant_id, x.name
from (
  select distinct on (q.tenant_id, lower(btrim(q.name))) q.tenant_id, btrim(q.name) as name
  from (
    select ci.tenant_id, ci.stock_uom as name, ci.created_at, ci.id
    from public.catalog_items ci
    where nullif(btrim(coalesce(ci.stock_uom, '')), '') is not null
    union all
    select u.tenant_id, u.uom_name as name, u.created_at, u.id
    from public.catalog_item_uoms u
    where nullif(btrim(coalesce(u.uom_name, '')), '') is not null
  ) q
  order by q.tenant_id, lower(btrim(q.name)), q.created_at, q.id
) x
on conflict (tenant_id, normalized_name) do nothing;

-- Every Business starts with a practical base unit, including existing tenants.
insert into public.business_uoms (tenant_id, name)
select t.id, 'Each'
from public.tenants t
on conflict (tenant_id, normalized_name) do nothing;

create or replace function public.ensure_sellertray_catalogue_master_defaults()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.business_uoms (tenant_id, name)
  values (new.id, 'Each')
  on conflict (tenant_id, normalized_name) do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_sellertray_catalogue_master_defaults() from public, anon, authenticated;

drop trigger if exists ensure_sellertray_catalogue_master_defaults on public.tenants;
create trigger ensure_sellertray_catalogue_master_defaults
after insert on public.tenants
for each row execute function public.ensure_sellertray_catalogue_master_defaults();

create or replace function public.get_sellertray_catalogue_master_data(p_tenant_id uuid)
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
  if not public.sellertray_user_can_manage_products(p_tenant_id, v_user_id) then
    raise exception 'You do not have permission to manage catalogue masters' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.normalized_name), '[]'::jsonb)
    into v_categories
  from public.catalogue_categories c
  where c.tenant_id=p_tenant_id and c.is_active=true;

  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.normalized_name), '[]'::jsonb)
    into v_uoms
  from public.business_uoms u
  where u.tenant_id=p_tenant_id and u.is_active=true;

  return jsonb_build_object('categories', v_categories, 'uoms', v_uoms);
end;
$$;

create or replace function public.create_sellertray_product_category(
  p_tenant_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
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
    raise exception 'Enter a valid category name' using errcode='22023';
  end if;

  insert into public.catalogue_categories (tenant_id, name, is_active)
  values (p_tenant_id, v_name, true)
  on conflict (tenant_id, normalized_name)
  do update set name=excluded.name, is_active=true, updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_sellertray_business_uom(
  p_tenant_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
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
    raise exception 'Enter a valid unit name' using errcode='22023';
  end if;

  insert into public.business_uoms (tenant_id, name, is_active)
  values (p_tenant_id, v_name, true)
  on conflict (tenant_id, normalized_name)
  do update set name=excluded.name, is_active=true, updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Preserve the established signature so existing clients remain compatible.
-- Values are now canonicalised through the Business masters instead of creating
-- master truth implicitly from free text.
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
  v_category_input text := nullif(btrim(coalesce(p_category,'')),'');
  v_stock_uom_input text := nullif(btrim(coalesce(p_stock_uom,'')),'');
  v_category text;
  v_stock_uom text;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then
    raise exception 'You do not have permission to manage products' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if v_name is null or v_stock_uom_input is null or p_selling_price is null or p_selling_price<0 then raise exception 'Product name, Stock UOM and a valid selling price are required' using errcode='22023'; end if;
  if char_length(v_name)>160 or char_length(v_stock_uom_input)>80 or char_length(coalesce(v_sku,''))>120 or char_length(coalesce(v_category_input,''))>120 then raise exception 'Product details are too long' using errcode='22023'; end if;

  select u.name into v_stock_uom
  from public.business_uoms u
  where u.tenant_id=p_tenant_id and u.is_active=true and u.normalized_name=lower(v_stock_uom_input)
  limit 1;
  if v_stock_uom is null then
    raise exception 'Select an active Business unit before saving this product' using errcode='22023';
  end if;

  if v_category_input is not null then
    select c.name into v_category
    from public.catalogue_categories c
    where c.tenant_id=p_tenant_id and c.is_active=true and c.normalized_name=lower(v_category_input)
    limit 1;
    if v_category is null then
      raise exception 'Select an active product category or leave Category empty' using errcode='22023';
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
end;
$$;

-- Product-specific conversion remains authoritative, but its unit name must now
-- resolve to the shared Business UOM vocabulary.
create or replace function public.save_sellertray_product_uom(
  p_tenant_id uuid,p_product_id uuid,p_uom_id uuid,p_uom_name text,p_conversion_factor numeric,
  p_selling_price numeric,p_barcode text,p_allow_fractional boolean,p_is_default_selling boolean,p_is_default_purchase boolean
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid := auth.uid(); v_uom_id uuid := p_uom_id;
  v_name_input text := nullif(btrim(coalesce(p_uom_name,'')),'');
  v_name text; v_barcode text := nullif(btrim(coalesce(p_barcode,'')),'');
  v_stock_uom text; v_existing public.catalog_item_uoms%rowtype;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then raise exception 'You do not have permission to manage product units' using errcode='42501'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if v_name_input is null or p_conversion_factor is null or p_conversion_factor<=0 or (p_selling_price is not null and p_selling_price<0) then raise exception 'Unit name, positive conversion factor and valid price are required' using errcode='22023'; end if;
  if char_length(v_name_input)>80 or char_length(coalesce(v_barcode,''))>160 then raise exception 'Unit name or barcode is too long' using errcode='22023'; end if;

  select bu.name into v_name
  from public.business_uoms bu
  where bu.tenant_id=p_tenant_id and bu.is_active=true and bu.normalized_name=lower(v_name_input)
  limit 1;
  if v_name is null then
    raise exception 'Select an active Business unit before saving this product unit' using errcode='22023';
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
end;
$$;

revoke all on function public.get_sellertray_catalogue_master_data(uuid) from public, anon;
revoke all on function public.create_sellertray_product_category(uuid,text) from public, anon;
revoke all on function public.create_sellertray_business_uom(uuid,text) from public, anon;
revoke all on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric) from public, anon;
revoke all on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean) from public, anon;

grant execute on function public.get_sellertray_catalogue_master_data(uuid) to authenticated, service_role;
grant execute on function public.create_sellertray_product_category(uuid,text) to authenticated;
grant execute on function public.create_sellertray_business_uom(uuid,text) to authenticated;
grant execute on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric) to authenticated;
grant execute on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean) to authenticated;

commit;
