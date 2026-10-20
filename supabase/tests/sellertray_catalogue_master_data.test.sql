begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.ok(to_regclass('public.catalogue_categories') is not null, 'Business product category master exists');
select extensions.ok(to_regclass('public.business_uoms') is not null, 'Business UOM master exists');

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.catalogue_categories'::regclass),
  'product category master has RLS enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.business_uoms'::regclass),
  'Business UOM master has RLS enabled'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.catalogue_categories','SELECT')
  and not has_table_privilege('authenticated','public.catalogue_categories','INSERT')
  and not has_table_privilege('authenticated','public.catalogue_categories','UPDATE')
  and not has_table_privilege('authenticated','public.catalogue_categories','DELETE'),
  'authenticated clients cannot bypass governed category commands'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.business_uoms','SELECT')
  and not has_table_privilege('authenticated','public.business_uoms','INSERT')
  and not has_table_privilege('authenticated','public.business_uoms','UPDATE')
  and not has_table_privilege('authenticated','public.business_uoms','DELETE'),
  'authenticated clients cannot bypass governed UOM commands'
);
select extensions.ok(
  has_table_privilege('authenticated','public.catalog_items','SELECT')
  and not has_table_privilege('authenticated','public.catalog_items','INSERT')
  and not has_table_privilege('authenticated','public.catalog_items','UPDATE')
  and not has_table_privilege('authenticated','public.catalog_items','DELETE'),
  'authenticated catalogue access is read-only outside governed product commands'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_catalogue_master_data(uuid)') is not null,
  'catalogue master read model exists'
);
select extensions.ok(
  to_regprocedure('public.create_sellertray_product_category(uuid,text)') is not null,
  'governed category create command exists'
);
select extensions.ok(
  to_regprocedure('public.create_sellertray_business_uom(uuid,text)') is not null,
  'governed Business UOM create command exists'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_catalogue_master_data(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.create_sellertray_product_category(uuid,text)','EXECUTE')
  and has_function_privilege('authenticated','public.create_sellertray_business_uom(uuid,text)','EXECUTE'),
  'authenticated management clients can use governed catalogue master APIs'
);
select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_catalogue_master_data(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_product_category(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_business_uom(uuid,text)','EXECUTE'),
  'anonymous clients cannot use catalogue master APIs'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_catalogue_master_data(uuid)'))) like '%sellertray_user_can_manage_products%'
  and lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_catalogue_master_data(uuid)'))) like '%tenant_id=p_tenant_id%',
  'catalogue master reads enforce product-management authority and tenant isolation'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_product_category(uuid,text)'))) like '%sellertray_user_can_manage_products%'
  and lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_product_category(uuid,text)'))) like '%orderdesk_subscription_can_write%',
  'category creation requires shared capability and writable subscription'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_business_uom(uuid,text)'))) like '%sellertray_user_can_manage_products%'
  and lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_business_uom(uuid,text)'))) like '%orderdesk_subscription_can_write%',
  'Business UOM creation requires shared capability and writable subscription'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)'))) like '%business_uoms%'
  and lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)'))) like '%catalogue_categories%'
  and lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)'))) like '%select an active business unit%'
  and lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)'))) like '%select an active product category%',
  'product save validates selected Business UOM and product category masters'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)'))) like '%business_uoms%'
  and lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)'))) like '%select an active business unit%',
  'product-specific UOM command validates the Business UOM vocabulary'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)'))) like '%save_sellertray_product%',
  'legacy catalogue command delegates product mutation to governed product authority'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger t
    where t.tgrelid='public.tenants'::regclass
      and t.tgname='ensure_sellertray_catalogue_master_defaults'
      and not t.tgisinternal
  ),
  'new Businesses receive catalogue master defaults'
);
select extensions.ok(
  exists (
    select 1 from public.business_uoms u
    where lower(btrim(u.name))='each'
  ) or not exists (select 1 from public.tenants),
  'existing Businesses are backfilled with the Each UOM'
);

select * from extensions.finish();
rollback;
