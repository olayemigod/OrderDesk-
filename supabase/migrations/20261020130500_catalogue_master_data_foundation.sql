begin;

-- Business-scoped catalogue masters. Product rows keep canonical text snapshots so
-- existing POS, WhatsApp and reporting readers remain backward compatible.
create table public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (nullif(btrim(name), '') is not null),
  name_key text generated always as (lower(btrim(name))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name_key)
);

create table public.catalog_uoms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (nullif(btrim(name), '') is not null),
  name_key text generated always as (lower(btrim(name))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name_key)
);

create index catalog_categories_tenant_active_name_idx
  on public.catalog_categories (tenant_id, is_active, name_key);
create index catalog_uoms_tenant_active_name_idx
  on public.catalog_uoms (tenant_id, is_active, name_key);

alter table public.catalog_categories enable row level security;
alter table public.catalog_uoms enable row level security;
revoke all on table public.catalog_categories from anon, authenticated;
revoke all on table public.catalog_uoms from anon, authenticated;
grant all on table public.catalog_categories to service_role;
grant all on table public.catalog_uoms to service_role;

-- Preserve every existing merchant value before guards are enabled.
insert into public.catalog_categories (tenant_id, name)
select source.tenant_id, min(source.name) as name
from (
  select ci.tenant_id, btrim(ci.category) as name
  from public.catalog_items ci
  where nullif(btrim(coalesce(ci.category, '')), '') is not null
) source
group by source.tenant_id, lower(source.name)
on conflict (tenant_id, name_key) do nothing;

insert into public.catalog_uoms (tenant_id, name)
select source.tenant_id, min(source.name) as name
from (
  select ci.tenant_id, btrim(ci.stock_uom) as name
  from public.catalog_items ci
  where nullif(btrim(coalesce(ci.stock_uom, '')), '') is not null
  union all
  select u.tenant_id, btrim(u.uom_name) as name
  from public.catalog_item_uoms u
  where nullif(btrim(coalesce(u.uom_name, '')), '') is not null
  union all
  select t.id as tenant_id, 'Each'::text as name
  from public.tenants t
) source
group by source.tenant_id, lower(source.name)
on conflict (tenant_id, name_key) do nothing;

create or replace function public.ensure_sellertray_default_catalogue_uom()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.catalog_uoms (tenant_id, name)
  values (new.id, 'Each')
  on conflict (tenant_id, name_key) do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_sellertray_default_catalogue_uom() from public, anon, authenticated;
drop trigger if exists ensure_sellertray_default_catalogue_uom on public.tenants;
create trigger ensure_sellertray_default_catalogue_uom
after insert on public.tenants
for each row execute function public.ensure_sellertray_default_catalogue_uom();

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
  if not public.sellertray_user_can_manage_products(p_tenant_id, v_user_id) then
    raise exception 'You do not have permission to manage catalogue masters' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name_key, c.id), '[]'::jsonb)
    into v_categories
  from public.catalog_categories c
  where c.tenant_id=p_tenant_id and c.is_active=true;

  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name_key, u.id), '[]'::jsonb)
    into v_uoms
  from public.catalog_uoms u
  where u.tenant_id=p_tenant_id and u.is_active=true;

  return jsonb_build_object('categories', v_categories, 'uoms', v_uoms);
end;
$$;

