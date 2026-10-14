begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

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
  position('can_manage_payments' in pg_get_functiondef('public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)'::regprocedure)) > 0
  and position('sellertray_user_has_capability' in pg_get_functiondef('public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)'::regprocedure)) > 0,
  'non-POS human payment management retains centralized payment capability evaluation'
);
select extensions.ok(
  position('sellertray_user_can_operate_branch' in pg_get_functiondef('public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)'::regprocedure)) > 0
  and position('branch_id' in pg_get_functiondef('public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)'::regprocedure)) > 0,
  'human payment authority requires current operational Branch access'
);
select extensions.ok(
  position('source' in pg_get_functiondef('public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)'::regprocedure)) > 0
  and position('pos' in lower(pg_get_functiondef('public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)'::regprocedure))) > 0,
  'POS checkout preserves the Branch-operator settlement boundary instead of requiring payment-management capability'
);
select extensions.ok(
  position('sellertray_user_can_manage_order_payment' in pg_get_functiondef('public.confirm_sellertray_offline_payment(uuid,uuid,text)'::regprocedure)) > 0,
  'manual payment confirmation reuses the shared order payment authority boundary'
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
  'authenticated clients cannot bypass the payment confirmation service boundary directly'
);
select extensions.ok(
  has_function_privilege('service_role','public.confirm_sellertray_offline_payment(uuid,uuid,text)','EXECUTE'),
  'governed payment service retains manual confirmation authority'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)','EXECUTE'),
  'authenticated clients cannot call the internal human payment authority predicate directly'
);
select extensions.ok(
  has_function_privilege('service_role','public.sellertray_user_can_manage_order_payment(uuid,uuid,uuid)','EXECUTE'),
  'governed payment services can evaluate human payment authority'
);
select extensions.ok(
  to_regprocedure('public.get_sellertray_order_payment_authority(uuid,uuid)') is not null,
  'authenticated payment action authority reader exists'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_order_payment_authority(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_order_payment_authority(uuid,uuid)','EXECUTE'),
  'payment action authority reader is available only to signed-in users and service infrastructure'
);
select extensions.ok(
  position('auth.uid()' in pg_get_functiondef('public.get_sellertray_order_payment_authority(uuid,uuid)'::regprocedure)) > 0
  and position('sellertray_user_can_manage_order_payment' in pg_get_functiondef('public.get_sellertray_order_payment_authority(uuid,uuid)'::regprocedure)) > 0,
  'payment action authority reader binds the decision to the signed-in user'
);

select * from extensions.finish();
rollback;
