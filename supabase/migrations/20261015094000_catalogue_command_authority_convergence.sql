begin;

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
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then
    raise exception 'You do not have permission to manage products' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if jsonb_typeof(v_aliases)<>'array' then
    raise exception 'Product aliases must be a list' using errcode='22023';
  end if;
  v_alias_count := jsonb_array_length(v_aliases);
  if v_alias_count>100 then
    raise exception 'A product can have at most 100 aliases' using errcode='22023';
  end if;
  select count(*)::integer into v_invalid_alias_count
  from jsonb_array_elements(v_aliases) a(value)
  where jsonb_typeof(a.value)<>'string'
     or char_length(btrim(a.value #>> '{}'))>160;
  if v_invalid_alias_count>0 then
    raise exception 'Product aliases must be text values no longer than 160 characters' using errcode='22023';
  end if;
  if char_length(coalesce(v_image_url,''))>2048 then
    raise exception 'Product image URL is too long' using errcode='22023';
  end if;

  if v_product_id is not null then
    select ci.stock_uom,ci.allow_fractional_stock
      into v_stock_uom,v_allow_fractional_stock
    from public.catalog_items ci
    where ci.tenant_id=p_tenant_id and ci.id=v_product_id;
    if not found then raise exception 'Product not found' using errcode='22023'; end if;
  end if;

  v_product_id := public.save_sellertray_product(
    p_tenant_id,v_product_id,p_name,p_sku,p_category,
    v_stock_uom,v_allow_fractional_stock,p_selling_price
  );

  update public.catalog_items ci
  set image_url=v_image_url,updated_at=now()
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

revoke all on function public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)
  from public,anon;
grant execute on function public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)
  to authenticated;

revoke all privileges on table public.catalog_item_aliases from anon,authenticated;
grant select on table public.catalog_item_aliases to authenticated;

drop policy if exists catalog_item_aliases_insert_owner_manager on public.catalog_item_aliases;
drop policy if exists catalog_item_aliases_update_owner_manager on public.catalog_item_aliases;
drop policy if exists catalog_item_aliases_delete_owner_manager on public.catalog_item_aliases;
drop policy if exists catalog_item_aliases_manage_management on public.catalog_item_aliases;

commit;
