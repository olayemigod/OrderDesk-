begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  has_function_privilege('service_role','public.materialize_sellertray_installment_obligation_internal(uuid,uuid,uuid)','EXECUTE'),
  'service role can materialize an installment obligation from governed policy'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.materialize_sellertray_installment_obligation_internal(uuid,uuid,uuid)','EXECUTE'),
  'merchant clients cannot materialize installment obligations directly'
);
select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)','EXECUTE'),
  'service role can evaluate governed installment checkout authority'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)','EXECUTE'),
  'merchant clients cannot bypass the governed checkout projection'
);

select extensions.ok(
  position(
    'v_billing_cycle<>''yearly''' in
    lower(pg_get_functiondef('public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure))
  ) = 0,
  'active checkout guard no longer hard-codes yearly-only installment eligibility'
);
select extensions.ok(
  position(
    'initial annual purchase' in
    lower(pg_get_functiondef('public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure))
  ) = 0,
  'active checkout guard no longer enforces the old initial-purchase stereotype'
);
select extensions.ok(
  position(
    '''agreementaccepted'',true' in
    replace(lower(pg_get_functiondef('public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)'::regprocedure)),' ','')
  ) > 0,
  'checkout compatibility never gates payment on Master Agreement acceptance'
);
select extensions.ok(
  position(
    '''checkouteligible'',true' in
    replace(lower(pg_get_functiondef('public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)'::regprocedure)),' ','')
  ) > 0,
  'installment payment checkout remains eligible independently of Master Agreement state'
);
select extensions.ok(
  position(
    'masteragreementaccepted' in
    lower(pg_get_functiondef('public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)'::regprocedure))
  ) > 0,
  'checkout projection exposes Master Agreement state separately for UI/status use'
);
select extensions.ok(
  position(
    'resolve_sellertray_installment_policy' in
    lower(pg_get_functiondef('public.materialize_sellertray_installment_obligation_internal(uuid,uuid,uuid)'::regprocedure))
  ) > 0,
  'new installment obligations are materialized from effective governed policy'
);
select extensions.ok(
  position(
    'supersede_sellertray_stale_installment_checkouts' in
    lower(pg_get_functiondef('public.begin_sellertray_installment_checkout_initialization(uuid)'::regprocedure))
  ) > 0,
  'provider initialization rechecks whether the checkout was superseded'
);
select extensions.ok(
  position(
    'supersede_sellertray_stale_installment_checkouts' in
    lower(pg_get_functiondef('public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)'::regprocedure))
  ) > 0,
  'provider confirmation rechecks authoritative settlement before appending payment'
);
select extensions.ok(
  position(
    'amount_due-v_session.amount' in
    lower(pg_get_functiondef('public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)'::regprocedure))
  ) = 0,
  'provider confirmation accepts the governed residual payable instead of requiring the original full schedule-line amount'
);
select extensions.ok(
  position(
    'two_installment_70_30' in lower((
      select pg_get_constraintdef(c.oid)
      from pg_constraint c
      where c.conrelid='public.sellertray_commercial_installment_obligations'::regclass
        and c.conname='sellertray_commercial_installment_obligations_structure_check'
    ))
  ) = 0,
  'installment obligation structure identity is no longer constrained to only the two legacy presets'
);

select * from extensions.finish();
rollback;
