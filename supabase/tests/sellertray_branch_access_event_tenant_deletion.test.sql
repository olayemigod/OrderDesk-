begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

select extensions.ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class child on child.oid=c.conrelid
    join pg_namespace n on n.oid=child.relnamespace
    where n.nspname='public'
      and child.relname='sellertray_branch_access_events'
      and c.conname='sellertray_branch_access_events_branch_same_tenant'
      and c.contype='f'
      and c.confdeltype='c'
  ),
  'Branch access audit rows cascade only with Branch/tenant deletion lifecycle'
);

select * from extensions.finish();
rollback;
