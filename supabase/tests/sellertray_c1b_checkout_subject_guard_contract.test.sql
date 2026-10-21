begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

select extensions.ok(
  to_regprocedure('public.guard_sellertray_initial_purchase_installment_checkout()') is not null
  and exists (
    select 1 from pg_trigger
    where tgrelid='public.billing_checkout_sessions'::regclass
      and tgname='guard_sellertray_initial_purchase_installment_checkout'
      and not tgisinternal
  ),
  'C1B governed installment checkout guard is attached to shared checkout persistence'
);

select extensions.ok(
  position('o.commercial_order_id=v_order.id' in replace(pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ),' ',''))>0
  and position('s.installment_obligation_id=v_obligation.id' in replace(pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ),' ',''))>0
  and position('new.plan_code is distinct from v_plan_code' in pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ))>0
  and position('abs(new.amount - v_schedule.amount_due)' in pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ))>0,
  'C1B checkout guard binds order, obligation, schedule, plan and exact governed amount'
);

select extensions.ok(
  position('tm.role = ''owner''' in pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ))>0
  and position('new.provider <> ''paystack''' in pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ))>0
  and position('new.status <> ''preparing''' in pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ))>0
  and position('v_expected_reference' in pg_get_functiondef(
    'public.guard_sellertray_initial_purchase_installment_checkout()'::regprocedure
  ))>0,
  'C1B checkout guard enforces Owner authority, provider reservation state and deterministic command reference'
);

select * from extensions.finish();
rollback;
