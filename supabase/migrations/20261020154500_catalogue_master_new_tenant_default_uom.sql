begin;

-- Keep the long-standing `Each` default available for Businesses created after
-- the catalogue-master foundation migration. This remains master data only; it
-- does not create a product UOM conversion, price or stock balance.
create or replace function public.seed_sellertray_default_uom_for_tenant()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.sellertray_uoms (tenant_id, name)
  values (new.id, 'Each')
  on conflict (tenant_id, normalized_name) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_sellertray_default_uom_for_tenant() from public, anon, authenticated;

drop trigger if exists seed_sellertray_default_uom_for_tenant on public.tenants;
create trigger seed_sellertray_default_uom_for_tenant
after insert on public.tenants
for each row
execute function public.seed_sellertray_default_uom_for_tenant();

-- Existing catalogue rows may carry case variants such as `each` while the
-- tenant master stores the canonical spelling `Each`. Return the canonical
-- master spelling to management clients without rewriting stock-linked history.
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
    'category',coalesce((
      select c.name
      from public.sellertray_product_categories c
      where c.tenant_id=ci.tenant_id
        and c.normalized_name=lower(btrim(ci.category))
      limit 1
    ),ci.category),
    'stockUom',coalesce((
      select m.name
      from public.sellertray_uoms m
      where m.tenant_id=ci.tenant_id
        and m.normalized_name=lower(btrim(ci.stock_uom))
      limit 1
    ),ci.stock_uom),
    'allowFractionalStock',ci.allow_fractional_stock,
    'sellingPrice',ci.price_ngn,
    'isActive',ci.is_active,
    'createdAt',ci.created_at,
    'updatedAt',ci.updated_at,
    'uoms',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,
        'name',coalesce((
          select m.name
          from public.sellertray_uoms m
          where m.tenant_id=u.tenant_id
            and m.normalized_name=lower(btrim(u.uom_name))
          limit 1
        ),u.uom_name),
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

revoke all on function public.get_sellertray_product_management_detail(uuid,uuid) from public, anon;
grant execute on function public.get_sellertray_product_management_detail(uuid,uuid) to authenticated, service_role;

commit;
