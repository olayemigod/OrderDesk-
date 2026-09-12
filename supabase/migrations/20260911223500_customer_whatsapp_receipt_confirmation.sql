-- SellerTray: customer WhatsApp receipt confirmation provenance.

alter table public.orders
  add column if not exists fulfillment_confirmed_by text,
  add column if not exists customer_confirmed_at timestamptz,
  add column if not exists customer_confirmation_message_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_fulfillment_confirmed_by_check'
  ) then
    alter table public.orders
      add constraint orders_fulfillment_confirmed_by_check
      check (
        fulfillment_confirmed_by is null
        or fulfillment_confirmed_by = any (
          array['merchant'::text, 'customer_whatsapp'::text]
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_customer_confirmation_message_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_customer_confirmation_message_id_fkey
      foreign key (customer_confirmation_message_id)
      references public.inbound_messages(id)
      on delete set null;
  end if;
end $$;


create index if not exists orders_customer_confirmation_message_idx
  on public.orders(customer_confirmation_message_id)
  where customer_confirmation_message_id is not null;
