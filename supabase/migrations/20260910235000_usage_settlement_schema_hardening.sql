create index if not exists usage_events_tenant_source_message_idx
  on public.usage_events (tenant_id, source_message_id);

drop policy if exists billing_payment_authorizations_deny_clients on public.billing_payment_authorizations;
create policy billing_payment_authorizations_deny_clients
on public.billing_payment_authorizations
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists usage_settlements_deny_clients on public.usage_settlements;
create policy usage_settlements_deny_clients
on public.usage_settlements
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists usage_settlement_items_deny_clients on public.usage_settlement_items;
create policy usage_settlement_items_deny_clients
on public.usage_settlement_items
for all
to anon, authenticated
using (false)
with check (false);
