begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

select extensions.ok(
  exists(
    select 1
    from pg_constraint c
    where c.conrelid='public.orders'::regclass
      and c.conname='orders_pos_outstanding_requires_customer'
      and c.contype='c'
      and c.convalidated
  ),
  'POS outstanding-customer guard exists and is validated'
);

select extensions.ok(
  position('CUSTOMER_ID IS NOT NULL' in upper(pg_get_constraintdef((
    select c.oid
    from pg_constraint c
    where c.conrelid='public.orders'::regclass
      and c.conname='orders_pos_outstanding_requires_customer'
  )))) > 0,
  'POS outstanding-customer guard requires customer identity'
);

select extensions.ok(
  to_regprocedure('public.collect_sellertray_customer_receivable(uuid,uuid,uuid,numeric,uuid)') is not null,
  'shared customer receivable collection authority exists'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_feedback_dashboard(uuid,integer)') is not null,
  'forward feedback dashboard authority exists'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_feedback_dashboard(uuid,integer)','EXECUTE'),
  'authenticated Owner/Manager path may call feedback dashboard authority'
);

select extensions.ok(
  has_function_privilege('authenticated','public.manage_sellertray_feedback(uuid,uuid,text,text)','EXECUTE'),
  'authenticated Owner/Manager path may call governed feedback mutation authority'
);

select * from extensions.finish();
rollback;
