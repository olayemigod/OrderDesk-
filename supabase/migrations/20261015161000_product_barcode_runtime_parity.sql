begin;

create or replace function public.get_sellertray_product_capabilities(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
  ) then
    raise exception 'Business access denied' using errcode='42501';
  end if;

  return jsonb_build_object(
    'canManageProducts',
    public.sellertray_user_can_manage_products(p_tenant_id,v_user_id)
  );
end;
$$;

revoke all on function public.get_sellertray_product_capabilities(uuid) from public,anon;
grant execute on function public.get_sellertray_product_capabilities(uuid) to authenticated;

create or replace function public.resolve_sellertray_product_barcode(
  p_tenant_id uuid,
  p_barcode text
)
returns table(
  product_id uuid,
  uom_id uuid,
  product_name text,
  sku text,
  category text,
  stock_uom text,
  uom_name text,
  conversion_factor numeric,
  selling_price numeric,
  allow_fractional boolean,
  item_active boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_barcode text := nullif(btrim(coalesce(p_barcode,'')),'');
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
  ) then
    raise exception 'Business access denied' using errcode='42501';
  end if;

  if v_barcode is null then
    raise exception 'Scan or enter a barcode' using errcode='22023';
  end if;

  return query
  select
    ci.id,
    u.id,
    ci.name,
    ci.sku,
    ci.category,
    ci.stock_uom,
    u.uom_name,
    u.conversion_factor,
    u.selling_price,
    u.allow_fractional,
    ci.is_active
  from public.catalog_item_uoms u
  join public.catalog_items ci
    on ci.tenant_id=u.tenant_id
   and ci.id=u.catalog_item_id
  where u.tenant_id=p_tenant_id
    and btrim(u.barcode)=v_barcode
  limit 1;
end;
$$;

revoke all on function public.resolve_sellertray_product_barcode(uuid,text) from public,anon;
grant execute on function public.resolve_sellertray_product_barcode(uuid,text) to authenticated;

create or replace function public.create_sellertray_product_from_barcode(
  p_tenant_id uuid,
  p_name text,
  p_sku text,
  p_category text,
  p_stock_uom text,
  p_selling_price numeric,
  p_barcode text,
  p_allow_fractional_stock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_sku text := nullif(btrim(coalesce(p_sku,'')),'');
  v_category text := nullif(btrim(coalesce(p_category,'')),'');
  v_stock_uom text := nullif(btrim(coalesce(p_stock_uom,'')),'');
  v_barcode text := nullif(btrim(coalesce(p_barcode,'')),'');
  v_product_id uuid;
  v_uom_id uuid;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then
    raise exception 'You do not have permission to add products' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if v_name is null
     or v_stock_uom is null
     or v_barcode is null
     or p_selling_price is null
     or p_selling_price<0 then
    raise exception 'Product name, Stock UOM, barcode and a valid selling price are required' using errcode='22023';
  end if;

  if char_length(v_name)>160
     or char_length(v_stock_uom)>80
     or char_length(v_barcode)>160
     or char_length(coalesce(v_sku,''))>120
     or char_length(coalesce(v_category,''))>120 then
    raise exception 'Product details are too long' using errcode='22023';
  end if;

  if exists (
    select 1
    from public.catalog_item_uoms u
    where u.tenant_id=p_tenant_id
      and btrim(u.barcode)=v_barcode
  ) then
    raise exception 'This barcode is already assigned to a product. Open the existing product instead.' using errcode='23505';
  end if;

  v_product_id := public.save_sellertray_product(
    p_tenant_id,
    null,
    v_name,
    v_sku,
    v_category,
    v_stock_uom,
    coalesce(p_allow_fractional_stock,false),
    p_selling_price
  );

  select u.id
    into v_uom_id
  from public.catalog_item_uoms u
  where u.tenant_id=p_tenant_id
    and u.catalog_item_id=v_product_id
    and lower(btrim(u.uom_name))=lower(v_stock_uom)
  order by u.created_at,u.id
  limit 1
  for update;

  if v_uom_id is null then
    raise exception 'SellerTray could not initialise the Stock UOM' using errcode='55000';
  end if;

  update public.catalog_item_uoms u
  set barcode=v_barcode,
      updated_at=now()
  where u.tenant_id=p_tenant_id
    and u.catalog_item_id=v_product_id
    and u.id=v_uom_id;

  return jsonb_build_object(
    'productId',v_product_id,
    'uomId',v_uom_id,
    'barcode',v_barcode
  );
exception
  when unique_violation then
    raise exception 'This SKU or barcode is already used by another product' using errcode='23505';
end;
$$;

revoke all on function public.create_sellertray_product_from_barcode(uuid,text,text,text,text,numeric,text,boolean) from public,anon;
grant execute on function public.create_sellertray_product_from_barcode(uuid,text,text,text,text,numeric,text,boolean) to authenticated;

commit;
