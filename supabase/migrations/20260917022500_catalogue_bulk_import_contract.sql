-- SellerTray catalogue onboarding: atomic server-side import of validated rows.

begin;

create or replace function public.import_sellertray_catalogue_rows(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row jsonb;
  v_alias jsonb;
  v_item_id uuid;
  v_match_count integer;
  v_name text;
  v_sku text;
  v_category text;
  v_image_url text;
  v_price numeric(14,2);
  v_alias_text text;
  v_created integer := 0;
  v_updated integer := 0;
  v_index integer := 0;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and actor are required' using errcode='22023';
  end if;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=p_actor_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only the business Owner or Manager can import catalogue products'
      using errcode='42501';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Catalogue import rows must be an array' using errcode='22023';
  end if;

  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Catalogue import must contain between 1 and 500 rows' using errcode='22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    v_name := nullif(btrim(v_row->>'name'),'');
    v_sku := nullif(upper(btrim(v_row->>'sku')),'');
    v_category := nullif(btrim(v_row->>'category'),'');
    v_image_url := nullif(btrim(v_row->>'imageUrl'),'');
    begin
      v_price := (v_row->>'price')::numeric(14,2);
    exception when others then
      raise exception 'Row % has an invalid price',v_index using errcode='22023';
    end;

    if v_name is null then
      raise exception 'Row % is missing product name',v_index using errcode='22023';
    end if;
    if char_length(v_name) > 240 then
      raise exception 'Row % product name is too long',v_index using errcode='22023';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Row % has an invalid price',v_index using errcode='22023';
    end if;
    if v_sku is not null and char_length(v_sku) > 120 then
      raise exception 'Row % SKU is too long',v_index using errcode='22023';
    end if;
    if v_category is not null and char_length(v_category) > 120 then
      raise exception 'Row % category is too long',v_index using errcode='22023';
    end if;
    if v_image_url is not null and char_length(v_image_url) > 1000 then
      raise exception 'Row % image URL is too long',v_index using errcode='22023';
    end if;

    v_item_id := null;
    v_match_count := 0;

    if v_sku is not null then
      select count(*),(min(ci.id::text))::uuid
      into v_match_count,v_item_id
      from public.catalog_items ci
      where ci.tenant_id=p_tenant_id
        and lower(btrim(ci.sku))=lower(v_sku);

      if v_match_count > 1 then
        raise exception 'Row % SKU matches more than one existing product',v_index using errcode='23514';
      end if;
    else
      select count(*),(min(ci.id::text))::uuid
      into v_match_count,v_item_id
      from public.catalog_items ci
      where ci.tenant_id=p_tenant_id
        and lower(btrim(ci.name))=lower(v_name);

      if v_match_count > 1 then
        raise exception 'Row % name matches more than one existing product; add SKU to disambiguate',v_index using errcode='23514';
      end if;
    end if;

    if v_item_id is null then
      insert into public.catalog_items(
        tenant_id,name,sku,category,image_url,price_ngn,is_active,created_at,updated_at
      ) values (
        p_tenant_id,v_name,v_sku,v_category,v_image_url,v_price,true,now(),now()
      )
      returning id into v_item_id;
      v_created := v_created + 1;
    else
      update public.catalog_items
      set name=v_name,
          sku=v_sku,
          category=v_category,
          image_url=coalesce(v_image_url,image_url),
          price_ngn=v_price,
          is_active=true,
          updated_at=now()
      where tenant_id=p_tenant_id and id=v_item_id;
      v_updated := v_updated + 1;
    end if;

    delete from public.catalog_item_aliases
    where tenant_id=p_tenant_id and catalog_item_id=v_item_id;

    if jsonb_typeof(v_row->'aliases')='array' then
      for v_alias in select value from jsonb_array_elements(v_row->'aliases')
      loop
        v_alias_text := nullif(btrim(v_alias #>> '{}'),'');
        if v_alias_text is null then
          continue;
        end if;
        if char_length(v_alias_text) > 240 then
          raise exception 'Row % contains an alias that is too long',v_index using errcode='22023';
        end if;

        insert into public.catalog_item_aliases(tenant_id,catalog_item_id,alias)
        values(p_tenant_id,v_item_id,v_alias_text);
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'created',v_created,
    'updated',v_updated,
    'total',v_created+v_updated
  );
end;
$$;

revoke all on function public.import_sellertray_catalogue_rows(uuid,uuid,jsonb)
from public,anon,authenticated;

grant execute on function public.import_sellertray_catalogue_rows(uuid,uuid,jsonb)
to service_role;

commit;
