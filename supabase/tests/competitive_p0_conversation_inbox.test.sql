begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(30);

select extensions.ok(
  to_regclass('public.conversation_work_states') is not null,
  'conversation work-state table exists'
);
select extensions.ok(
  to_regclass('public.conversation_work_events') is not null,
  'conversation work-event audit table exists'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.conversation_work_states'::regclass),
  'conversation work states keep RLS enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.conversation_work_events'::regclass),
  'conversation work events keep RLS enabled'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.conversation_work_states','SELECT'),
  'authenticated clients cannot read work-state table directly'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.conversation_work_events','SELECT'),
  'authenticated clients cannot read work-event table directly'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_list_conversations(uuid,integer)',
    'EXECUTE'
  ),
  'authenticated members can list conversations through the guarded RPC'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_update_conversation_work_state(uuid,uuid,text,uuid,text)',
    'EXECUTE'
  ),
  'authenticated members can use guarded conversation actions'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_apply_conversation_service_action(uuid,uuid,text,uuid,uuid,text)',
    'EXECUTE'
  ),
  'service conversation action RPC is not exposed to authenticated clients'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sellertray_apply_conversation_service_action(uuid,uuid,text,uuid,uuid,text)',
    'EXECUTE'
  ),
  'service role can apply server conversation actions'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_note_conversation_inbound(uuid,uuid,boolean)',
    'EXECUTE'
  ),
  'inbound work-state mutation is server-only'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sellertray_note_conversation_inbound(uuid,uuid,boolean)',
    'EXECUTE'
  ),
  'service role can note inbound conversation state'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_list_conversation_messages(uuid,uuid,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.sellertray_list_conversation_messages(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'conversation history is available only through the authenticated tenant-guarded RPC'
);
select extensions.ok(
  position('inbound_messages' in pg_get_functiondef('public.sellertray_list_conversation_messages(uuid,uuid,integer)'::regprocedure)) > 0
  and position('outbound_notifications' in pg_get_functiondef('public.sellertray_list_conversation_messages(uuid,uuid,integer)'::regprocedure)) > 0
  and position('merchant_conversation_reply' in pg_get_functiondef('public.sellertray_list_conversation_messages(uuid,uuid,integer)'::regprocedure)) > 0
  and position('tenant_members' in pg_get_functiondef('public.sellertray_list_conversation_messages(uuid,uuid,integer)'::regprocedure)) > 0,
  'conversation history combines customer and outbound messages while retaining tenant membership enforcement'
);
select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='customer_enquiries'
      and column_name='clarification_candidates'
      and data_type='jsonb'
  ),
  'customer enquiries persist safe variant clarification candidates'
);
select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='orders'
      and column_name='delivery_contact_name'
  ),
  'orders store delivery contact name'
);
select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='orders'
      and column_name='delivery_contact_phone'
  ),
  'orders store delivery contact phone'
);
select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='orders'
      and column_name='estimated_delivery_at'
      and data_type='timestamp with time zone'
  ),
  'orders store estimated delivery timestamp'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.import_sellertray_catalogue_rows(uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'catalogue bulk import mutation is not exposed directly to authenticated clients'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.import_sellertray_catalogue_rows(uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'service role can execute the governed catalogue import transaction'
);
select extensions.ok(
  not exists (
    select 1
    from public.sellertray_intent_vocab
    where intent='order_cancel'
      and active=true
      and lower(btrim(phrase)) in ('dont worry','no need','leave it')
  ),
  'ambiguous social phrases are not active destructive cancellation vocabulary'
);
select extensions.ok(
  exists (
    select 1
    from public.sellertray_intent_vocab
    where intent='general_chatter'
      and active=true
      and lower(btrim(phrase))='dont worry'
  ),
  'dont worry remains understood as non-destructive chatter'
);
select extensions.ok(
  position('delivery_provider' in pg_get_functiondef('public.queue_sellertray_fulfillment_notification()'::regprocedure)) > 0
  and position('delivery_contact_name' in pg_get_functiondef('public.queue_sellertray_fulfillment_notification()'::regprocedure)) > 0
  and position('delivery_contact_phone' in pg_get_functiondef('public.queue_sellertray_fulfillment_notification()'::regprocedure)) > 0
  and position('delivery_reference' in pg_get_functiondef('public.queue_sellertray_fulfillment_notification()'::regprocedure)) > 0
  and position('estimated_delivery_at' in pg_get_functiondef('public.queue_sellertray_fulfillment_notification()'::regprocedure)) > 0
  and position('reply RECEIVED' in pg_get_functiondef('public.queue_sellertray_fulfillment_notification()'::regprocedure)) > 0,
  'out-for-delivery customer update includes captured dispatch details and receipt confirmation'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.confirm_sellertray_offline_payment(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot call offline payment confirmation directly'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.confirm_sellertray_offline_payment(uuid,uuid,text)',
    'EXECUTE'
  ),
  'service role can execute the governed offline payment confirmation command'
);
select extensions.ok(
  position('tenant_members' in pg_get_functiondef('public.confirm_sellertray_offline_payment(uuid,uuid,text)'::regprocedure)) > 0
  and position('owner' in pg_get_functiondef('public.confirm_sellertray_offline_payment(uuid,uuid,text)'::regprocedure)) > 0
  and position('manager' in pg_get_functiondef('public.confirm_sellertray_offline_payment(uuid,uuid,text)'::regprocedure)) > 0,
  'offline payment confirmation verifies tenant role and restricts manual money authority to Owner or Manager'
);
select extensions.ok(
  to_regclass('public.platform_merchant_campaigns') is not null
  and (select relrowsecurity from pg_class where oid='public.platform_merchant_campaigns'::regclass)
  and not has_table_privilege('authenticated','public.platform_merchant_campaigns','SELECT'),
  'platform merchant campaigns are RLS-enabled and hidden from merchant clients'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz)',
    'EXECUTE'
  ),
  'platform-wide merchant publishing is service-only'
);
select extensions.ok(
  position('platform_admins' in pg_get_functiondef('public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz)'::regprocedure)) > 0
  and position('merchant_message_published' in pg_get_functiondef('public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz)'::regprocedure)) > 0,
  'merchant message publishing verifies platform administrator authority and writes an audit event'
);
select extensions.ok(
  position('audience_roles' in pg_get_functiondef('public.sellertray_list_merchant_notifications(uuid,integer)'::regprocedure)) > 0
  and position('expires_at' in pg_get_functiondef('public.sellertray_list_merchant_notifications(uuid,integer)'::regprocedure)) > 0
  and position('message_type' in pg_get_functiondef('public.sellertray_list_merchant_notifications(uuid,integer)'::regprocedure)) > 0,
  'merchant notification inbox respects role audiences, expiry and platform message metadata'
);

select * from extensions.finish();
rollback;