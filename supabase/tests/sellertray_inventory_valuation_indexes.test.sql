begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

select extensions.ok(
  to_regclass('public.sellertray_inventory_valuation_entries_position_idx') is not null,
  'valuation entries cover the stock-position foreign key with an index'
);

select extensions.ok(
  to_regclass('public.sellertray_inventory_valuation_state_item_idx') is not null,
  'valuation state covers the Product foreign key with an index'
);

select extensions.ok(
  to_regclass('public.sellertray_inventory_valuation_state_last_movement_idx') is not null,
  'valuation state covers the last movement foreign key with an index'
);

select * from extensions.finish();
rollback;
