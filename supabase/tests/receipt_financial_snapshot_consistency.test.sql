begin;
select plan(7);

select ok(
  to_regprocedure('public.sellertray_snapshot_receipt_financials()') is not null,
  'receipt financial snapshot trigger function exists'
);
select ok(
  not has_function_privilege('anon', 'public.sellertray_snapshot_receipt_financials()', 'EXECUTE'),
  'anon cannot execute receipt snapshot trigger directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.sellertray_snapshot_receipt_financials()', 'EXECUTE'),
  'authenticated clients cannot execute receipt snapshot trigger directly'
);
select ok(
  has_function_privilege('service_role', 'public.sellertray_snapshot_receipt_financials()', 'EXECUTE'),
  'service runtime retains receipt snapshot trigger authority'
);
select ok(
  exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='sellertray_print_jobs'
      and t.tgname='sellertray_snapshot_receipt_financials'
      and not t.tgisinternal
  ),
  'receipt print jobs snapshot committed financial facts before insert'
);
select ok(
  pg_get_functiondef('public.sellertray_snapshot_receipt_financials()'::regprocedure)
    ~ 'subtotal_amount.*tax_applied.*tax_rate_percent.*tax_amount.*tax_display_breakdown.*gross_amount',
  'receipt snapshot consumes the immutable posted tax fields'
);
select ok(
  pg_get_functiondef('public.sellertray_snapshot_receipt_financials()'::regprocedure)
    !~ 'sellertray_tax_configurations',
  'historical receipt snapshot never consults current tax settings'
);

select * from finish();
rollback;
