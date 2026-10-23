begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

select extensions.ok(
  (select c.relrowsecurity from pg_class c where c.oid='public.platform_admin_capability_grant_versions'::regclass),
  'Admin capability grants are protected by RLS'
);

select extensions.ok(
  (select c.relrowsecurity from pg_class c where c.oid='public.sellertray_installment_policy_change_commands'::regclass),
  'installment policy command ledger is protected by RLS'
);

select extensions.ok(
  has_function_privilege('service_role','public.platform_admin_has_capability(uuid,text,uuid,timestamptz)','EXECUTE'),
  'service role can resolve scoped Admin capabilities'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.platform_admin_has_capability(uuid,text,uuid,timestamptz)','EXECUTE'),
  'authenticated clients cannot directly resolve privileged Admin capabilities'
);

select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)','EXECUTE'),
  'service role can read shared commercial settlement detail'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)','EXECUTE'),
  'merchant clients cannot bypass governed commercial settlement wrappers'
);

select extensions.ok(
  has_function_privilege('service_role','public.platform_admin_commercial_settlement_center(uuid,uuid)','EXECUTE'),
  'service role can load the Admin settlement center'
);

select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_commercial_billing_center(uuid,uuid)','EXECUTE'),
  'service role can load the Merchant billing center'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.platform_admin_record_commercial_adjustment(uuid,uuid,uuid,uuid,numeric,text,jsonb)','EXECUTE'),
  'authenticated clients cannot call the Admin adjustment mutation directly'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.platform_admin_record_commercial_direct_payment(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb)','EXECUTE'),
  'authenticated clients cannot call the Admin direct-payment mutation directly'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.platform_admin_publish_installment_policy_override(uuid,uuid,uuid,text,uuid,text,boolean,uuid,timestamptz,timestamptz,text)','EXECUTE'),
  'authenticated clients cannot publish installment policy overrides directly'
);

select extensions.ok(
  position('admin.pricing.manage' in lower(pg_get_functiondef('public.platform_admin_record_commercial_adjustment(uuid,uuid,uuid,uuid,numeric,text,jsonb)'::regprocedure))) > 0,
  'commercial adjustments require the pricing-management capability'
);

select extensions.ok(
  position('admin.payments.reconcile' in lower(pg_get_functiondef('public.platform_admin_record_commercial_direct_payment(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb)'::regprocedure))) > 0,
  'direct ProcessEdge payment confirmation requires payment-reconciliation capability'
);

select extensions.ok(
  position('admin.installments.manage' in lower(pg_get_functiondef('public.platform_admin_publish_installment_policy_override(uuid,uuid,uuid,text,uuid,text,boolean,uuid,timestamptz,timestamptz,text)'::regprocedure))) > 0,
  'installment policy overrides require installment-management capability'
);

select extensions.ok(
  position('commercial_adjustment_recorded' in lower(pg_get_functiondef('public.platform_admin_record_commercial_adjustment(uuid,uuid,uuid,uuid,numeric,text,jsonb)'::regprocedure))) > 0
  and position('commercial_direct_payment_confirmed' in lower(pg_get_functiondef('public.platform_admin_record_commercial_direct_payment(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb)'::regprocedure))) > 0,
  'Admin settlement mutations append immutable platform audit events'
);

select extensions.ok(
  position('sellertray_commercial_payment_confirmations' in lower(pg_get_functiondef('public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)'::regprocedure))) > 0
  and position('sellertray_commercial_direct_payment_confirmations' in lower(pg_get_functiondef('public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)'::regprocedure))) > 0,
  'settlement detail keeps provider confirmations and direct ProcessEdge payments as separate histories'
);

select * from extensions.finish();
rollback;
