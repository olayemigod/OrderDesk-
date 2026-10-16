begin;

-- A sale may be settled by multiple confirmed allocations. The authoritative
-- invariant is that their confirmed total must not exceed the issued invoice;
-- guard_sellertray_payment_transition enforces that amount boundary.
drop index if exists public.order_payments_one_confirmed_per_order;

create index if not exists order_payments_confirmed_order_idx
  on public.order_payments(order_id,confirmed_at desc,id)
  where status='confirmed';

commit;
