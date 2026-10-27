begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  to_regprocedure('public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid)') is not null,
  'package-aware installment contract gate exists'
);

select extensions.ok(
  position('sellertray_master_agreement_accepted_at' in pg_get_functiondef(
    'public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid)'::regprocedure
  ))>0
  and position('sellertray_order_form_confirmations' in pg_get_functiondef(
    'public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid)'::regprocedure
  ))>0,
  'contract gate requires the universal Master and exact current Order Form confirmation when applicable'
);

select extensions.ok(
  position('sellertray_commercial_agreement_acceptances' in pg_get_functiondef(
    'public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid)'::regprocedure
  ))=0,
  'legacy C1A acceptance is not an activation fallback'
);

select extensions.ok(
  position('sellertray_installment_contract_accepted_at' in pg_get_functiondef(
    'public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid)'::regprocedure
  ))>0
  and position('sellertray_master_agreement_is_accepted' in pg_get_functiondef(
    'public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid)'::regprocedure
  ))=0,
  'compatibility boolean helper delegates to the final contract gate rather than Master-only truth'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_installment_billing_state_legacy_order_agreement(uuid,uuid)') is not null,
  'legacy billing read-model alias exists after provenance convergence'
);

select extensions.ok(
  position('get_sellertray_installment_billing_state_legacy_order_agreement' in pg_get_functiondef(
    'public.get_sellertray_installment_billing_state(uuid,uuid)'::regprocedure
  ))>0
  and position('sellertray_installment_contract_accepted_at' in pg_get_functiondef(
    'public.get_sellertray_installment_billing_state(uuid,uuid)'::regprocedure
  ))>0,
  'billing-state wrapper preserves the legacy read model and overlays package-aware agreement readiness'
);

select extensions.ok(
  position('orderFormConfirmationRequired' in pg_get_functiondef(
    'public.get_sellertray_installment_billing_state(uuid,uuid)'::regprocedure
  ))>0
  and position('orderFormConfirmed' in pg_get_functiondef(
    'public.get_sellertray_installment_billing_state(uuid,uuid)'::regprocedure
  ))>0,
  'billing-state projection exposes exact Order Form confirmation readiness'
);

select extensions.ok(
  to_regprocedure('public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)') is not null,
  'canonical package-aware entitlement reconciliation core exists'
);

select extensions.ok(
  position('sellertray_installment_contract_accepted_at' in pg_get_functiondef(
    'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
  ))>0
  and position('get_sellertray_commercial_settlement_state' in pg_get_functiondef(
    'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
  ))>0
  and position('sellertray_commercial_branch_setup_readiness' in pg_get_functiondef(
    'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
  ))>0,
  'package core preserves agreement, settlement and setup prerequisites in shared authority'
);

select extensions.ok(
  position('sellertray_master_agreement_accepted_at' in pg_get_functiondef(
    'public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure
  ))>0
  and position('reconcile_sellertray_installment_entitlement_package_core' in pg_get_functiondef(
    'public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure
  ))>0,
  'public reconciliation boundary fail-closes on Master acceptance then delegates to package core'
);

select extensions.ok(
  not has_function_privilege('anon','public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid)','EXECUTE'),
  'contract gate is trusted-service only'
);

select extensions.ok(
  not has_function_privilege('anon','public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)','EXECUTE'),
  'package reconciliation core is trusted-service only'
);

select extensions.ok(
  not has_function_privilege('anon','public.reconcile_sellertray_installment_entitlement(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.reconcile_sellertray_installment_entitlement(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.reconcile_sellertray_installment_entitlement(uuid,uuid)','EXECUTE'),
  'public entitlement reconciliation command remains trusted-service only'
);

select extensions.ok(
  position('oa2:provisional:' in pg_get_functiondef(
    'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
  ))>0
  and position('oa2:full:' in pg_get_functiondef(
    'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
  ))>0,
  'converged package core retains governed entitlement idempotency identities'
);

select * from extensions.finish();
rollback;
