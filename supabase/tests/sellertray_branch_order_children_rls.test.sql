begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(
  (select qual ilike '%sellertray_current_user_can_read_branch%'
   from pg_policies
   where schemaname='public'
     and tablename='order_status_events'
     and policyname='order_status_events_select_member'),
  'order status history inherits current-user historical parent-order Branch access'
);

select extensions.ok(
  (select qual ilike '%sellertray_current_user_can_read_branch%'
   from pg_policies
   where schemaname='public'
     and tablename='outbound_notifications'
     and policyname='outbound_notifications_select_member'),
  'outbound notifications inherit current-user historical parent-order Branch access'
);

select extensions.ok(
  (select qual ilike '%sellertray_current_user_can_read_branch%'
   from pg_policies
   where schemaname='public'
     and tablename='order_financial_documents'
     and policyname='order_financial_documents_select_member'),
  'order financial documents inherit current-user historical parent-order Branch access'
);

select extensions.ok(
  (select qual ilike '%sellertray_current_user_can_read_branch%'
   from pg_policies
   where schemaname='public'
     and tablename='order_payments'
     and policyname='order_payments_select_member'),
  'order payments inherit current-user historical parent-order Branch access'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.order_status_events'::regclass),
  'order status history keeps RLS enabled'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.outbound_notifications'::regclass),
  'outbound notifications keep RLS enabled'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.order_financial_documents'::regclass),
  'order financial documents keep RLS enabled'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.order_payments'::regclass),
  'order payments keep RLS enabled'
);

select extensions.ok(
  has_table_privilege('authenticated','public.order_status_events','SELECT')
    and not has_table_privilege('authenticated','public.order_status_events','INSERT')
    and not has_table_privilege('authenticated','public.order_status_events','UPDATE')
    and not has_table_privilege('authenticated','public.order_status_events','DELETE'),
  'authenticated order status history access remains read-only'
);

select extensions.ok(
  has_table_privilege('authenticated','public.outbound_notifications','SELECT')
    and not has_table_privilege('authenticated','public.outbound_notifications','INSERT')
    and not has_table_privilege('authenticated','public.outbound_notifications','UPDATE')
    and not has_table_privilege('authenticated','public.outbound_notifications','DELETE'),
  'authenticated outbound notification access remains read-only'
);

select extensions.ok(
  has_table_privilege('authenticated','public.order_financial_documents','SELECT')
    and not has_table_privilege('authenticated','public.order_financial_documents','INSERT')
    and not has_table_privilege('authenticated','public.order_financial_documents','UPDATE')
    and not has_table_privilege('authenticated','public.order_financial_documents','DELETE'),
  'authenticated financial document access remains read-only'
);

select extensions.ok(
  has_table_privilege('authenticated','public.order_payments','SELECT')
    and not has_table_privilege('authenticated','public.order_payments','INSERT')
    and not has_table_privilege('authenticated','public.order_payments','UPDATE')
    and not has_table_privilege('authenticated','public.order_payments','DELETE'),
  'authenticated order payment access remains read-only'
);

select * from extensions.finish();
rollback;