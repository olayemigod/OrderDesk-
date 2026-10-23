begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='tenants' and column_name='commercial_onboarding_required'),
  'tenant onboarding enrollment marker exists'
);
select extensions.ok(
  coalesce((select column_default='false' from information_schema.columns where table_schema='public' and table_name='tenants' and column_name='commercial_onboarding_required'),false),
  'existing Businesses default to compatibility enrollment false'
);
select extensions.ok(
  not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_my_business'),
  'legacy direct self-service Business creation is not an onboarding bypass'
);
select extensions.ok(
  has_function_privilege('service_role','public.provision_business_for_user(uuid,text,text,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.provision_business_for_user(uuid,text,text,text,text,text)','EXECUTE'),
  'Business provisioning remains service-authoritative'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_onboarding_state(uuid)','EXECUTE'),
  'merchant clients may read the governed onboarding projection'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_onboarding_state_admin(uuid,uuid)','EXECUTE'),
  'Admin onboarding projection remains service-only'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.sellertray_onboarding_live_operations_allowed(uuid)','EXECUTE'),
  'live-operation capability helper is not a client callable authority'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgname='guard_sellertray_onboarding_orders' and not tgisinternal),
  'orders are server-gated during onboarding'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgname='guard_sellertray_onboarding_cash_shifts' and not tgisinternal),
  'cashier shifts are server-gated during onboarding'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgname='guard_sellertray_onboarding_business_expenses' and not tgisinternal),
  'Business Expenses are server-gated during onboarding'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgname='guard_sellertray_onboarding_inventory_movements' and not tgisinternal),
  'inventory movements are server-gated during onboarding'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgname='guard_sellertray_onboarding_purchase_orders' and not tgisinternal),
  'purchase orders are server-gated during onboarding'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgname='guard_sellertray_onboarding_supplier_payments' and not tgisinternal),
  'supplier payments are server-gated during onboarding'
);
select extensions.ok(
  exists(select 1 from pg_trigger where tgname='guard_sellertray_onboarding_sale_returns' and not tgisinternal),
  'returns/refunds cannot bypass onboarding activation'
);

select * from extensions.finish();
rollback;
