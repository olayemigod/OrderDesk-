begin;

select plan(12);

select ok(to_regprocedure('public.get_sellertray_onboarding_state_impl(uuid)') is not null,'OA1 internal onboarding projection exists');
select ok(to_regprocedure('public.get_sellertray_onboarding_state(uuid,uuid)') is not null,'OA1 authorised onboarding read exists');
select ok(not has_function_privilege('authenticated','public.get_sellertray_onboarding_state_impl(uuid)','EXECUTE'),'authenticated clients cannot call the internal projection directly');
select ok(not has_function_privilege('authenticated','public.get_sellertray_onboarding_state(uuid,uuid)','EXECUTE'),'authenticated clients cannot bypass the Edge authority wrapper');
select ok(has_function_privilege('service_role','public.get_sellertray_onboarding_state_impl(uuid)','EXECUTE'),'service role may compose the internal projection');
select ok(has_function_privilege('service_role','public.get_sellertray_onboarding_state(uuid,uuid)','EXECUTE'),'service role may execute the authorised onboarding read');
select ok(position('sellertray_commercial_orders' in pg_get_functiondef('public.get_sellertray_onboarding_state_impl(uuid)'::regprocedure)) > 0,'projection reads governed commercial orders');
select ok(position('sellertray_commercial_installment_payment_confirmations' in pg_get_functiondef('public.get_sellertray_onboarding_state_impl(uuid)'::regprocedure)) > 0,'projection reads confirmed installment payment authority');
select ok(position('sellertray_commercial_branch_setup_readiness' in pg_get_functiondef('public.get_sellertray_onboarding_state_impl(uuid)'::regprocedure)) > 0,'projection reads governed Branch setup readiness');
select ok(position('installment.provisional_activated' in pg_get_functiondef('public.get_sellertray_onboarding_state_impl(uuid)'::regprocedure)) > 0 and position('installment.full_entitlement_released' in pg_get_functiondef('public.get_sellertray_onboarding_state_impl(uuid)'::regprocedure)) > 0,'projection recognises governed initial-activation entitlement events');
select ok(position($needle$in ('active','grace')$needle$ in pg_get_functiondef('public.get_sellertray_onboarding_state_impl(uuid)'::regprocedure)) > 0,'legacy compatibility allows existing active or grace merchants without a governed order');
select ok(position($needle$'trial'$needle$ in pg_get_functiondef('public.get_sellertray_onboarding_state_impl(uuid)'::regprocedure)) = 0,'legacy trial status is not an onboarding access grant');

select * from finish();
rollback;
