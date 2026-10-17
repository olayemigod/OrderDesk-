begin;

create index if not exists sellertray_inventory_valuation_entries_position_idx
  on public.sellertray_inventory_valuation_entries(tenant_id,branch_id,stock_location_id);

create index if not exists sellertray_inventory_valuation_state_item_idx
  on public.sellertray_inventory_valuation_state(tenant_id,catalog_item_id);

create index if not exists sellertray_inventory_valuation_state_last_movement_idx
  on public.sellertray_inventory_valuation_state(last_movement_id);

commit;
