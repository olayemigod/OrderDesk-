begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(18);

select extensions.ok(to_regclass('public.sellertray_product_categories') is not null, 'product category master table exists');
select extensions.ok(to_regclass('public.sellertray_uoms') is not null, 'UOM master table exists');
select extensions.ok(to_regprocedure('public.get_sellertray_catalogue_masters(uuid)') is not null, 'catalogue master read RPC exists');
select extensions.ok(to_regprocedure('public.create_sellertray_product_category(uuid,text)') is not null, 'product category create RPC exists');
select extensions.ok(to_regprocedure('public.create_sellertray_uom(uuid,text)') is not null, 'UOM create RPC exists');

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_product_categories','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_product_categories','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_uoms','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_uoms','INSERT'),
  'clients cannot bypass catalogue-master RPC authority with direct table access'
);
select extensions.ok(
  not has_table_privilege('anon','public.sellertray_product_categories','SELECT')
  and not has_table_privilege('anon','public.sellertray_uoms','SELECT'),
  'anonymous clients cannot read catalogue masters directly'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_catalogue_masters(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.create_sellertray_product_category(uuid,text)','EXECUTE')
  and has_function_privilege('authenticated','public.create_sellertray_uom(uuid,text)','EXECUTE'),
  'authenticated clients can use governed catalogue master RPCs'
);
select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_catalogue_masters(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_product_category(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_uom(uuid,text)','EXECUTE'),
  'anonymous clients cannot execute catalogue master RPCs'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_product_category(uuid,text)'))) like '%sellertray_user_can_manage_products%'
  and lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_uom(uuid,text)'))) like '%sellertray_user_can_manage_products%',
  'master creation uses shared Owner/Manager product authority'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_product_category(uuid,text)'))) like '%orderdesk_subscription_can_write%'
  and lower(pg_get_functiondef(to_regprocedure('public.create_sellertray_uom(uuid,text)'))) like '%orderdesk_subscription_can_write%',
  'master creation respects writable subscription authority'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_catalogue_masters(uuid)'))) like '%tenant_members%'
  and lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_catalogue_masters(uuid)'))) like '%tm.tenant_id=p_tenant_id%'
  and lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_catalogue_masters(uuid)'))) like '%tm.user_id=v_user_id%',
  'master reads remain tenant membership scoped'
);

select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)'))) like '%sellertray_uoms%'
  and lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)'))) like '%sellertray_product_categories%',
  'product save validates Stock UOM and Category against Business masters'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)'))) like '%sellertray_uoms%',
  'product UOM save validates against the Business UOM master'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)'))) like '%sellertray_product_categories%'
  and lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)'))) like '%sellertray_uoms%',
  'product management filter choices come from governed masters'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgname='register_sellertray_catalogue_item_masters' and not tgisinternal
  ),
  'legacy/internal product writes converge values into the same master vocabulary'
);
select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgname='register_sellertray_catalogue_uom_master' and not tgisinternal
  ),
  'legacy/internal product-UOM writes converge values into the same master vocabulary'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)'))) like '%create or select a valid stock uom%'
  and lower(pg_get_functiondef(to_regprocedure('public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)'))) like '%create or select a valid business uom%',
  'unknown free-entry units are rejected by product management commands'
);

select * from extensions.finish();
rollback;
