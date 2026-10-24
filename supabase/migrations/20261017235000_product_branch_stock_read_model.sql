begin;

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
    ),'[]'::jsonb),
    'branchStock',coalesce((
      select jsonb_agg(jsonb_build_object(
        'branchId',bs.branch_id,
        'branchCode',bs.branch_code,
        'branchName',bs.branch_name,
        'isDefault',bs.is_default,
        'isActive',bs.is_active,
        'quantityOnHand',bs.quantity_on_hand,
        'lastMovementAt',bs.last_movement_at
      ) order by bs.is_default desc,bs.is_active desc,lower(bs.branch_name),bs.branch_id)
      from (
        select
          b.id as branch_id,
          b.code as branch_code,
          b.name as branch_name,
          b.is_default,
          b.is_active,
          coalesce(sum(im.quantity_delta),0)::numeric as quantity_on_hand,
          max(im.business_at) as last_movement_at
        from public.branches b
        left join public.inventory_movements im
          on im.tenant_id=b.tenant_id
         and im.branch_id=b.id
         and im.catalog_item_id=ci.id
        where b.tenant_id=p_tenant_id
          and public.sellertray_user_can_read_branch(p_tenant_id,b.id,v_user_id)
        group by b.id,b.code,b.name,b.is_default,b.is_active
      ) bs
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

revoke all on function public.get_sellertray_product_management_detail(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_product_management_detail(uuid,uuid)
  to authenticated,service_role;

commit;
