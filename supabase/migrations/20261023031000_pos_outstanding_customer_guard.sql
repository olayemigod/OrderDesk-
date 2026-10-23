begin;

-- A completed POS receivable must be attributable to a real shared Customer so
-- the balance can be followed up, collected, returned/refunded and reported
-- through the governed receivables authority. Fully-paid walk-in sales remain
-- valid; only Partial and Pay-later terms require a named Customer.

alter table public.orders
  drop constraint if exists orders_pos_outstanding_requires_customer;

alter table public.orders
  add constraint orders_pos_outstanding_requires_customer
  check (
    pos_payment_terms is null
    or pos_payment_terms = 'immediate'
    or customer_id is not null
  );

comment on constraint orders_pos_outstanding_requires_customer on public.orders is
  'SellerTray Partial and Pay-later POS sales require a named Customer so outstanding balances remain collectible and attributable.';

commit;
