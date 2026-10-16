begin;
select plan(2);

select ok(
  position('orderdesk_subscription_can_write(p_tenant_id)' in pg_get_functiondef('public.cancel_sellertray_stock_transfer(uuid,uuid,text,uuid)'::regprocedure)) > 0,
  'stock transfer cancellation enforces writable subscription state'
);

select ok(
  not has_function_privilege('authenticated', 'public.cancel_sellertray_stock_transfer(uuid,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.cancel_sellertray_stock_transfer(uuid,uuid,text,uuid)', 'EXECUTE'),
  'stock transfer cancellation remains server-only'
);

select * from finish();
rollback;
