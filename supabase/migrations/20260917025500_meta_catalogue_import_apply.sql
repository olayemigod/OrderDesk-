-- SellerTray: atomic application of Meta catalogue import rows after a
-- server-side Meta asset/permission probe and preview.
-- Meta retailer_id is the authoritative external identity. Manual mappings are
-- preserved, name-only collisions fail closed, and imports never delete local items.

begin;

create or replace function public.apply_sellertray_meta_catalogue_import(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_catalog_id text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $meta$
declare
  v_role text;
  v_tenant_currency text;
  v_configured_catalog text;
  v_enabled boolean;
  v_row jsonb;
  v_index integer := 0;
  v_retailer_id text;
  v_name text;
  v_currency text;
  v_category text;
  v_image_url text;
  v_price numeric(14,2);
  v_item_id uuid;
  v_mapping_source text;
  v_match_count integer;
  v_created integer := 0;
  v_updated integer := 0;
  v_linked integer := 0;
  v_preserved_manual integer := 0;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and actor are required' using errcode='22023';
  end if;

  select tm.role
  into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Only the business Owner or Manager can import a Meta catalogue'
      using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only'
      using errcode='42501';
  end if;

  select upper(t.currency)
  into v_tenant_currency
  from public.tenants t
  where t.id=p_tenant_id;

  if v_tenant_currency is null then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  select s.catalog_id,s.is_enabled
  into v_configured_catalog,v_enabled
  from public.tenant_whatsapp_catalog_settings s
  where s.tenant_id=p_tenant_id;

  if v_configured_catalog is null then
    raise exception 'Configure the Meta catalogue before importing' using errcode='23514';
  end if;
  if v_enabled is not true then
    raise exception 'The configured Meta catalogue is disabled' using errcode='23514';
  end if;
  if btrim(v_configured_catalog) <> btrim(coalesce(p_catalog_id,'')) then
    raise exception 'Import catalogue does not match the configured SellerTray catalogue'
      using errcode='23514';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Meta catalogue import rows must be an array' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Meta catalogue import must contain between 1 and 500 products'
      using errcode='22023';
  end if;

  if exists (
    select 1
    from (
      select lower(btrim(value->>'retailerId')) as retailer_id,count(*) as row_count
      from jsonb_array_elements(p_rows)
      group by lower(btrim(value->>'retailerId'))
    ) duplicates
    where duplicates.retailer_id is not null
      and duplicates.retailer_id <> ''
      and duplicates.row_count > 1
  ) then
    raise exception 'Meta catalogue import contains a duplicate retailer ID'
      using errcode='23514';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    v_retailer_id := nullif(btrim(v_row->>'retailerId'),'');
    v_name := nullif(btrim(v_row->>'name'),'');
    v_currency := upper(nullif(btrim(v_row->>'currency'),''));
    v_category := nullif(btrim(v_row->>'category'),'');
    v_image_url := nullif(btrim(v_row->>'imageUrl'),'');

    begin
      v_price := (v_row->>'price')::numeric(14,2);
    exception when others then
      raise exception 'Meta row % has an invalid price',v_index using errcode='22023';
    end;

    if v_retailer_id is null or char_length(v_retailer_id)>160 then
      raise exception 'Meta row % has an invalid retailer ID',v_index using errcode='22023';
    end if;
    if v_name is null or char_length(v_name)>240 then
      raise exception 'Meta row % has an invalid product name',v_index using errcode='22023';
    end if;
    if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
      raise exception 'Meta row % has an invalid currency',v_index using errcode='22023';
    end if;
    if v_currency <> v_tenant_currency then
      raise exception 'Meta row % currency % does not match SellerTray business currency %',
        v_index,v_currency,v_tenant_currency using errcode='23514';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Meta row % has an invalid price',v_index using errcode='22023';
    end if;
    if v_category is not null and char_length(v_category)>120 then
      raise exception 'Meta row % category is too long',v_index using errcode='22023';
    end if;
    if v_image_url is not null and char_length(v_image_url)>1000 then
      raise exception 'Meta row % image URL is too long',v_index using errcode='22023';
    end if;

    v_item_id := null;
    v_mapping_source := null;

    select ci.id,ci.whatsapp_mapping_source
    into v_item_id,v_mapping_source
    from public.catalog_items ci
    where ci.tenant_id=p_tenant_id
      and ci.whatsapp_catalog_id=v_configured_catalog
      and ci.whatsapp_product_retailer_id=v_retailer_id
    limit 1
    for update;

    if v_item_id is not null then
      if v_mapping_source='manual' then
        update public.catalog_items
        set whatsapp_last_synced_at=now(),
            updated_at=now()
        where id=v_item_id and tenant_id=p_tenant_id;
        v_preserved_manual := v_preserved_manual + 1;
      else
        update public.catalog_items
        set name=v_name,
            price_ngn=v_price,
            category=coalesce(v_category,category),
            image_url=coalesce(v_image_url,image_url),
            is_active=true,
            whatsapp_mapping_source='meta_import',
            whatsapp_last_synced_at=now(),
            updated_at=now()
        where id=v_item_id and tenant_id=p_tenant_id;
        v_updated := v_updated + 1;
      end if;
      continue;
    end if;

    select count(*),(min(ci.id::text))::uuid
    into v_match_count,v_item_id
    from public.catalog_items ci
    where ci.tenant_id=p_tenant_id
      and ci.sku is not null
      and lower(btrim(ci.sku))=lower(v_retailer_id);

    if v_match_count > 1 then
      raise exception 'Meta row % retailer ID matches more than one SellerTray SKU',
        v_index using errcode='23514';
    end if;

    if v_item_id is not null then
      if exists (
        select 1
        from public.catalog_items ci
        where ci.id=v_item_id
          and ci.tenant_id=p_tenant_id
          and ci.whatsapp_product_retailer_id is not null
          and (
            ci.whatsapp_catalog_id is distinct from v_configured_catalog
            or ci.whatsapp_product_retailer_id is distinct from v_retailer_id
          )
      ) then
        raise exception 'Meta row % retailer ID matches a SellerTray SKU already mapped to another Meta product',
          v_index using errcode='23514';
      end if;

      update public.catalog_items
      set name=v_name,
          price_ngn=v_price,
          category=coalesce(v_category,category),
          image_url=coalesce(v_image_url,image_url),
          is_active=true,
          whatsapp_catalog_id=v_configured_catalog,
          whatsapp_product_retailer_id=v_retailer_id,
          whatsapp_mapping_source='meta_import',
          whatsapp_last_synced_at=now(),
          updated_at=now()
      where id=v_item_id and tenant_id=p_tenant_id;
      v_linked := v_linked + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.catalog_items ci
      where ci.tenant_id=p_tenant_id
        and lower(btrim(ci.name))=lower(v_name)
    ) then
      raise exception 'Meta row % has the same name as an existing SellerTray product. Map it manually or align its SKU with the Meta retailer ID before importing.',
        v_index using errcode='23514';
    end if;

    insert into public.catalog_items(
      tenant_id,name,sku,category,image_url,price_ngn,is_active,
      whatsapp_catalog_id,whatsapp_product_retailer_id,
      whatsapp_mapping_source,whatsapp_last_synced_at,
      created_at,updated_at
    ) values (
      p_tenant_id,v_name,v_retailer_id,v_category,v_image_url,v_price,true,
      v_configured_catalog,v_retailer_id,'meta_import',now(),now(),now()
    );
    v_created := v_created + 1;
  end loop;

  update public.tenant_whatsapp_catalog_settings
  set sync_mode='import_from_meta',
      last_sync_at=now(),
      last_sync_status='success',
      last_sync_error=null,
      updated_by=p_actor_user_id,
      updated_at=now()
  where tenant_id=p_tenant_id;

  return jsonb_build_object(
    'created',v_created,
    'updated',v_updated,
    'linked',v_linked,
    'preservedManual',v_preserved_manual,
    'total',v_created+v_updated+v_linked+v_preserved_manual
  );
end;
$meta$;

revoke all on function public.apply_sellertray_meta_catalogue_import(uuid,uuid,text,jsonb)
from public,anon,authenticated;

grant execute on function public.apply_sellertray_meta_catalogue_import(uuid,uuid,text,jsonb)
to service_role;

commit;
