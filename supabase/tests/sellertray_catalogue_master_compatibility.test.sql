begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

select extensions.ok(
  not exists (
    select 1
    from pg_constraint c
    where c.conrelid='public.sellertray_product_categories'::regclass
      and pg_get_constraintdef(c.oid) ilike '%char_length%'
  ),
  'Product Category master can absorb overlength legacy values during backfill'
);

select extensions.ok(
  not exists (
    select 1
    from pg_constraint c
    where c.conrelid='public.sellertray_uoms'::regclass
      and pg_get_constraintdef(c.oid) ilike '%char_length%'
  ),
  'Business UOM master can absorb overlength legacy values during backfill'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_product_category(uuid,text)'))) like '%char_length(v_name)>120%'
  and lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_uom(uuid,text)'))) like '%char_length(v_name)>80%',
  'managed master creation retains the existing bounded input limits'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_detail(uuid,uuid)'))) like '%sellertray_product_categories%'
  and lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_detail(uuid,uuid)'))) like '%sellertray_uoms%'
  and lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_detail(uuid,uuid)'))) like '%normalized_name=lower(btrim(ci.stock_uom))%',
  'Product management detail resolves Category and Stock UOM to canonical master spelling'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_detail(uuid,uuid)'))) like '%normalized_name=lower(btrim(u.uom_name))%',
  'Product unit detail resolves case-variant UOM values to canonical master spelling'
);

select * from extensions.finish();
rollback;
