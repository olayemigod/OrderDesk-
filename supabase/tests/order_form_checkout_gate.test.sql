begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.ok(
  to_regprocedure('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)') is not null,
  'installment checkout reservation authority exists'
);

select extensions.ok(
  position('sellertray_commercial_order_forms' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure))) > 0,
  'checkout authority resolves the purchase Order Form'
);
select extensions.ok(
  position('sellertray_order_form_confirmations' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure))) > 0,
  'checkout authority requires Order Form confirmation for governed purchases'
);
select extensions.ok(
  position('sellertray_agreement_package_processing' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure))) > 0,
  'checkout fails closed while Order Form orchestration is in progress'
);
select extensions.ok(
  position('to_regclass(''public.sellertray_agreement_package_processing'')' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure))) > 0,
  'checkout checks optional agreement-processing authority before dynamic access for pre-C2 compatibility'
);
select extensions.ok(
  position('review and confirm this sellertray order form before payment' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure))) > 0,
  'unconfirmed governed purchase has a merchant-facing payment block'
);

select extensions.ok(
  position('command_id=p_command_id' in replace(lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure)),' ',''))
    < position('sellertray_commercial_order_forms' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure))),
  'exact checkout command replay is evaluated before the new Order Form gate'
);
select extensions.ok(
  position('s.status in (''preparing'',''initialized'',''paid'')' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure)))
    < position('sellertray_commercial_order_forms' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure))),
  'existing active checkout sessions remain reusable before the new Order Form gate'
);
select extensions.ok(
  position('no order form and no orchestration record is the structural legacy' in lower(pg_get_functiondef('public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure))) > 0,
  'structural legacy compatibility remains explicit until C2'
);

select * from extensions.finish();
rollback;
