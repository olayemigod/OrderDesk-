begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

select extensions.ok(
  position(
    'where s.tenant_id=p_tenant_id and s.status=''trial'''
    in lower(pg_get_functiondef(
      'public.create_sellertray_initial_installment_purchase_admin_impl(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure
    ))
  ) > 0,
  'initial installment purchase uses the pre-C2 trial compatibility state without requiring the legacy runtime plan code to equal the purchased plan'
);

select extensions.ok(
  position(
    'select s.plan_code,s.billing_cycle'
    in lower(pg_get_functiondef(
      'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'and s.line_type=''subscription'''
    in lower(pg_get_functiondef(
      'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'C1B package-aware reconciliation derives the runtime plan from the immutable commercial subscription snapshot'
);

select extensions.ok(
  position(
    'sellertray_master_agreement_accepted_at'
    in lower(pg_get_functiondef(
      'public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'if v_agreement_accepted_at is null'
    in lower(pg_get_functiondef(
      'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'if v_agreement_accepted_at is null'
    in lower(pg_get_functiondef(
      'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
    ))
  ) < position(
    'update public.tenant_subscriptions'
    in lower(pg_get_functiondef(
      'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
    ))
  ),
  'universal Master, package agreement, Branch setup and settlement prerequisites are evaluated before any runtime compatibility mutation'
);

select extensions.ok(
  position(
    'set plan_code=v_plan_code'
    in lower(pg_get_functiondef(
      'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'successful C1B reconciliation moves the compatibility row to the governed purchased plan'
);

select extensions.ok(
  position(
    'update public.tenant_subscriptions'
    in lower(pg_get_functiondef(
      'public.create_sellertray_initial_installment_purchase_admin_impl(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure
    ))
  ) = 0,
  'creating the governed initial purchase does not change runtime subscription compatibility state'
);

select extensions.ok(
  position(
    'tenant_subscriptions'
    in lower(pg_get_functiondef(
      'public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)'::regprocedure
    ))
  ) = 0,
  'provider payment confirmation remains separate from runtime plan activation'
);

select * from extensions.finish();
rollback;
