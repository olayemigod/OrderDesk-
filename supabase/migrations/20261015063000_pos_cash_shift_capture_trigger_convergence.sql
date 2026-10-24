begin;

-- Historical production databases can contain the governed cash-shift tables
-- while missing the capture triggers from the original foundation. The later
-- POS cash reconciliation migration updates the trigger functions but assumes
-- the foundation trigger wiring still exists. Reassert that wiring here so
-- expected drawer cash is fed by immutable POS cash-sale/refund evidence.

drop trigger if exists capture_sellertray_shift_cash_sale on public.order_payments;
create trigger capture_sellertray_shift_cash_sale
after insert or update of status on public.order_payments
for each row execute function public.capture_sellertray_shift_cash_sale();

drop trigger if exists capture_sellertray_shift_cash_refund on public.payment_refunds;
create trigger capture_sellertray_shift_cash_refund
after insert on public.payment_refunds
for each row execute function public.capture_sellertray_shift_cash_refund();

commit;
