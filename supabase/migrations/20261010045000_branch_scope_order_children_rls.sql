begin;

-- Order-linked child records inherit the parent order's Branch boundary. Keep
-- their existing authenticated grants unchanged; this migration only narrows
-- which rows an authenticated merchant user can read.
drop policy if exists order_status_events_select_member on public.order_status_events;
create policy order_status_events_select_member
on public.order_status_events
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_status_events.tenant_id
      and o.id = order_status_events.order_id
      and public.sellertray_user_can_access_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

drop policy if exists outbound_notifications_select_member on public.outbound_notifications;
create policy outbound_notifications_select_member
on public.outbound_notifications
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = outbound_notifications.tenant_id
      and o.id = outbound_notifications.order_id
      and public.sellertray_user_can_access_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

drop policy if exists order_financial_documents_select_member on public.order_financial_documents;
create policy order_financial_documents_select_member
on public.order_financial_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_financial_documents.tenant_id
      and o.id = order_financial_documents.order_id
      and public.sellertray_user_can_access_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

drop policy if exists order_payments_select_member on public.order_payments;
create policy order_payments_select_member
on public.order_payments
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_payments.tenant_id
      and o.id = order_payments.order_id
      and public.sellertray_user_can_access_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

commit;
