begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(
  to_regprocedure('public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)') is not null,
  'OA5C controlled real-merchant proof verifier exists'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'verified server boundary can invoke the OA5C verifier'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'merchant and anonymous clients cannot invoke the privileged OA5C verifier'
);

select extensions.ok(
  position(
    'sellertray_commercial_installment_payment_confirmations'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'sellertray_commercial_direct_payment_confirmations'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'OA5C requires genuine immutable payment-confirmation authority rather than settlement alone'
);

select extensions.ok(
  position(
    '(v_gateway_payment_count+v_direct_payment_count)>0'
    in lower(regexp_replace(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ),'\s+','','g'))
  ) > 0
  and position(
    'v_confirmed_payment_amount>0'
    in lower(regexp_replace(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ),'\s+','','g'))
  ) > 0,
  'discount-only settlement cannot satisfy the genuine-confirmed-settlement gate'
);

select extensions.ok(
  position(
    'sellertray_master_agreement_acceptances'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'resolve_sellertray_master_agreement_version_id'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'OA5C verifies the current universal Master Agreement authority'
);

select extensions.ok(
  position(
    'sellertray_commercial_setup_appointment_events'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'sellertray_commercial_branch_setup_readiness'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'OA5C verifies governed setup completion and derived Branch readiness'
);

select extensions.ok(
  position(
    'sellertray_commercial_entitlement_events'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'orderdesk_subscription_can_write'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'OA5C checks entitlement evidence and compatibility runtime convergence'
);

select extensions.ok(
  position(
    'platform_admin_onboarding_commercial_report'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'merchant_notifications'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'OA5C verifies Admin reporting parity and lifecycle notification evidence'
);

select extensions.ok(
  position(
    'setup_activation_reconciliation_retry'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'idempotency_key'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'OA5C requires observed reconciliation retry evidence and idempotency contracts'
);

select extensions.ok(
  position(
    'manualsurfaceobservationrequired'',true'
    in lower(regexp_replace(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ),'\s+','','g'))
  ) > 0
  and position(
    '''oa5caccepted'',false'
    in lower(regexp_replace(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ),'\s+','','g'))
  ) > 0,
  'read-only verifier cannot self-declare a fixture real or bypass Mobile/Merchant Web observation'
);

select extensions.ok(
  position(
    'insert into'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) = 0
  and position(
    'update public.'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) = 0
  and position(
    'delete from'
    in lower(pg_get_functiondef(
      'public.platform_admin_verify_oa5c_real_merchant_proof(uuid,uuid,uuid)'::regprocedure
    ))
  ) = 0,
  'OA5C verifier contains no lifecycle write statements'
);

select * from extensions.finish();
rollback;
