begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

select extensions.ok(
  has_function_privilege('authenticated','public.cancel_sellertray_purchase_order(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.cancel_sellertray_purchase_order(uuid,uuid)','EXECUTE'),
  'Purchase Order cancellation is available only to authenticated governed sessions'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='cancel_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_require_purchasing_management%'
      and lower(pg_get_functiondef(p.oid)) like '%status=''cancelled''%'
  ),
  'Purchase Order cancellation uses the purchasing authority boundary and records cancelled status'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='cancel_sellertray_purchase_order'
      and (
        lower(pg_get_functiondef(p.oid)) like '%delete from public.purchase_receipts%'
        or lower(pg_get_functiondef(p.oid)) like '%delete from public.purchase_receipt_items%'
        or lower(pg_get_functiondef(p.oid)) like '%delete from public.inventory_movements%'
      )
  ),
  'cancelling remaining Purchase Order quantity cannot delete posted receipt or stock history'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='cancel_sellertray_purchase_order'
      and lower(pg_get_functiondef(p.oid)) like '%received%'
      and lower(pg_get_functiondef(p.oid)) like '%cancelled%'
      and lower(pg_get_functiondef(p.oid)) like '%cannot be cancelled%'
  ),
  'fully received and already-cancelled Purchase Orders remain terminal'
);

select * from extensions.finish();
rollback;
