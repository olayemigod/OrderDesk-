begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

select extensions.ok(
  position(
    'get_sellertray_commercial_settlement_state' in
    lower(pg_get_functiondef('public.get_sellertray_installment_billing_state(uuid,uuid)'::regprocedure))
  ) > 0,
  'installment billing state consumes the shared OA2 settlement projection'
);
select extensions.ok(
  position(
    'sellertray_installment_contract_snapshots' in
    lower(pg_get_functiondef('public.get_sellertray_installment_billing_state(uuid,uuid)'::regprocedure))
  ) > 0,
  'billing state consumes immutable contract snapshot metadata'
);
select extensions.ok(
  position(
    'qualifyingsettlementsatisfied' in
    lower(pg_get_functiondef('public.get_sellertray_installment_billing_state(uuid,uuid)'::regprocedure))
  ) > 0,
  'billing state exposes qualifying settlement separately from provider payment count'
);
select extensions.ok(
  position(
    'v_billing_cycle<>''yearly''' in
    lower(pg_get_functiondef('public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure))
  ) = 0,
  'entitlement reconciliation no longer rejects all non-yearly installment contracts'
);
select extensions.ok(
  position(
    'v_obligation.structure_code=''two_installment_70_30''' in
    lower(pg_get_functiondef('public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure))
  ) = 0,
  'provisional entitlement is no longer hard-coded from the 70 / 30 structure name'
);
select extensions.ok(
  position(
    'v_snapshot.provisional_entitlement_months' in
    lower(pg_get_functiondef('public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure))
  ) > 0,
  'provisional entitlement duration is read from the immutable contract snapshot'
);
select extensions.ok(
  position(
    'outstandingamount' in
    lower(pg_get_functiondef('public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure))
  ) > 0,
  'full entitlement is driven by authoritative outstanding balance rather than provider row count'
);
select extensions.ok(
  position(
    'interval ''1 month''' in
    lower(pg_get_functiondef('public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure))
  ) > 0,
  'explicitly governed monthly installment contracts have a monthly entitlement term'
);
select extensions.ok(
  position(
    'sellertray_commercial_direct_payment_confirmations' in
    lower(pg_get_functiondef('public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure))
  ) > 0,
  'direct payment facts participate in reconciliation timing without becoming provider events'
);
select extensions.ok(
  position(
    'sellertray_commercial_adjustments' in
    lower(pg_get_functiondef('public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure))
  ) > 0,
  'approved adjustments participate in qualifying settlement reconciliation'
);

select * from extensions.finish();
rollback;
