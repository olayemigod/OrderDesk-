begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_user_can_access_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute arbitrary-user active Branch authority directly'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sellertray_user_can_access_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute arbitrary-user active Branch authority'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sellertray_user_can_access_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role retains explicit-user active Branch authority'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_current_user_can_access_branch(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated can evaluate current-user active Branch authority'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sellertray_current_user_can_access_branch(uuid,uuid)',
    'EXECUTE'
  ),
  'anon cannot evaluate current-user active Branch authority'
);

select extensions.ok(
  (
    select p.prosrc ilike '%auth.uid%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sellertray_current_user_can_access_branch'
      and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_branch_id uuid'
  ),
  'active Branch wrapper binds authority to auth.uid()'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_policies
    where concat_ws(' ',qual,with_check) ilike '%sellertray_user_can_access_branch(%'
  ),
  0,
  'RLS policies do not invoke the arbitrary-user active Branch helper'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and not p.prosecdef
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and p.prosrc ilike '%sellertray_user_can_access_branch(%'
  ),
  0,
  'authenticated SECURITY INVOKER functions do not depend on arbitrary-user active Branch authority'
);

select extensions.ok(
  (select with_check ilike '%sellertray_current_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='orders' and policyname='orders_insert_member'),
  'order inserts bind active Branch authority to the current user'
);

select extensions.ok(
  (select qual ilike '%sellertray_current_user_can_access_branch%'
      and with_check ilike '%sellertray_current_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='orders' and policyname='orders_update_member'),
  'order updates bind active Branch authority to the current user'
);

select extensions.ok(
  (select with_check ilike '%sellertray_current_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='order_items' and policyname='order_items_insert_member'),
  'order-item inserts inherit current-user active Branch authority'
);

select extensions.ok(
  (select qual ilike '%sellertray_current_user_can_access_branch%'
      and with_check ilike '%sellertray_current_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='order_items' and policyname='order_items_update_member'),
  'order-item updates inherit current-user active Branch authority'
);

select extensions.ok(
  (select qual ilike '%sellertray_current_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='order_items' and policyname='order_items_delete_member'),
  'order-item deletes inherit current-user active Branch authority'
);

select * from extensions.finish();
rollback;
