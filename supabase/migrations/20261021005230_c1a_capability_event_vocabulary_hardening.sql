begin;

-- C1A adds explicit commercial-agreement signing authority to the governed
-- member capability model. Keep the immutable capability-event ledger aligned
-- with the same vocabulary so Owner delegation remains auditable instead of
-- failing after the capability override has been written.
alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
  check (capability = any (array[
    'can_receive_stock'::text,
    'can_adjust_stock'::text,
    'can_count_stock'::text,
    'can_apply_stock_count'::text,
    'can_transfer_stock'::text,
    'can_open_shift'::text,
    'can_record_cash_movement'::text,
    'can_record_expense'::text,
    'can_correct_cash_movement'::text,
    'can_close_shift'::text,
    'can_review_shift'::text,
    'can_print_receipt'::text,
    'can_manage_devices'::text,
    'can_manage_orders'::text,
    'can_manage_products'::text,
    'can_manage_purchasing'::text,
    'can_manage_payments'::text,
    'can_view_reports'::text,
    'can_refund_sale'::text,
    'can_accept_commercial_agreements'::text
  ]));

commit;
