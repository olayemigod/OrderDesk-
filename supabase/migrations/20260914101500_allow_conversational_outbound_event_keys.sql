alter table public.outbound_notifications
  drop constraint if exists outbound_notifications_event_key_check;

alter table public.outbound_notifications
  add constraint outbound_notifications_event_key_check
  check (event_key = any(array[
    'order_received'::text,
    'order_accepted'::text,
    'order_ready'::text,
    'order_out_for_delivery'::text,
    'order_rejected'::text,
    'order_cancelled'::text,
    'order_status_reply'::text,
    'order_receipt'::text,
    'order_change_request_received'::text,
    'payment_options'::text,
    'payment_instructions'::text,
    'payment_claim_received'::text,
    'payment_confirmed'::text,
    'payment_status_reply'::text,
    'financial_document'::text,
    'customer_enquiry_reply'::text,
    'workflow_clarification'::text
  ]));
