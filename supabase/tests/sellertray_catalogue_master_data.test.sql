begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.ok(to_regclass('public.catalog_categories') is not null, 'catalog category master table exists');
select extensions.ok(to_regclass('public.catalog_uoms') is not null, 'catalog UOM master table exists');

select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.catalog_categories'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) like '%tenant_id%name_key%'
  ),
  'category names are unique per business after normalization'
);
select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.catalog_uoms'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) like '%tenant_id%name_key%'
  ),
  'UOM names are unique per business after normalization'
);

select extensions.ok(to_regprocedure('public.get_sellertray_catalogue_masters(uuid)') is not null, 'catalogue master read RPC exists');
select extensions.ok(to_regprocedure('public.create_sellertray_product_category(uuid,text)') is not null, 'category create RPC exists');
select extensions.ok(to_regprocedure('public.create_sellertray_uom(uuid,text)') is not null, 'UOM create RPC exists');

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_catalogue_masters(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.create_sellertray_product_category(uuid,text)','EXECUTE')
  and has_function_privilege('authenticated','public.create_sellertray_uom(uuid,text)','EXECUTE'),
  'authenticated management clients can use catalogue master RPCs'
);
select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_catalogue_masters(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_product_category(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_uom(uuid,text)','EXECUTE'),
  'anonymous callers cannot use catalogue master RPCs'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.catalog_categories','SELECT')
  and not has_table_privilege('authenticated','public.catalog_categories','INSERT')
  and not has_table_privilege('authenticated','public.catalog_categories','UPDATE')
  and not has_table_privilege('authenticated','public.catalog_categories','DELETE'),
  'category master table is not a direct browser write/read boundary'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.catalog_uoms','SELECT')
  and not has_table_privilege('authenticated','public.catalog_uoms','INSERT')
  and not has_table_privilege('authenticated','public.catalog_uoms','UPDATE')
  and not has_table_privilege('authenticated','public.catalog_uoms','DELETE'),
  'UOM master table is not a direct browser write/read boundary'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_catalogue_masters(uuid)'))) like '%sellertray_user_can_manage_products%',
  'catalogue master reads use shared product-management authority'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_product_category(uuid,text)'))) like '%sellertray_user_can_manage_products%'
  and lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_product_category(uuid,text)'))) like '%orderdesk_subscription_can_write%',
  'category creation requires product authority and writable subscription'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_uom(uuid,text)'))) like '%sellertray_user_can_manage_products%'
  and lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_uom(uuid,text)'))) like '%orderdesk_subscription_can_write%',
  'UOM creation requires product authority and writable subscription'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)'))) like '%catalog_categories%'
  and lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)'))) like '%catalog_uoms%',
  'product save validates category and Stock UOM against business masters'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)'))) like '%catalog_uoms%',
  'product unit save validates alternate units against the shared UOM master'
);

select extensions.ok(to_regprocedure('public.validate_sellertray_catalogue_master_refs()') is not null, 'direct product writes have a catalogue-master guard');
select extensions.ok(to_regprocedure('public.validate_sellertray_product_uom_master_ref()') is not null, 'direct product-UOM writes have a master guard');

select extensions.ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.catalog_items'::regclass
      and not t.tgisinternal
      and t.tgname='validate_sellertray_catalogue_master_refs'
  ),
  'catalog item master guard is installed'
);
select extensions.ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.catalog_item_uoms'::regclass
      and not t.tgisinternal
      and t.tgname='catalogue_uom_master_ref_guard'
  ),
  'product UOM master guard is installed'
);

select * from extensions.finish();
rollback;
