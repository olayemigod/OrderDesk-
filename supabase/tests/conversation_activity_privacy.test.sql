begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

select extensions.ok(
  to_regclass('public.conversation_activity_events') is not null
  and (select relrowsecurity from pg_class where oid='public.conversation_activity_events'::regclass),
  'privacy-safe conversation activity stream exists with RLS enabled'
);

select extensions.ok(
  has_table_privilege('authenticated','public.conversation_activity_events','SELECT')
  and not has_table_privilege('authenticated','public.inbound_messages','SELECT'),
  'merchant clients can read only the safe activity stream, not raw inbound messages'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='conversation_activity_events'
      and column_name in (
        'provider_message_id','message_type','text_body','raw_payload',
        'processing_status','processing_attempts','processing_started_at',
        'processing_completed_at','processing_error','updated_at'
      )
  ),
  'activity stream contains no provider payload, message content or processing internals'
);

select extensions.ok(
  exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='conversation_activity_events'
      and policyname='conversation_activity_events_select_member'
      and qual like '%tenant_members%'
  ),
  'activity stream remains tenant-member scoped'
);

select extensions.ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conversation_activity_events'
  )
  and not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='inbound_messages'
  ),
  'Realtime publishes only the privacy-safe conversation activity stream'
);

select * from extensions.finish();
rollback;
