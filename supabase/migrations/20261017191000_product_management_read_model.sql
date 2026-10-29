begin;

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
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then
    raise exception 'You do not have permission to manage products' using errcode='42501';
  end if;
  if v_status not in ('active','archived','all') then
    raise exception 'Unknown product status filter' using errcode='22023';
  end if;

  select count(*)::integer
  into v_total
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id
    and (v_status='all' or (v_status='active' and ci.is_active) or (v_status='archived' and not ci.is_active))
    and (v_category is null or lower(btrim(coalesce(ci.category,'')))=lower(v_category))
    and (
      v_uom is null
      or lower(btrim(ci.stock_uom))=lower(v_uom)
      or exists (
        select 1
        from public.catalog_item_uoms u
        where u.tenant_id=ci.tenant_id
          and u.catalog_item_id=ci.id
          and lower(btrim(u.uom_name))=lower(v_uom)
      )
    )
    and (
      not coalesce(p_missing_barcode,false)
      or not exists (
        select 1
        from public.catalog_item_uoms u
        where u.tenant_id=ci.tenant_id
          and u.catalog_item_id=ci.id
          and nullif(btrim(coalesce(u.barcode,'')),'') is not null
      )
    )
    and (not coalesce(p_missing_price,false) or ci.price_ngn is null)
    and (
      v_search is null
      or ci.name ilike '%'||v_search||'%'
      or coalesce(ci.sku,'') ilike '%'||v_search||'%'
      or coalesce(ci.category,'') ilike '%'||v_search||'%'
      or ci.stock_uom ilike '%'||v_search||'%'
      or exists (
        select 1
        from public.catalog_item_uoms u
        where u.tenant_id=ci.tenant_id
          and u.catalog_item_id=ci.id
          and (
            u.uom_name ilike '%'||v_search||'%'
            or coalesce(u.barcode,'') ilike '%'||v_search||'%'
          )
      )
    );

  v_total_pages := greatest(1,ceil(v_total::numeric/v_page_size)::integer);
  v_page := least(v_requested_page,v_total_pages);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,
    'name',x.name,
    'sku',x.sku,
    'category',x.category,
    'stockUom',x.stock_uom,
    'sellingPrice',x.price_ngn,
    'isActive',x.is_active,
    'unitCount',x.unit_count,
    'barcodeCount',x.barcode_count
  ) order by x.is_active desc,lower(x.name),x.id),'[]'::jsonb)
  into v_items
  from (
    select
      ci.id,
      ci.name,
      ci.sku,
      ci.category,
      ci.stock_uom,
      ci.price_ngn,
      ci.is_active,
      (
        select count(*)::integer
        from public.catalog_item_uoms u
        where u.tenant_id=ci.tenant_id and u.catalog_item_id=ci.id
      ) as unit_count,
      (
        select count(*)::integer
        from public.catalog_item_uoms u
        where u.tenant_id=ci.tenant_id
          and u.catalog_item_id=ci.id
          and nullif(btrim(coalesce(u.barcode,'')),'') is not null
      ) as barcode_count
    from public.catalog_items ci
    where ci.tenant_id=p_tenant_id
      and (v_status='all' or (v_status='active' and ci.is_active) or (v_status='archived' and not ci.is_active))
      and (v_category is null or lower(btrim(coalesce(ci.category,'')))=lower(v_category))
      and (
        v_uom is null
        or lower(btrim(ci.stock_uom))=lower(v_uom)
        or exists (
          select 1
          from public.catalog_item_uoms u
          where u.tenant_id=ci.tenant_id
            and u.catalog_item_id=ci.id
            and lower(btrim(u.uom_name))=lower(v_uom)
        )
      )
      and (
        not coalesce(p_missing_barcode,false)
        or not exists (
          select 1
          from public.catalog_item_uoms u
          where u.tenant_id=ci.tenant_id
            and u.catalog_item_id=ci.id
            and nullif(btrim(coalesce(u.barcode,'')),'') is not null
        )
      )
      and (not coalesce(p_missing_price,false) or ci.price_ngn is null)
      and (
        v_search is null
        or ci.name ilike '%'||v_search||'%'
        or coalesce(ci.sku,'') ilike '%'||v_search||'%'
        or coalesce(ci.category,'') ilike '%'||v_search||'%'
        or ci.stock_uom ilike '%'||v_search||'%'
        or exists (
          select 1
          from public.catalog_item_uoms u
          where u.tenant_id=ci.tenant_id
            and u.catalog_item_id=ci.id
            and (
              u.uom_name ilike '%'||v_search||'%'
              or coalesce(u.barcode,'') ilike '%'||v_search||'%'
            )
        )
      )
    order by ci.is_active desc,lower(ci.name),ci.id
    limit v_page_size
    offset ((v_page-1)*v_page_size)
  ) x;

  select coalesce(jsonb_agg(x.category order by lower(x.category)),'[]'::jsonb)
  into v_categories
  from (
    select distinct btrim(ci.category) as category
    from public.catalog_items ci
    where ci.tenant_id=p_tenant_id
      and nullif(btrim(coalesce(ci.category,'')),'') is not null
  ) x;

  select coalesce(jsonb_agg(x.uom order by lower(x.uom)),'[]'::jsonb)
  into v_uoms
  from (
    select distinct q.uom
    from (
      select btrim(ci.stock_uom) as uom
      from public.catalog_items ci
      where ci.tenant_id=p_tenant_id
      union
      select btrim(u.uom_name) as uom
      from public.catalog_item_uoms u
      where u.tenant_id=p_tenant_id
    ) q
    where nullif(q.uom,'') is not null
  ) x;

  return jsonb_build_object(
    'page',v_page,
    'pageSize',v_page_size,
    'total',v_total,
    'totalPages',v_total_pages,
    'categories',v_categories,
    'uoms',v_uoms,
    'items',v_items
  );
end;
$$;

create or replace function public.get_sellertray_product_management_detail(
  p_tenant_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then
    raise exception 'You do not have permission to manage products' using errcode='42501';
  end if;

  select jsonb_build_object(
    'id',ci.id,
    'name',ci.name,
    'sku',ci.sku,
    'category',ci.category,
    'stockUom',ci.stock_uom,
    'allowFractionalStock',ci.allow_fractional_stock,
    'sellingPrice',ci.price_ngn,
    'isActive',ci.is_active,
    'createdAt',ci.created_at,
    'updatedAt',ci.updated_at,
    'uoms',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,
        'name',u.uom_name,
        'conversionFactor',u.conversion_factor,
        'sellingPrice',u.selling_price,
        'barcode',u.barcode,
        'allowFractional',u.allow_fractional,
        'isDefaultSelling',u.is_default_selling,
        'isDefaultPurchase',u.is_default_purchase
      ) order by
        (lower(btrim(u.uom_name))=lower(btrim(ci.stock_uom))) desc,
        u.is_default_selling desc,
        u.conversion_factor,
        lower(u.uom_name),
        u.id
      )
      from public.catalog_item_uoms u
      where u.tenant_id=ci.tenant_id
        and u.catalog_item_id=ci.id
    ),'[]'::jsonb)
  )
  into v_result
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id
    and ci.id=p_product_id;

  if v_result is null then
    raise exception 'Product not found' using errcode='22023';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)
  from public,anon;
revoke all on function public.get_sellertray_product_management_detail(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)
  to authenticated,service_role;
grant execute on function public.get_sellertray_product_management_detail(uuid,uuid)
  to authenticated,service_role;

commit;
