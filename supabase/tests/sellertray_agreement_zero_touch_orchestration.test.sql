begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.ok(
  to_regprocedure('public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)') is not null,
  'shared agreement-package ensure authority exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='sellertray_commercial_installment_schedule'
      and t.tgname='orchestrate_sellertray_agreement_package_after_installment_schedule'
      and not t.tgisinternal
  ),
  'completed installment schedules invoke zero-touch agreement orchestration'
);

select extensions.ok(
  not has_function_privilege('anon','public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)','EXECUTE'),
  'agreement ensure authority is service-bound and cannot be invoked directly by merchant clients'
);

select extensions.ok(
  not has_function_privilege('anon','public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)','EXECUTE'),
  'exception reconciliation is service-bound'
);

select extensions.ok(
  position('order_form_template_missing' in pg_get_functiondef(
    'public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)'::regprocedure
  ))>0
  and position('master_agreement_missing' in pg_get_functiondef(
    'public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)'::regprocedure
  ))>0,
  'missing legal configuration is represented as non-fatal orchestration state'
);

select extensions.ok(
  position('insert into public.sellertray_commercial_order_forms' in lower(pg_get_functiondef(
    'public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)'::regprocedure
  )))>0
  and position('create_sellertray_agreement_package' in pg_get_functiondef(
    'public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)'::regprocedure
  ))>0,
  'shared authority instantiates the immutable Order Form and package without the manual Admin issuer'
);

select extensions.ok(
  position('issue_sellertray_commercial_order_form_admin' in pg_get_functiondef(
    'public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)'::regprocedure
  ))=0,
  'normal orchestration does not route through the routine per-merchant Admin issuance command'
);

select extensions.ok(
  position('sum(s.amount_due)' in lower(pg_get_functiondef(
    'public.orchestrate_sellertray_agreement_package_after_installment_schedule()'::regprocedure
  )))>0
  and position('obligated_amount' in pg_get_functiondef(
    'public.orchestrate_sellertray_agreement_package_after_installment_schedule()'::regprocedure
  ))>0,
  'automatic orchestration waits for the complete governed installment schedule'
);

select extensions.ok(
  position('sellertray_agreement_package_reconciled' in pg_get_functiondef(
    'public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)'::regprocedure
  ))>0,
  'exception reconciliation records a platform Admin audit event'
);

select * from extensions.finish();
rollback;
