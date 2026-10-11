-- SellerTray inventory UOM integrity.
-- Protect the immutable ledger even when a privileged server path inserts
-- directly instead of using record_sellertray_inventory_movement().

create or replace function public.validate_sellertray_inventory_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stock_uom text;
  v_configured_factor numeric(18,6);
begin
  select ci.stock_uom
  into v_stock_uom
  from public.catalog_items ci
  where ci.tenant_id = new.tenant_id
    and ci.id = new.catalog_item_id;

  if v_stock_uom is null then
    raise exception 'Product does not belong to this business' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.stock_locations sl
    where sl.tenant_id = new.tenant_id
      and sl.branch_id = new.branch_id
      and sl.id = new.stock_location_id
      and sl.is_active = true
  ) then
    raise exception 'Stock location is unavailable for this branch' using errcode = '23514';
  end if;

  new.stock_uom := v_stock_uom;
  new.source_uom := btrim(new.source_uom);
  new.reference_type := btrim(new.reference_type);
  new.reference_id := btrim(new.reference_id);
  new.idempotency_key := btrim(new.idempotency_key);

  select u.conversion_factor
  into v_configured_factor
  from public.catalog_item_uoms u
  where u.tenant_id = new.tenant_id
    and u.catalog_item_id = new.catalog_item_id
    and lower(btrim(u.uom_name)) = lower(new.source_uom)
  limit 1;

  if v_configured_factor is null then
    raise exception 'Source unit is not configured for this product' using errcode = '23514';
  end if;

  if new.conversion_factor <> v_configured_factor then
    raise exception 'Inventory conversion factor does not match the configured product unit'
      using errcode = '23514';
  end if;

  if round(abs(new.quantity_delta)::numeric, 6)
     <> round((new.source_quantity * new.conversion_factor)::numeric, 6) then
    raise exception 'Stock UOM quantity does not match source quantity and conversion factor'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_sellertray_inventory_movement()
  from public, anon, authenticated;

drop trigger if exists validate_sellertray_inventory_movement on public.inventory_movements;
create trigger validate_sellertray_inventory_movement
before insert on public.inventory_movements
for each row execute function public.validate_sellertray_inventory_movement();
