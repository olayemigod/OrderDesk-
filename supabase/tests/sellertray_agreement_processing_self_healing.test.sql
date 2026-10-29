begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

select extensions.ok(
  to_regclass('public.sellertray_agreement_package_processing') is not null,
  'durable agreement processing ledger exists'
);

select extensions.ok(
  (select c.relrowsecurity from pg_class c where c.oid='public.sellertray_agreement_package_processing'::regclass),
  'agreement processing ledger has RLS enabled'
);

select extensions.ok(
  not has_table_privilege('anon','public.sellertray_agreement_package_processing','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_agreement_package_processing','SELECT')
  and not has_table_privilege('service_role','public.sellertray_agreement_package_processing','SELECT'),
  'processing ledger is not directly readable by client or service roles'
);

select extensions.ok(
  to_regprocedure('public.ensure_sellertray_agreement_package_managed(uuid,uuid,uuid,uuid)') is not null,
  'managed zero-touch agreement authority exists'
);

select extensions.ok(
  not has_function_privilege('anon','public.ensure_sellertray_agreement_package_managed(uuid,uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.ensure_sellertray_agreement_package_managed(uuid,uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.ensure_sellertray_agreement_package_managed(uuid,uuid,uuid,uuid)','EXECUTE'),
  'managed agreement authority is service-bound'
);

select extensions.ok(
  position('sellertray_agreement_package_processing' in lower(pg_get_functiondef(
    'public.ensure_sellertray_agreement_package_managed(uuid,uuid,uuid,uuid)'::regprocedure
  )))>0
  and position('ensure_sellertray_agreement_package_for_commercial_order' in pg_get_functiondef(
    'public.ensure_sellertray_agreement_package_managed(uuid,uuid,uuid,uuid)'::regprocedure
  ))>0,
  'managed authority records operational state and reuses canonical legal ensure authority'
);

select extensions.ok(
  position('ensure_sellertray_agreement_package_managed' in pg_get_functiondef(
    'public.orchestrate_sellertray_agreement_package_after_installment_schedule()'::regprocedure
  ))>0,
  'zero-touch schedule trigger enters managed self-healing authority'
);

select extensions.ok(
  to_regprocedure('public.process_sellertray_agreement_package_retries(integer)') is not null,
  'bounded agreement retry worker exists'
);

select extensions.ok(
  not has_function_privilege('anon','public.process_sellertray_agreement_package_retries(integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.process_sellertray_agreement_package_retries(integer)','EXECUTE')
  and has_function_privilege('service_role','public.process_sellertray_agreement_package_retries(integer)','EXECUTE'),
  'retry worker is service-bound'
);

select extensions.ok(
  position('for update skip locked' in lower(pg_get_functiondef(
    'public.process_sellertray_agreement_package_retries(integer)'::regprocedure
  )))>0
  and position('limit v_limit' in lower(pg_get_functiondef(
    'public.process_sellertray_agreement_package_retries(integer)'::regprocedure
  )))>0,
  'retry worker is concurrency-safe and bounded'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='sellertray_master_agreement_versions'
      and t.tgname='wake_sellertray_agreement_processing_after_master_publish'
      and not t.tgisinternal
  )
  and exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='sellertray_commercial_agreement_template_versions'
      and t.tgname='wake_sellertray_agreement_processing_after_template_publish'
      and not t.tgisinternal
  ),
  'Master and Order Form template publication wake blocked zero-touch work'
);

select extensions.ok(
  position('sellertray_agreement_package_processing' in lower(pg_get_functiondef(
    'public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)'::regprocedure
  )))>0
  and position('ensure_sellertray_agreement_package_managed' in pg_get_functiondef(
    'public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)'::regprocedure
  ))>0,
  'manual recovery is limited to registered zero-touch processing subjects'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_agreement_processing_admin(uuid,uuid,text,integer)') is not null
  and has_function_privilege('service_role','public.get_sellertray_agreement_processing_admin(uuid,uuid,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_sellertray_agreement_processing_admin(uuid,uuid,text,integer)','EXECUTE'),
  'Admin exception projection is trusted-service only'
);

select extensions.ok(
  position('agreementProcessing' in pg_get_functiondef(
    'public.get_sellertray_order_forms_admin(uuid,uuid)'::regprocedure
  ))>0
  and position('''canIssueOrderForms'',false' in pg_get_functiondef(
    'public.get_sellertray_order_forms_admin(uuid,uuid)'::regprocedure
  ))>0,
  'Admin agreement overview exposes processing state while routine issuance remains retired'
);

select extensions.ok(
  not has_function_privilege('service_role','public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,uuid,text,uuid)','EXECUTE'),
  'legacy per-merchant Order Form issuer remains outside the trusted service boundary'
);

select * from extensions.finish();
rollback;
