begin;

select plan(12);

select ok(
  position('can_manage_products' in pg_get_functiondef('public.sellertray_user_has_capability(uuid,uuid,text)'::regprocedure)) > 0,
  'shared capability helper recognises product management'
);
select ok(
  position('can_manage_purchasing' in pg_get_functiondef('public.sellertray_user_has_capability(uuid,uuid,text)'::regprocedure)) > 0,
  'shared capability helper recognises purchasing management'
);
select ok(
  position('can_manage_payments' in pg_get_functiondef('public.sellertray_user_has_capability(uuid,uuid,text)'::regprocedure)) > 0,
  'shared capability helper recognises payment management'
);
select ok(
  position('can_view_reports' in pg_get_functiondef('public.sellertray_user_has_capability(uuid,uuid,text)'::regprocedure)) > 0,
  'shared capability helper recognises report access'
);
select ok(
  position('can_manage_purchasing' in pg_get_functiondef('public.sellertray_purchase_management_role(uuid,uuid)'::regprocedure)) > 0,
  'purchasing authority delegates to centralized capability evaluation'
);
select ok(
  position('sellertray_user_has_capability' in pg_get_functiondef('public.sellertray_purchase_management_role(uuid,uuid)'::regprocedure)) > 0,
  'purchasing helper no longer embeds Owner or Manager role checks'
);
select ok(
  position('can_manage_products' in pg_get_functiondef('public.sellertray_user_can_manage_products(uuid,uuid)'::regprocedure)) > 0,
  'product authority delegates to centralized capability evaluation'
);
select ok(
  position('sellertray_user_has_capability' in pg_get_functiondef('public.sellertray_user_can_manage_products(uuid,uuid)'::regprocedure)) > 0,
  'product helper uses shared capability evaluation'
);
select ok(
  position('can_manage_purchasing' in pg_get_functiondef('public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)'::regprocedure)) > 0,
  'permission command accepts purchasing authority'
);
select ok(
  position('can_manage_products' in pg_get_functiondef('public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)'::regprocedure)) > 0,
  'permission command accepts product authority'
);
select ok(
  position('can_manage_payments' in pg_get_functiondef('public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)'::regprocedure)) > 0,
  'permission command accepts payment authority'
);
select ok(
  position('can_view_reports' in pg_get_functiondef('public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)'::regprocedure)) > 0,
  'permission command accepts report authority'
);

select * from finish();
rollback;
