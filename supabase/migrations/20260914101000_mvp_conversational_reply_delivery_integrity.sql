alter table public.outbound_notifications
  alter column order_id drop not null;

drop index if exists public.outbound_notifications_query_response_unique_idx;
create unique index outbound_notifications_query_response_unique_idx
  on public.outbound_notifications(source_inbound_message_id,event_key)
  where source_inbound_message_id is not null
    and event_key in (
      'order_status_reply',
      'order_receipt',
      'payment_options',
      'payment_instructions',
      'payment_claim_received',
      'payment_status_reply',
      'financial_document',
      'customer_enquiry_reply',
      'workflow_clarification'
    );

create or replace function public.sellertray_kick_notification_worker()
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  perform sellertray_private.kick_whatsapp_notification_worker();
end;
$$;

revoke all on function public.sellertray_kick_notification_worker()
from public,anon,authenticated;
grant execute on function public.sellertray_kick_notification_worker()
to service_role;

update public.customer_enquiries e
set status='open',
    replied_at=null,
    updated_at=now()
where e.status='replied'
  and not exists(
    select 1
    from public.outbound_notifications n
    where n.tenant_id=e.tenant_id
      and n.source_inbound_message_id=e.source_inbound_message_id
      and n.event_key='customer_enquiry_reply'
      and n.delivery_status in ('sent','delivered')
  );
