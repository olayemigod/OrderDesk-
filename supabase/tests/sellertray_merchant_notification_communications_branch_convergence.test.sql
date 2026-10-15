begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.ok(
  to_regclass('public.platform_merchant_campaigns') is not null,
  'platform merchant campaign source schema exists'
);

select extensions.is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema='public'
      and table_name='merchant_notifications'
      and column_name in (
        'message_type','action_label','action_url','campaign_id',
        'audience_roles','expires_at','branch_id'
      )
  ),
  7,
  'merchant notifications preserve communications fields and Branch attribution'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.merchant_notifications'::regclass
      and conname='merchant_notifications_campaign_id_fkey'
  ),
  'merchant notification campaign link is governed by a foreign key'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.merchant_notifications'::regclass
      and conname='merchant_notifications_branch_same_tenant'
  ),
  'merchant notification Branch link is tenant-safe'
);

select extensions.ok(
  (
    select pg_get_constraintdef(oid) ilike '%platform_promotion%'
    from pg_constraint
    where conrelid='public.merchant_notifications'::regclass
      and conname='merchant_notifications_event_check'
  ),
  'notification event vocabulary retains platform communication events'
);

select extensions.ok(
  (
    select pg_get_constraintdef(oid) ilike '%promotion%'
    from pg_constraint
    where conrelid='public.merchant_notifications'::regclass
      and conname='merchant_notifications_message_type_check'
  ),
  'notification message-type vocabulary retains platform communications'
);

select extensions.ok(
  not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='merchant_notifications'
      and policyname='merchant_notifications_member_read'
  ),
  'legacy tenant-wide notification read policy is absent'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname='public'
      and tablename='merchant_notifications'
      and cmd='SELECT'
  ),
  1,
  'merchant notifications expose one authenticated SELECT policy'
);

select extensions.ok(
  (
    select qual ilike '%sellertray_current_user_can_access_notification_scope%'
      and qual ilike '%expires_at%'
      and qual ilike '%audience_roles%'
    from pg_policies
    where schemaname='public'
      and tablename='merchant_notifications'
      and policyname='merchant_notifications_select_member'
  ),
  'notification SELECT policy combines Branch, expiry and audience scope'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute arbitrary-user notification authority'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_current_user_can_access_notification_scope(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated can execute the auth-bound notification wrapper'
);

select extensions.ok(
  (
    select p.prosrc ilike '%sellertray_user_can_read_branch%'
      and p.prosrc not ilike '%sellertray_user_can_access_branch%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sellertray_user_can_access_notification_scope'
      and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_branch_id uuid, p_user_id uuid'
  ),
  'notification inbox authority preserves historical Branch read access'
);

select extensions.ok(
  (
    select p.prosrc ilike '%sellertray_user_can_access_branch%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sellertray_user_can_receive_notification_scope'
      and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_branch_id uuid, p_user_id uuid'
  ),
  'push delivery authority remains limited to active Branch access'
);

select extensions.ok(
  (
    select pg_get_function_result(p.oid) ilike '%message_type text%'
      and pg_get_function_result(p.oid) ilike '%action_label text%'
      and pg_get_function_result(p.oid) ilike '%action_url text%'
      and pg_get_function_result(p.oid) ilike '%campaign_id uuid%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sellertray_list_merchant_notifications'
      and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_limit integer'
  ),
  'notification list RPC retains the wider communications return contract'
);

select extensions.ok(
  (
    select p.prosrc ilike '%sellertray_current_user_can_access_notification_scope%'
      and p.prosrc ilike '%expires_at%'
      and p.prosrc ilike '%audience_roles%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sellertray_list_merchant_notifications'
      and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_limit integer'
  ),
  'notification list RPC enforces Branch, expiry and audience scope'
);

select extensions.ok(
  (
    select p.prosrc ilike '%sellertray_current_user_can_access_notification_scope%'
      and p.prosrc ilike '%expires_at%'
      and p.prosrc ilike '%audience_roles%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sellertray_mark_merchant_notification_read'
      and pg_get_function_identity_arguments(p.oid)='p_notification_id uuid'
  ),
  'single-notification read command enforces Branch, expiry and audience scope'
);

select extensions.ok(
  (
    select p.prosrc ilike '%sellertray_user_can_access_notification_scope%'
      and p.prosrc ilike '%expires_at%'
      and p.prosrc ilike '%audience_roles%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sellertray_unread_notification_count_for_user'
      and pg_get_function_identity_arguments(p.oid)='p_user_id uuid'
  ),
  'service unread counter preserves historical Branch, expiry and audience scope'
);

select extensions.ok(
  (
    select p.prosrc ilike '%sellertray_user_can_receive_notification_scope%'
      and p.prosrc ilike '%expires_at%'
      and p.prosrc ilike '%audience_roles%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='queue_sellertray_merchant_push_dispatches'
      and pg_get_function_identity_arguments(p.oid)=''
  ),
  'push dispatch combines active Branch, expiry and audience scope'
);

select extensions.ok(
  to_regprocedure(
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)'
  ) is not null,
  'idempotent platform merchant publish command exists in source'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'platform merchant publish remains service-role-only'
);

select * from extensions.finish();
rollback;
