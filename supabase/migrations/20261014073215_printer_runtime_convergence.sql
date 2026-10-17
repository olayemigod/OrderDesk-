begin;

-- Hosted QA skipped the historical printer foundation. The full foundation is
-- still defined by 20261009202000 on clean installs; this convergence records
-- the hosted repair and preserves the complete later permission vocabulary.
alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock',
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_review_shift',
      'can_print_receipt',
      'can_manage_devices',
      'can_manage_orders'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock',
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_review_shift',
      'can_print_receipt',
      'can_manage_devices',
      'can_manage_orders'
    ));

commit;
