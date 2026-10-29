begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(
  to_regprocedure('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)') is not null,
  'governed merchant order creation command exists'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)','EXECUTE'),
  'merchant order creation command remains behind the authenticated edge service'
);
select extensions.ok(
  position('orderdesk_subscription_can_write' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0,
  'merchant order creation requires writable subscription'
);
select extensions.ok(
  position('can_manage_orders' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0
  and position('sellertray_user_has_capability' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0,
  'merchant order creation requires centralized order capability'
);
select extensions.ok(
  position('sellertray_user_can_operate_branch' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0,
  'merchant order creation requires active Branch operation authority'
);
select extensions.ok(
  position('is_default=true' in replace(pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure),' ','')) > 0
  and position('is_active=true' in replace(pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure),' ','')) > 0,
  'missing explicit Branch can only fall back to the active default Branch'
);
select extensions.ok(
  position('resolve_sellertray_pos_customer' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0,
  'merchant order creation uses shared customer phone identity resolution'
);
select extensions.ok(
  position('branch_id' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0,
  'merchant order persists Branch at creation time'
);
select extensions.ok(
  position('sellertray.audit_actor_user_id' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0,
  'merchant order creation preserves governed actor identity for order history'
);
select extensions.ok(
  position('commercial_action_ledger' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0
  and position('manual_order_created' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0,
  'merchant order creation audit commits with the business transaction'
);
select extensions.ok(
  position('source' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0
  and position('''manual''' in pg_get_functiondef('public.create_sellertray_merchant_order_atomic(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) > 0,
  'merchant-created orders retain the shared manual source dimension'
);
select extensions.ok(
  has_function_privilege('service_role','public.resolve_sellertray_pos_customer(uuid,uuid,text,text)','EXECUTE'),
  'governed merchant order command can reuse the shared customer resolver'
);

select * from extensions.finish();
rollback;
