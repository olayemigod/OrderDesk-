-- SellerTray P1 privacy hardening phase B: execute only when the matching mobile
-- build that subscribes to conversation_activity_events is ready for QA use.

-- Conversation history and unread counts continue through guarded RPCs; merchant
-- clients no longer need direct table access to raw WhatsApp provider records.
revoke select on table public.inbound_messages from authenticated;
drop policy if exists inbound_messages_select_member on public.inbound_messages;

-- Remove raw inbound messages from Realtime after the mobile client has moved to
-- the minimal activity stream introduced in phase A.
do $do$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inbound_messages'
  ) then
    execute 'alter publication supabase_realtime drop table public.inbound_messages';
  end if;
end
$do$;
