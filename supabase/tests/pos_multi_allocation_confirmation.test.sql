begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(2);

select extensions.ok(
  not exists(
    select 1 from pg_indexes
    where schemaname='public' and tablename='order_payments'
      and indexname='order_payments_one_confirmed_per_order'
  ),
  'split settlement is not blocked by a one-confirmed-payment-per-order index'
);

select extensions.ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public' and tablename='order_payments'
      and indexname='order_payments_confirmed_order_idx'
  ),
  'confirmed allocations retain an order lookup index'
);

select * from extensions.finish();
rollback;
