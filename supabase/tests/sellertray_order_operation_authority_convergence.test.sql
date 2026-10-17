begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.ok(
  to_regprocedure('public.sellertray_user_can_manage_order_operation(uuid,uuid,uuid)') is not null,
  'shared order operation authority predicate exists'
);
select extensions.ok(
  position('can_manage_orders' in pg_get_functiondef('public.sellertray_user_can_manage_order_operation(uuid,uuid,uuid)'::regprocedure)) > 0
  and position('sellertray_user_can_operate_branch' in pg_get_functiondef('public.sellertray_user_can_manage_order_operation(uuid,uuid,uuid)'::regprocedure)) > 0,
  'order operation authority requires order capability and active Branch operation'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.sellertray_user_can_manage_order_operation(uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.sellertray_user_can_manage_order_operation(uuid,uuid,uuid)','EXECUTE'),
  'internal order authority predicate remains service-only'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_order_action_authority(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_order_action_authority(uuid,uuid)','EXECUTE'),
  'signed-in clients can read only their order action authority'
);
select extensions.ok(
  position('auth.uid()' in pg_get_functiondef('public.get_sellertray_order_action_authority(uuid,uuid)'::regprocedure)) > 0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.get_sellertray_order_action_authority(uuid,uuid)'::regprocedure)) > 0,
  'order action authority is bound to the signed-in user and writable subscription'
);

select extensions.ok(
  has_function_privilege('authenticated','public.transition_sellertray_order(uuid,uuid,text,text)','EXECUTE'),
  'authenticated workflow uses the governed transition command'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.transition_sellertray_order(uuid,uuid,text,text)'::regprocedure)) > 0
  and position('orderdesk_subscription_can_write' in pg_get_functiondef('public.transition_sellertray_order(uuid,uuid,text,text)'::regprocedure)) > 0
  and position('source=''pos''' in pg_get_functiondef('public.transition_sellertray_order(uuid,uuid,text,text)'::regprocedure)) > 0,
  'generic workflow transition is authorized and does not bypass POS sale commands'
);
select extensions.ok(
  position('sellertray.audit_actor_user_id' in pg_get_functiondef('public.transition_sellertray_order(uuid,uuid,text,text)'::regprocedure)) > 0,
  'workflow transition preserves governed audit actor context'
);

select extensions.ok(
  has_function_privilege('authenticated','public.mutate_sellertray_order_item(uuid,uuid,text,uuid,text,numeric,numeric)','EXECUTE'),
  'authenticated line correction uses the governed item command'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.mutate_sellertray_order_item(uuid,uuid,text,uuid,text,numeric,numeric)'::regprocedure)) > 0
  and position('source=''pos''' in pg_get_functiondef('public.mutate_sellertray_order_item(uuid,uuid,text,uuid,text,numeric,numeric)'::regprocedure)) > 0,
  'generic line correction is authorized and keeps POS draft editing separate'
);
select extensions.ok(
  position('match_source' in pg_get_functiondef('public.mutate_sellertray_order_item(uuid,uuid,text,uuid,text,numeric,numeric)'::regprocedure)) > 0
  and position('''manual''' in pg_get_functiondef('public.mutate_sellertray_order_item(uuid,uuid,text,uuid,text,numeric,numeric)'::regprocedure)) > 0,
  'merchant-added customer-order lines retain explicit manual provenance'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)','EXECUTE'),
  'fulfillment business command remains behind the governed edge service'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_operation' in pg_get_functiondef('public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'fulfillment requires shared order capability and Branch authority'
);
select extensions.ok(
  position('sellertray_payment_gate_decision(p_order_id,''dispatch'')' in replace(pg_get_functiondef('public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure),' ','')) > 0
  or position('''dispatch''' in pg_get_functiondef('public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'delivery start rechecks the dispatch payment gate server-side'
);
select extensions.ok(
  position('''complete''' in pg_get_functiondef('public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0
  and position('sellertray_payment_gate_decision' in pg_get_functiondef('public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'fulfillment completion rechecks payment policy server-side'
);
select extensions.ok(
  position('commercial_action_ledger' in pg_get_functiondef('public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0
  and position('sellertray.audit_actor_user_id' in pg_get_functiondef('public.apply_sellertray_order_fulfillment(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'fulfillment commits commercial audit with governed actor context'
);

select extensions.ok(
  not has_column_privilege('authenticated','public.orders','status','UPDATE'),
  'authenticated clients cannot update order status directly'
);
select extensions.ok(
  not has_column_privilege('authenticated','public.order_items','item_name','INSERT')
  and not has_column_privilege('authenticated','public.order_items','item_name','UPDATE'),
  'authenticated clients cannot insert or update order lines directly'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.order_items','DELETE'),
  'authenticated clients cannot delete order lines directly'
);
select extensions.ok(
  position('sellertray_user_can_operate_branch' in pg_get_functiondef('public.update_sellertray_pos_draft_items(uuid,uuid,jsonb)'::regprocedure)) > 0
  and position('can_manage_orders' in pg_get_functiondef('public.update_sellertray_pos_draft_items(uuid,uuid,jsonb)'::regprocedure)) > 0,
  'existing POS draft editing keeps its governed order authority'
);

select * from extensions.finish();
rollback;
