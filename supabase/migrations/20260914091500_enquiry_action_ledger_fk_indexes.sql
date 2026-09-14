-- Cover new SellerTray enquiry/audit foreign keys for operational joins and deletes.
create index if not exists customer_enquiries_customer_fk_idx
  on public.customer_enquiries(customer_id);
create index if not exists customer_enquiries_source_message_fk_idx
  on public.customer_enquiries(source_inbound_message_id);
create index if not exists customer_enquiries_intent_event_fk_idx
  on public.customer_enquiries(intent_event_id)
  where intent_event_id is not null;

create index if not exists commercial_action_ledger_customer_fk_idx
  on public.commercial_action_ledger(customer_id)
  where customer_id is not null;
create index if not exists commercial_action_ledger_intent_event_fk_idx
  on public.commercial_action_ledger(intent_event_id)
  where intent_event_id is not null;
