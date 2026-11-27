begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

-- SQL SECURITY DEFINER executes as function owner, not as the JWT actor.
-- A postgres-owner exemption is never proof that a signed-in merchant
-- is entitled to inspect another Business or Branch.
select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and p.proowner='postgres'::regrole
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and p.prosrc ~* 'current_user[[:space:]]*(!=|<>|=)[[:space:]]*''postgres'''
  ),
  0,
  'no merchant-callable SECURITY DEFINER trusts its postgres owner as caller authority'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'get_sellertray_branch_stock_as_of',
        'get_sellertray_branch_stock_valuation',
        'get_sellertray_order_profitability'
      )
      and p.prosecdef
      and p.prosrc like '%service_role%'
      and p.prosrc like '%sellertray_current_user_can_read_branch%'
  ),
  3,
  'all three governed report RPCs preserve explicit signed caller/Branch authority'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.snapshot_sellertray_order_branch_name()','EXECUTE')
  and not has_function_privilege('anon','public.snapshot_sellertray_order_branch_name()','EXECUTE'),
  'internal Order Branch snapshot helper stays non-callable from client roles'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.snapshot_sellertray_receipt_branch_name()','EXECUTE')
  and not has_function_privilege('anon','public.snapshot_sellertray_receipt_branch_name()','EXECUTE'),
  'internal Receipt Branch snapshot helper stays non-callable from client roles'
);

select * from extensions.finish();
rollback;
