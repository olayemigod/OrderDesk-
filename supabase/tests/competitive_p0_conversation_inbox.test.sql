begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(21);

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

select * from extensions.finish();
rollback;
