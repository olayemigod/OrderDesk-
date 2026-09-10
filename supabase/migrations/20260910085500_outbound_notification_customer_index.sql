create index if not exists outbound_notifications_tenant_customer_idx
  on public.outbound_notifications (tenant_id, customer_id);
