begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

select extensions.ok(
  to_regclass('public.sellertray_supplier_payments') is not null
  and to_regclass('public.sellertray_supplier_payment_reversals') is not null,
  'supplier payment and reversal evidence tables exist'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_supplier_payments','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payments','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payments','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payments','DELETE'),
  'authenticated clients cannot bypass supplier payment commands'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_supplier_payment_reversals','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payment_reversals','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payment_reversals','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_supplier_payment_reversals','DELETE'),
  'supplier payment reversal evidence is not directly exposed'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_supplier_payments'
      and t.tgname='prevent_sellertray_supplier_payment_mutation' and not t.tgisinternal
  )
  and exists(
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_supplier_payment_reversals'
      and t.tgname='prevent_sellertray_supplier_payment_reversal_mutation' and not t.tgisinternal
  ),
  'supplier payment and reversal history are immutable'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'sellertray_purchase_paid_amount',
        'record_sellertray_supplier_payment',
        'reverse_sellertray_supplier_payment',
        'get_sellertray_purchase_payment_summary',
        'get_sellertray_supplier_outstanding_summary'
      )
  ),
  5,
  'supplier payment command and read functions exist'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'sellertray_purchase_paid_amount',
        'record_sellertray_supplier_payment',
        'reverse_sellertray_supplier_payment',
        'get_sellertray_purchase_payment_summary',
        'get_sellertray_supplier_outstanding_summary'
      )
      and p.prosecdef=true
  ),
  5,
  'supplier payment command and read functions are security definer functions'
);

select extensions.ok(
  has_function_privilege('authenticated','public.record_sellertray_supplier_payment(uuid,uuid,text,text,numeric,timestamptz,text)','EXECUTE')
  and has_function_privilege('authenticated','public.reverse_sellertray_supplier_payment(uuid,uuid,text)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_purchase_payment_summary(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_supplier_outstanding_summary(uuid)','EXECUTE'),
  'authenticated management sessions can use governed supplier payment APIs'
);

select extensions.ok(
  not has_function_privilege('anon','public.record_sellertray_supplier_payment(uuid,uuid,text,text,numeric,timestamptz,text)','EXECUTE')
  and not has_function_privilege('anon','public.reverse_sellertray_supplier_payment(uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_purchase_payment_summary(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_supplier_outstanding_summary(uuid)','EXECUTE'),
  'anonymous users cannot use supplier payment APIs'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.sellertray_purchase_paid_amount(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.sellertray_purchase_paid_amount(uuid,uuid)','EXECUTE'),
  'paid amount helper remains internal'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_sellertray_supplier_payment'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_purchase_management_role%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'recording supplier payment is management-only and subscription-aware'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_sellertray_supplier_payment'
      and lower(pg_get_functiondef(p.oid)) like '%ordered%partially_received%received%'
      and lower(pg_get_functiondef(p.oid)) like '%only after a purchase order is placed%'
  ),
  'supplier payment evidence requires a placed Purchase Order'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_sellertray_supplier_payment'
      and lower(pg_get_functiondef(p.oid)) like '%bank_transfer%cash%card%other%'
      and lower(pg_get_functiondef(p.oid)) like '%amount must be greater than zero%'
  ),
  'supplier payment command validates method and positive amount'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_sellertray_supplier_payment'
      and lower(pg_get_functiondef(p.oid)) like '%exceeds the purchase order outstanding amount%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_purchase_paid_amount%'
  ),
  'supplier payment cannot exceed derived outstanding amount'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_sellertray_supplier_payment'
      and lower(pg_get_functiondef(p.oid)) like '%reference is already used for different payment evidence%'
      and lower(pg_get_functiondef(p.oid)) like '%idempotentreplay%'
  ),
  'supplier payment reference is conflict-safe and retry-aware'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_sellertray_supplier_payment'
      and lower(pg_get_functiondef(p.oid)) not like '%apply_sellertray_inventory_operation%'
      and lower(pg_get_functiondef(p.oid)) not like '%cash_shift%'
      and lower(pg_get_functiondef(p.oid)) not like '%inventory_movements%'
  ),
  'supplier payment evidence has no stock or cashier side effect'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='reverse_sellertray_supplier_payment'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_purchase_management_role%'
      and lower(pg_get_functiondef(p.oid)) like '%reversal reason is required%'
      and lower(pg_get_functiondef(p.oid)) like '%idempotentreplay%'
  ),
  'supplier payment correction is a governed retry-safe reversal'
);

select extensions.ok(
  exists(
    select 1 from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='sellertray_supplier_payment_reversals'
      and c.contype='u' and pg_get_constraintdef(c.oid) like '%tenant_id, payment_id%'
  ),
  'one reversal can exist for each supplier payment'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_purchase_paid_amount'
      and lower(pg_get_functiondef(p.oid)) like '%not exists%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_supplier_payment_reversals%'
  ),
  'paid amount excludes reversed payment evidence'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_purchase_payment_summary'
      and lower(pg_get_functiondef(p.oid)) like '%unpaid%'
      and lower(pg_get_functiondef(p.oid)) like '%partially_paid%'
      and lower(pg_get_functiondef(p.oid)) like '%outstandingamount%'
      and lower(pg_get_functiondef(p.oid)) like '%payments%'
  ),
  'Purchase Order payment summary derives unpaid, partial, paid and history state'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_supplier_outstanding_summary'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_purchase_paid_amount%'
      and lower(pg_get_functiondef(p.oid)) like '%ordered%partially_received%received%'
  ),
  'supplier outstanding state is derived from placed purchases and effective payment evidence'
);

select extensions.ok(
  exists(
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_purchase_orders'
      and t.tgname='guard_sellertray_purchase_cancellation_with_payment' and not t.tgisinternal
  ),
  'Purchase Order cancellation has a supplier payment guard'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='guard_sellertray_purchase_cancellation_with_payment'
      and lower(pg_get_functiondef(p.oid)) like '%reverse supplier payments before cancelling%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_supplier_payment_reversals%'
  ),
  'Purchase Order cannot be cancelled while effective supplier payment exists'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='prevent_sellertray_supplier_payment_mutation'
      and lower(pg_get_functiondef(p.oid)) like '%not exists%public.tenants%'
      and lower(pg_get_functiondef(p.oid)) like '%immutable%record a reversal%'
  ),
  'payment evidence stays immutable while allowing governed Tenant deletion'
);

select * from extensions.finish();
rollback;
