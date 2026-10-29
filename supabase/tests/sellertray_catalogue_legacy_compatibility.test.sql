begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

select extensions.ok(
  to_regprocedure('public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)') is not null,
  'legacy catalogue save command remains available'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)'))) like '%create_sellertray_product_category%'
  and lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)'))) like '%save_sellertray_product%',
  'legacy catalogue save converges category input into the governed master before Product save'
);

select extensions.ok(
  has_function_privilege('authenticated','public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)','EXECUTE'),
  'legacy compatibility preserves authenticated command authority without anonymous access'
);

select * from extensions.finish();
rollback;
