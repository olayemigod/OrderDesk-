begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='billing_checkout_sessions'
      and column_name='provider_initialization_started_at'
      and data_type='timestamp with time zone'
  ),
  'C1B records when an installment provider initialization attempt starts'
);

select extensions.ok(
  to_regprocedure('public.begin_sellertray_installment_checkout_initialization(uuid)') is not null
  and has_function_privilege(
    'service_role','public.begin_sellertray_installment_checkout_initialization(uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.begin_sellertray_installment_checkout_initialization(uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'anon','public.begin_sellertray_installment_checkout_initialization(uuid)','EXECUTE'
  ),
  'provider initialization lease remains service-authority only'
);

select extensions.ok(
  position('for update' in lower(pg_get_functiondef(
    'public.begin_sellertray_installment_checkout_initialization(uuid)'::regprocedure
  )))>0
  and position('provider_initialization_started_at is not null' in lower(pg_get_functiondef(
    'public.begin_sellertray_installment_checkout_initialization(uuid)'::regprocedure
  )))>0
  and position('''in_progress''' in pg_get_functiondef(
    'public.begin_sellertray_installment_checkout_initialization(uuid)'::regprocedure
  ))>0,
  'provider initialization lease serializes concurrent retries and preserves ambiguous in-flight identity'
);

select extensions.ok(
  position('provider_initialization_started_at is null' in lower(pg_get_functiondef(
    'public.complete_sellertray_installment_checkout_initialization(uuid,text,text)'::regprocedure
  )))>0
  and position('provider_initialization_started_at is null' in lower(pg_get_functiondef(
    'public.fail_sellertray_installment_checkout_initialization(uuid)'::regprocedure
  )))>0
  and position('provider_initialization_started_at is null' in lower(pg_get_functiondef(
    'public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)'::regprocedure
  )))>0
  and position('status not in (''preparing'',''initialized'')' in lower(pg_get_functiondef(
    'public.confirm_sellertray_installment_payment_from_checkout(uuid,text,text,numeric,text,timestamptz,text)'::regprocedure
  )))>0,
  'only a begun attempt may complete/fail/confirm while a leased ambiguous preparing session remains webhook-confirmable'
);

select * from extensions.finish();
rollback;
