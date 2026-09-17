begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)',
    'EXECUTE'
  ),
  'one-off price resolution is authenticated-only'
);

select extensions.ok(
  position('tenant_members' in pg_get_functiondef(
    'public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure
  )) > 0,
  'one-off price resolution verifies SellerTray tenant membership'
);

select extensions.ok(
  position('Only an Owner or Manager can approve a one-off selling price' in pg_get_functiondef(
    'public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure
  )) > 0
  and position('owner' in pg_get_functiondef(
    'public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure
  )) > 0
  and position('manager' in pg_get_functiondef(
    'public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure
  )) > 0,
  'arbitrary one-off selling prices require Owner or Manager authority'
);

select extensions.ok(
  (select proconfig = array['search_path=""']::text[]
   from pg_proc
   where oid='public.sellertray_keep_order_item_one_off(uuid,uuid,numeric,text)'::regprocedure),
  'one-off price SECURITY DEFINER RPC keeps an empty search path'
);

select * from extensions.finish();
rollback;
