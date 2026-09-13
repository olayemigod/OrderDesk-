-- SellerTray MVP: capture how each order reached the customer.
-- Existing completed orders remain valid with fulfillment_status = 'unassigned'.

alter table public.orders
  add column if not exists fulfillment_method text,
  add column if not exists fulfillment_status text not null default 'unassigned',
  add column if not exists delivery_provider text,
  add column if not exists delivery_reference text,
  add column if not exists delivery_note text,
  add column if not exists dispatched_at timestamptz,
  add column if not exists fulfilled_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_fulfillment_method_check'
  ) then
    alter table public.orders
      add constraint orders_fulfillment_method_check
      check (
        fulfillment_method is null
        or fulfillment_method = any (
          array[
            'customer_pickup'::text,
            'merchant_delivery'::text,
            'third_party_delivery'::text
          ]
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_fulfillment_status_check'
  ) then
    alter table public.orders
      add constraint orders_fulfillment_status_check
      check (
        fulfillment_status = any (
          array[
            'unassigned'::text,
            'out_for_delivery'::text,
            'delivered'::text,
            'collected'::text
          ]
        )
      );
  end if;
end $$;
