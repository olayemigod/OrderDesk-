begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.ok(
  exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='outbound_notifications'
      and column_name='order_id'
      and is_nullable='YES'
  ),
  'non-order conversational replies can use the outbound queue'
);

select extensions.ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='outbound_notifications'
      and indexname='outbound_notifications_query_response_unique_idx'
      and indexdef ilike '%customer_enquiry_reply%'
  ),
  'customer enquiry replies are idempotent by inbound message'
);

select extensions.ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='outbound_notifications'
      and indexname='outbound_notifications_query_response_unique_idx'
      and indexdef ilike '%workflow_clarification%'
  ),
  'workflow clarification replies are idempotent by inbound message'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sellertray_kick_notification_worker()',
    'EXECUTE'
  ),
  'service backend can kick the WhatsApp notification worker immediately'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_kick_notification_worker()',
    'EXECUTE'
  ),
  'merchant clients cannot invoke the notification worker directly'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sellertray_kick_notification_worker()',
    'EXECUTE'
  ),
  'anonymous clients cannot invoke the notification worker'
);

select extensions.ok(
  position('kick_whatsapp_notification_worker' in pg_get_functiondef(
    'public.sellertray_kick_notification_worker()'::regprocedure
  )) > 0,
  'public service-role wrapper delegates to the private notification worker kick'
);

select extensions.ok(
  exists(
    select 1 from cron.job
    where jobname='sellertray-whatsapp-notification-retry'
      and active
  ),
  'cron remains as fallback retry for conversational replies'
);

select * from extensions.finish();
rollback;
