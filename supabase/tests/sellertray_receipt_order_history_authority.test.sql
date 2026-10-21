begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.ok(
  to_regprocedure('public.sellertray_snapshot_receipt_financial_authority()') is not null,
  'receipt financial snapshot trigger function exists'
);

select extensions.ok(
  exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='sellertray_print_jobs'
      and t.tgname='sellertray_snapshot_receipt_financial_authority'
      and not t.tgisinternal
  ),
  'receipt print jobs snapshot persisted financial authority before insert'
);

select extensions.ok(
  position('subtotal_amount' in pg_get_functiondef('public.sellertray_snapshot_receipt_financial_authority()'::regprocedure))>0,
  'receipt snapshot reads persisted sale subtotal'
);

select extensions.ok(
  position('tax_amount' in pg_get_functiondef('public.sellertray_snapshot_receipt_financial_authority()'::regprocedure))>0,
  'receipt snapshot reads persisted sale tax amount'
);

select extensions.ok(
  position('total_amount' in pg_get_functiondef('public.sellertray_snapshot_receipt_financial_authority()'::regprocedure))>0,
  'receipt snapshot reads persisted authoritative sale total'
);

select extensions.ok(
  position('tax_display_breakdown' in pg_get_functiondef('public.sellertray_snapshot_receipt_financial_authority()'::regprocedure))>0,
  'receipt snapshot reads the persisted sale-time tax display decision'
);

select extensions.ok(
  position('sellertray_tax_configurations' in pg_get_functiondef('public.sellertray_snapshot_receipt_financial_authority()'::regprocedure))=0,
  'historical receipt snapshot does not consult current tax configuration'
);

select extensions.ok(
  position('showTaxBreakdown' in pg_get_functiondef('public.sellertray_snapshot_receipt_financial_authority()'::regprocedure))>0,
  'receipt snapshot exposes persisted tax display authority to mobile printing'
);

select * from extensions.finish();
rollback;
