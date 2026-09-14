begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.ok(
  exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='commercial_action_ledger'
      and column_name='actor_user_id'
  ),
  'commercial action ledger stores the concrete actor user id'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.commercial_action_ledger'::regclass),
  'commercial action ledger keeps RLS enabled'
);

select extensions.ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='commercial_action_ledger'
      and indexname='commercial_action_ledger_actor_idx'
  ),
  'commercial action actor index exists'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.orders'::regclass
      and tgname='audit_sellertray_order_status_transition'
      and not tgisinternal
  ),
  'order status transitions are audited'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.order_payments'::regclass
      and tgname='audit_sellertray_payment_outcome'
      and not tgisinternal
  ),
  'payment outcomes are audited'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.customer_order_change_requests'::regclass
      and tgname='audit_sellertray_change_request_insert'
      and not tgisinternal
  ),
  'customer change requests are audited at creation'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.customer_order_change_requests'::regclass
      and tgname='audit_sellertray_change_request_update'
      and not tgisinternal
  ),
  'customer change request resolutions are audited'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.order_items'::regclass
      and tgname='audit_sellertray_order_item_commercial_change'
      and not tgisinternal
  ),
  'merchant order item changes are audited'
);

select extensions.ok(
  position('actor_user_id' in pg_get_functiondef(
    'public.audit_sellertray_payment_outcome()'::regprocedure
  )) > 0,
  'payment audit records the confirming actor'
);

select extensions.ok(
  position('financial_impact' in pg_get_functiondef(
    'public.audit_sellertray_payment_outcome()'::regprocedure
  )) > 0,
  'payment audit records financial impact'
);

select extensions.ok(
  position('before_state' in pg_get_functiondef(
    'public.audit_sellertray_order_status_transition()'::regprocedure
  )) > 0
  and position('after_state' in pg_get_functiondef(
    'public.audit_sellertray_order_status_transition()'::regprocedure
  )) > 0,
  'order status audit records before and after state'
);

select extensions.ok(
  position('before_state' in pg_get_functiondef(
    'public.audit_sellertray_order_item_commercial_change()'::regprocedure
  )) > 0
  and position('after_state' in pg_get_functiondef(
    'public.audit_sellertray_order_item_commercial_change()'::regprocedure
  )) > 0,
  'order item audit records before and after state'
);

select extensions.ok(
  position('Resolve the existing payment' in pg_get_functiondef(
    'public.guard_order_status_transition()'::regprocedure
  )) > 0,
  'paid/payment-sensitive orders cannot be cancelled blindly'
);

select extensions.ok(
  position('verification_required' in pg_get_functiondef(
    'public.guard_order_status_transition()'::regprocedure
  )) > 0,
  'cancellation guard protects unresolved customer payment claims'
);

select extensions.ok(
  position('Owner or Manager access is required for commercial audit' in pg_get_functiondef(
    'public.sellertray_list_commercial_actions(uuid,integer)'::regprocedure
  )) > 0,
  'commercial audit read model remains management-only'
);

select extensions.ok(
  position('actor_user_id' in pg_get_function_result(
    'public.sellertray_list_commercial_actions(uuid,integer)'::regprocedure
  )) > 0,
  'commercial audit read model returns actor identity'
);

select extensions.ok(
  position('financial_impact' in pg_get_function_result(
    'public.sellertray_list_commercial_actions(uuid,integer)'::regprocedure
  )) > 0,
  'commercial audit read model returns financial impact'
);

select extensions.ok(
  position('before_state' in pg_get_function_result(
    'public.sellertray_list_commercial_actions(uuid,integer)'::regprocedure
  )) > 0
  and position('after_state' in pg_get_function_result(
    'public.sellertray_list_commercial_actions(uuid,integer)'::regprocedure
  )) > 0,
  'commercial audit read model returns state evidence'
);

select extensions.is(
  public.sellertray_commercial_actor_kind(
    'b5bcf337-c7d8-47c0-92f3-0dc9de6b8ce1'::uuid,
    null
  ),
  'system',
  'missing authenticated actor is classified as system'
);

select extensions.ok(
  position('reviewed' in pg_get_functiondef(
    'public.audit_sellertray_change_request()'::regprocedure
  )) = 0
  or position('v_policy' in pg_get_functiondef(
    'public.audit_sellertray_change_request()'::regprocedure
  )) > 0,
  'reviewed change requests are not falsely recorded as applied'
);

select * from extensions.finish();
rollback;
