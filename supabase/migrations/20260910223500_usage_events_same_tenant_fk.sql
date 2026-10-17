alter table public.usage_events
  drop constraint if exists usage_events_source_message_id_fkey;

alter table public.usage_events
  add constraint usage_events_tenant_source_message_fkey
  foreign key (tenant_id, source_message_id)
  references public.inbound_messages (tenant_id, id)
  on delete cascade;
