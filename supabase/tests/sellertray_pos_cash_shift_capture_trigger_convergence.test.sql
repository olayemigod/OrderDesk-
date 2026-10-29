begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.ok(
  to_regprocedure('public.capture_sellertray_shift_cash_sale()') is not null,
  'POS cash sale capture function exists'
);

select extensions.ok(
  to_regprocedure('public.capture_sellertray_shift_cash_refund()') is not null,
  'POS cash refund capture function exists'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.capture_sellertray_shift_cash_sale()',
    'EXECUTE'
  ),
  'cash sale trigger function is not an authenticated RPC'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.capture_sellertray_shift_cash_refund()',
    'EXECUTE'
  ),
  'cash refund trigger function is not an authenticated RPC'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_trigger t
    where t.tgrelid='public.order_payments'::regclass
      and not t.tgisinternal
      and t.tgname='capture_sellertray_shift_cash_sale'
      and pg_get_triggerdef(t.oid) ilike '%capture_sellertray_shift_cash_sale()%'
  ),
  1,
  'order payments have exactly one POS cash sale capture trigger'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_trigger t
    where t.tgrelid='public.payment_refunds'::regclass
      and not t.tgisinternal
      and t.tgname='capture_sellertray_shift_cash_refund'
      and pg_get_triggerdef(t.oid) ilike '%capture_sellertray_shift_cash_refund()%'
  ),
  1,
  'payment refunds have exactly one POS cash refund capture trigger'
);

select extensions.ok(
  (
    select p.prosrc ilike '%sellertray_shift_cash_sales%'
      and p.prosrc ilike '%sellertray_user_can_operate_branch%'
      and p.prosrc ilike '%status=''open''%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='capture_sellertray_shift_cash_sale'
      and pg_get_function_identity_arguments(p.oid)=''
  ),
  'cash sale capture requires Branch authority and an open shift before ledger insertion'
);

select extensions.ok(
  (
    select p.prosrc ilike '%sellertray_shift_cash_refunds%'
      and p.prosrc ilike '%sellertray_user_can_operate_branch%'
      and p.prosrc ilike '%expected_cash%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='capture_sellertray_shift_cash_refund'
      and pg_get_function_identity_arguments(p.oid)=''
  ),
  'cash refund capture preserves Branch authority and drawer-balance protection'
);

select * from extensions.finish();
rollback;