create or replace function public.create_sellertray_product_category(p_tenant_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_result jsonb;
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

  insert into public.catalog_categories (tenant_id, name, is_active)
  values (p_tenant_id, v_name, true)
  on conflict (tenant_id, name_key)
  do update set is_active=true, updated_at=now()
  returning jsonb_build_object('id', id, 'name', name) into v_result;

  return v_result;
end;
$$;

create or replace function public.create_sellertray_uom(p_tenant_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_result jsonb;
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

  insert into public.catalog_uoms (tenant_id, name, is_active)
  values (p_tenant_id, v_name, true)
  on conflict (tenant_id, name_key)
  do update set is_active=true, updated_at=now()
  returning jsonb_build_object('id', id, 'name', name) into v_result;

  return v_result;
end;
$$;

-- Guard all product-table writes, including trusted legacy wrappers, against the
-- same masters. Existing canonical strings remain the stored snapshots.
create or replace function public.validate_sellertray_catalogue_master_refs()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_stock_uom text;
  v_category text;
begin
  select u.name into v_stock_uom
  from public.catalog_uoms u
  where u.tenant_id=new.tenant_id
    and u.is_active=true
    and u.name_key=lower(btrim(coalesce(new.stock_uom, '')))
  limit 1;
  if v_stock_uom is null then
    raise exception 'Stock UOM must be selected from configured units' using errcode='23514';
  end if;
  new.stock_uom := v_stock_uom;

  new.category := nullif(btrim(coalesce(new.category, '')), '');
  if new.category is not null then
    select c.name into v_category
    from public.catalog_categories c
    where c.tenant_id=new.tenant_id
      and c.is_active=true
      and c.name_key=lower(new.category)
    limit 1;
    if v_category is null then
      raise exception 'Product category must be selected from configured categories' using errcode='23514';
    end if;
    new.category := v_category;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_sellertray_catalogue_master_refs() from public, anon, authenticated;
drop trigger if exists validate_sellertray_catalogue_master_refs on public.catalog_items;
create trigger validate_sellertray_catalogue_master_refs
before insert or update of tenant_id, category, stock_uom on public.catalog_items
for each row execute function public.validate_sellertray_catalogue_master_refs();

create or replace function public.validate_sellertray_product_uom_master_ref()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uom text;
begin
  select u.name into v_uom
  from public.catalog_uoms u
  where u.tenant_id=new.tenant_id
    and u.is_active=true
    and u.name_key=lower(btrim(coalesce(new.uom_name, '')))
  limit 1;
  if v_uom is null then
    raise exception 'Product unit must be selected from configured units' using errcode='23514';
  end if;
  new.uom_name := v_uom;
  return new;
end;
$$;

revoke all on function public.validate_sellertray_product_uom_master_ref() from public, anon, authenticated;
drop trigger if exists catalogue_uom_master_ref_guard on public.catalog_item_uoms;
create trigger catalogue_uom_master_ref_guard
before insert or update of tenant_id, uom_name on public.catalog_item_uoms
for each row execute function public.validate_sellertray_product_uom_master_ref();

-- Keep the existing public signature while changing authority from arbitrary text
-- to tenant masters. That avoids breaking Mobile/Web callers during convergence.
create or replace function public.save_sellertray_product(
  p_tenant_id uuid,p_product_id uuid,p_name text,p_sku text,p_category text,
  p_stock_uom text,p_allow_fractional_stock boolean,p_selling_price numeric
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_product_id uuid := p_product_id;
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_sku text := nullif(btrim(coalesce(p_sku,'')),'');
  v_category_input text := nullif(btrim(coalesce(p_category,'')),'');
  v_category text;
  v_stock_uom_input text := nullif(btrim(coalesce(p_stock_uom,'')),'');
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
  from public.catalog_uoms u
  where u.tenant_id=p_tenant_id and u.is_active=true and u.name_key=lower(v_stock_uom_input)
  limit 1;
  if v_stock_uom is null then raise exception 'Choose a configured Stock UOM' using errcode='22023'; end if;

  if v_category_input is not null then
    select c.name into v_category
    from public.catalog_categories c
    where c.tenant_id=p_tenant_id and c.is_active=true and c.name_key=lower(v_category_input)
    limit 1;
    if v_category is null then raise exception 'Choose a configured product category' using errcode='22023'; end if;
  end if;

  if v_product_id is null then
    insert into public.catalog_items(tenant_id,name,sku,category,price_ngn,stock_uom,allow_fractional_stock,is_active)
    values(p_tenant_id,v_name,v_sku,v_category,round(p_selling_price::numeric,2),v_stock_uom,coalesce(p_allow_fractional_stock,true),true)
    returning id into v_product_id;
  else
    update public.catalog_items ci set name=v_name,sku=v_sku,category=v_category,price_ngn=round(p_selling_price::numeric,2),stock_uom=v_stock_uom,allow_fractional_stock=coalesce(p_allow_fractional_stock,true),updated_at=now()
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
  v_user_id uuid := (select auth.uid()); v_uom_id uuid := p_uom_id;
  v_name_input text := nullif(btrim(coalesce(p_uom_name,'')),''); v_name text;
  v_barcode text := nullif(btrim(coalesce(p_barcode,'')),'');
  v_stock_uom text; v_existing public.catalog_item_uoms%rowtype;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then raise exception 'You do not have permission to manage product units' using errcode='42501'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if v_name_input is null or p_conversion_factor is null or p_conversion_factor<=0 or (p_selling_price is not null and p_selling_price<0) then raise exception 'Unit name, positive conversion factor and valid price are required' using errcode='22023'; end if;
  if char_length(v_name_input)>80 or char_length(coalesce(v_barcode,''))>160 then raise exception 'Unit name or barcode is too long' using errcode='22023'; end if;

  select cu.name into v_name
  from public.catalog_uoms cu
  where cu.tenant_id=p_tenant_id and cu.is_active=true and cu.name_key=lower(v_name_input)
  limit 1;
  if v_name is null then raise exception 'Choose a configured unit' using errcode='22023'; end if;

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

-- Legacy catalogue editor compatibility: an explicit custom category action on
-- that surface now creates/reuses the same governed master before product save.
create or replace function public.save_sellertray_catalogue_item(
  p_tenant_id uuid,
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_category text,
  p_image_url text,
  p_selling_price numeric,
  p_aliases jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_product_id uuid := p_product_id;
  v_stock_uom text := 'Each';
  v_allow_fractional_stock boolean := true;
  v_image_url text := nullif(btrim(coalesce(p_image_url,'')),'');
  v_aliases jsonb := coalesce(p_aliases,'[]'::jsonb);
  v_alias_count integer;
  v_invalid_alias_count integer;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then raise exception 'You do not have permission to manage products' using errcode='42501'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if jsonb_typeof(v_aliases)<>'array' then raise exception 'Product aliases must be a list' using errcode='22023'; end if;
  v_alias_count := jsonb_array_length(v_aliases);
  if v_alias_count>100 then raise exception 'A product can have at most 100 aliases' using errcode='22023'; end if;
  select count(*)::integer into v_invalid_alias_count from jsonb_array_elements(v_aliases) a(value)
  where jsonb_typeof(a.value)<>'string' or char_length(btrim(a.value #>> '{}'))>160;
  if v_invalid_alias_count>0 then raise exception 'Product aliases must be text values no longer than 160 characters' using errcode='22023'; end if;
  if char_length(coalesce(v_image_url,''))>2048 then raise exception 'Product image URL is too long' using errcode='22023'; end if;

  if v_product_id is not null then
    select ci.stock_uom,ci.allow_fractional_stock into v_stock_uom,v_allow_fractional_stock
    from public.catalog_items ci where ci.tenant_id=p_tenant_id and ci.id=v_product_id;
    if not found then raise exception 'Product not found' using errcode='22023'; end if;
  end if;

  if nullif(btrim(coalesce(p_category,'')), '') is not null then
    perform public.create_sellertray_product_category(p_tenant_id, p_category);
  end if;

  v_product_id := public.save_sellertray_product(
    p_tenant_id,v_product_id,p_name,p_sku,p_category,
    v_stock_uom,v_allow_fractional_stock,p_selling_price
  );

  update public.catalog_items ci set image_url=v_image_url,updated_at=now()
  where ci.tenant_id=p_tenant_id and ci.id=v_product_id;

  delete from public.catalog_item_aliases a
  where a.tenant_id=p_tenant_id and a.catalog_item_id=v_product_id;

  insert into public.catalog_item_aliases(tenant_id,catalog_item_id,alias)
  select p_tenant_id,v_product_id,normalized.alias
  from (
    select min(btrim(a.value #>> '{}')) as alias
    from jsonb_array_elements(v_aliases) a(value)
    where nullif(btrim(a.value #>> '{}'),'') is not null
    group by lower(btrim(a.value #>> '{}'))
  ) normalized;

  return v_product_id;
end;
$$;

revoke all on function public.get_sellertray_catalogue_masters(uuid) from public, anon;
revoke all on function public.create_sellertray_product_category(uuid,text) from public, anon;
revoke all on function public.create_sellertray_uom(uuid,text) from public, anon;
revoke all on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric) from public, anon;
revoke all on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean) from public, anon;
revoke all on function public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb) from public, anon;

grant execute on function public.get_sellertray_catalogue_masters(uuid) to authenticated, service_role;
grant execute on function public.create_sellertray_product_category(uuid,text) to authenticated, service_role;
grant execute on function public.create_sellertray_uom(uuid,text) to authenticated, service_role;
grant execute on function public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric) to authenticated;
grant execute on function public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean) to authenticated;
grant execute on function public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb) to authenticated;

commit;
