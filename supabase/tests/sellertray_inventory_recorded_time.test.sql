begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(2);

select extensions.ok(
  lower(coalesce((
    select c.column_default
    from information_schema.columns c
    where c.table_schema='public'
      and c.table_name='inventory_movements'
      and c.column_name='created_at'
  ),'')) like '%clock_timestamp%',
  'inventory created_at uses wall-clock recording time rather than transaction-start now()'
);

select extensions.ok(
  lower(pg_get_functiondef('public.rebuild_sellertray_inventory_valuation(uuid,uuid)'::regprocedure))
    like '%order by im.business_at,im.created_at,im.id%',
  'valuation replay uses business time then immutable recording order then movement id'
);

select * from extensions.finish();
rollback;
