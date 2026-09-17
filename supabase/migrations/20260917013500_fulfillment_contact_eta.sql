-- SellerTray MVP competitive hardening: capture delivery contact and ETA
-- without adding a logistics marketplace dependency.

begin;

alter table public.orders
  add column if not exists delivery_contact_name text,
  add column if not exists delivery_contact_phone text,
  add column if not exists estimated_delivery_at timestamptz;

alter table public.orders
  drop constraint if exists orders_delivery_contact_name_length_check,
  add constraint orders_delivery_contact_name_length_check
    check (delivery_contact_name is null or char_length(delivery_contact_name) <= 120),
  drop constraint if exists orders_delivery_contact_phone_length_check,
  add constraint orders_delivery_contact_phone_length_check
    check (delivery_contact_phone is null or char_length(delivery_contact_phone) <= 50);

commit;
