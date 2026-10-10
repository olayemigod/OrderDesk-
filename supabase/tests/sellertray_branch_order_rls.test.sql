begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

select extensions.ok(
  (select qual ilike '%sellertray_user_can_read_branch%'
   from pg_policies
   where schemaname='public' and tablename='orders' and policyname='orders_select_member'),
  'order reads use historical Branch access'
);

select extensions.ok(
  (select with_check ilike '%sellertray_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='orders' and policyname='orders_insert_member'),
  'order inserts require active Branch access'
);

select extensions.ok(
  (select qual ilike '%sellertray_user_can_access_branch%'
      and with_check ilike '%sellertray_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='orders' and policyname='orders_update_member'),
  'order updates require active Branch access before and after mutation'
);

select extensions.ok(
  (select qual ilike '%sellertray_user_can_read_branch%'
   from pg_policies
   where schemaname='public' and tablename='order_items' and policyname='order_items_select_member'),
  'order-item reads inherit historical parent-order Branch access'
);

select extensions.ok(
  (select with_check ilike '%sellertray_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='order_items' and policyname='order_items_insert_member'),
  'order-item inserts inherit active parent-order Branch access'
);

select extensions.ok(
  (select qual ilike '%sellertray_user_can_access_branch%'
      and with_check ilike '%sellertray_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='order_items' and policyname='order_items_update_member'),
  'order-item updates inherit active parent-order Branch access'
);

select extensions.ok(
  (select qual ilike '%sellertray_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='order_items' and policyname='order_items_delete_member'),
  'order-item deletes inherit active parent-order Branch access'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.orders'::regclass),
  'orders keep RLS enabled'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.order_items'::regclass),
  'order items keep RLS enabled'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_user_can_access_branch(uuid,uuid,uuid)','EXECUTE'),
  'authenticated mutation policies can evaluate active Branch access'
);

select extensions.ok(
  has_function_privilege('authenticated','public.sellertray_user_can_read_branch(uuid,uuid,uuid)','EXECUTE'),
  'authenticated read policies can evaluate historical Branch access'
);

select * from extensions.finish();
rollback;