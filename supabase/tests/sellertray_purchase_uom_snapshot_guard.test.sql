begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='validate_sellertray_inventory_movement'
      and lower(pg_get_functiondef(p.oid)) like '%purchase_receipt%'
      and lower(pg_get_functiondef(p.oid)) like '%purchaseorderitemid%'
      and lower(pg_get_functiondef(p.oid)) like '%purchase receipt uom must match the frozen purchase order line%'
  ),
  'Purchase Receipt inventory movements validate against the frozen Purchase Order UOM snapshot'
);

select * from extensions.finish();
rollback;
