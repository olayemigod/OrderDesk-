begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

select extensions.ok(
  position('can_manage_payments' in pg_get_functiondef('public.upsert_sellertray_payment_method(uuid,uuid,uuid,text,text,boolean,boolean,integer,text,text,text,text,text,text)'::regprocedure)) > 0,
  'payment method management uses centralized payment capability'
);
select extensions.ok(
  position('sellertray_user_has_capability' in pg_get_functiondef('public.upsert_sellertray_payment_method(uuid,uuid,uuid,text,text,boolean,boolean,integer,text,text,text,text,text,text)'::regprocedure)) > 0,
  'payment method management delegates to shared capability evaluation'
);
select extensions.ok(
  position('can_manage_payments' in pg_get_functiondef('public.set_sellertray_payment_method_branches(uuid,uuid,uuid[],uuid)'::regprocedure)) > 0,
  'Branch payment assignment uses centralized payment capability'
);
select extensions.ok(
  position('sellertray_user_has_capability' in pg_get_functiondef('public.set_sellertray_payment_method_branches(uuid,uuid,uuid[],uuid)'::regprocedure)) > 0,
  'Branch payment assignment delegates to shared capability evaluation'
);
select extensions.ok(
  position('sellertray_user_can_operate_branch' in pg_get_functiondef('public.confirm_sellertray_offline_payment(uuid,uuid,text)'::regprocedure)) > 0,
  'POS payment confirmation requires operational Branch authority'
);
select extensions.ok(
  position('can_manage_payments' in pg_get_functiondef('public.confirm_sellertray_offline_payment(uuid,uuid,text)'::regprocedure)) > 0,
  'non-POS manual confirmation requires centralized payment capability'
);
select extensions.ok(
  position('orderdesk_subscription_can_write' in pg_get_functiondef('public.confirm_sellertray_offline_payment(uuid,uuid,text)'::regprocedure)) > 0,
  'manual payment confirmation enforces writable subscription'
);
select extensions.ok(
  position('paystack' in pg_get_functiondef('public.upsert_sellertray_payment_method(uuid,uuid,uuid,text,text,boolean,boolean,integer,text,text,text,text,text,text)'::regprocedure)) > 0
  and position('flutterwave' in pg_get_functiondef('public.upsert_sellertray_payment_method(uuid,uuid,uuid,text,text,boolean,boolean,integer,text,text,text,text,text,text)'::regprocedure)) > 0
  and position('owner' in lower(pg_get_functiondef('public.upsert_sellertray_payment_method(uuid,uuid,uuid,text,text,boolean,boolean,integer,text,text,text,text,text,text)'::regprocedure))) > 0,
  'gateway configuration retains the Owner-only credential boundary'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.confirm_sellertray_offline_payment(uuid,uuid,text)','EXECUTE'),
  'authenticated clients cannot bypass the payment service boundary directly'
);
select extensions.ok(
  has_function_privilege('service_role','public.confirm_sellertray_offline_payment(uuid,uuid,text)','EXECUTE'),
  'governed payment service retains manual confirmation authority'
);

select * from extensions.finish();
rollback;