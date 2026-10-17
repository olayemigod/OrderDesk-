begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

select extensions.ok(
  has_table_privilege('authenticated','public.stock_locations','SELECT')
  and not has_table_privilege('authenticated','public.stock_locations','INSERT')
  and not has_table_privilege('authenticated','public.stock_locations','UPDATE')
  and not has_table_privilege('authenticated','public.stock_locations','DELETE')
  and not has_table_privilege('authenticated','public.stock_locations','TRUNCATE'),
  'stock locations are read-only to authenticated clients'
);

select extensions.ok(
  exists(
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='stock_locations'
      and policyname='stock_locations_select_branch_member'
      and lower(coalesce(qual,'')) like '%sellertray_current_user_can_read_branch%'
  ),
  'stock location reads use current-user Branch authority'
);

select extensions.ok(
  exists(
    select 1
    from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public'
      and t.relname='stock_locations'
      and c.conname='stock_locations_branch_same_tenant'
  ),
  'stock locations remain tenant-bound to their Branch'
);

select * from extensions.finish();
rollback;
