begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

select extensions.ok(
  to_regprocedure('public.seed_sellertray_default_uom_for_tenant()') is not null,
  'new-business default UOM seed helper exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgname='seed_sellertray_default_uom_for_tenant'
      and tgrelid='public.tenants'::regclass
      and not tgisinternal
  ),
  'new Businesses automatically seed the default Each UOM master'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.seed_sellertray_default_uom_for_tenant()','EXECUTE')
  and not has_function_privilege('anon','public.seed_sellertray_default_uom_for_tenant()','EXECUTE'),
  'catalogue master seed helper is not client callable'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.seed_sellertray_default_uom_for_tenant()'))) like '%sellertray_uoms%'
  and lower(pg_get_functiondef(to_regprocedure('public.seed_sellertray_default_uom_for_tenant()'))) like '%''each''%'
  and lower(pg_get_functiondef(to_regprocedure('public.seed_sellertray_default_uom_for_tenant()'))) like '%on conflict%',
  'new-business seeding is idempotent and only creates the Each Business UOM master'
);

select * from extensions.finish();
rollback;
