begin;

create or replace function public.get_sellertray_purchase_product_options(
  p_tenant_id uuid,
  p_branch_id uuid
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

  if not public.sellertray_purchase_management_role(p_tenant_id,v_user_id) then
    raise exception 'You do not have permission to manage purchasing' using errcode='42501';
  end if;

  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to manage purchasing for this Branch' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ci.id,
    'name',ci.name,
    'uoms',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,
        'name',u.uom_name,
        'conversionFactor',u.conversion_factor,
        'allowFractional',u.allow_fractional,
        'isDefaultPurchase',u.is_default_purchase
      ) order by
        u.is_default_purchase desc,
        (lower(btrim(u.uom_name))=lower(btrim(ci.stock_uom))) desc,
        u.conversion_factor,
        lower(u.uom_name),
        u.id
      )
      from public.catalog_item_uoms u
      where u.tenant_id=ci.tenant_id
        and u.catalog_item_id=ci.id
    ),'[]'::jsonb)
  ) order by lower(ci.name),ci.id),'[]'::jsonb)
  into v_result
  from public.catalog_items ci
  where ci.tenant_id=p_tenant_id
    and ci.is_active=true;

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_purchase_product_options(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_purchase_product_options(uuid,uuid)
  to authenticated,service_role;

commit;
