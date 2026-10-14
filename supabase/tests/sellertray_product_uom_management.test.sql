begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'save_sellertray_product',
        'set_sellertray_product_active',
        'save_sellertray_product_uom',
        'delete_sellertray_product_uom'
      )
  ),
  4,
  'shared product and UOM management commands exist'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'save_sellertray_product',
        'set_sellertray_product_active',
        'save_sellertray_product_uom',
        'delete_sellertray_product_uom'
      )
      and p.prosecdef=true
  ),
  4,
  'all product and UOM management commands are security definer functions'
);

select extensions.ok(
  has_function_privilege('authenticated','public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)','EXECUTE'),
  'authenticated merchants can call product save command'
);
select extensions.ok(
  has_function_privilege('authenticated','public.set_sellertray_product_active(uuid,uuid,boolean)','EXECUTE'),
  'authenticated merchants can call product active-state command'
);
select extensions.ok(
  has_function_privilege('authenticated','public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)','EXECUTE'),
  'authenticated merchants can call UOM save command'
);
select extensions.ok(
  has_function_privilege('authenticated','public.delete_sellertray_product_uom(uuid,uuid,uuid)','EXECUTE'),
  'authenticated merchants can call UOM delete command'
);

select extensions.ok(
  has_table_privilege('authenticated','public.catalog_item_uoms','SELECT'),
  'authenticated members retain read access to product UOMs'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.catalog_item_uoms','INSERT'),
  'authenticated clients cannot insert product UOM rows directly'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.catalog_item_uoms','UPDATE'),
  'authenticated clients cannot update product UOM rows directly'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.catalog_item_uoms','DELETE'),
  'authenticated clients cannot delete product UOM rows directly'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_product'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'product save command enforces shared product capability and writable subscription'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_sellertray_product_active'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'product active-state command enforces shared product capability and writable subscription'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_product_uom'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'UOM save command enforces shared product capability and writable subscription'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='delete_sellertray_product_uom'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'UOM delete command enforces shared product capability and writable subscription'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_product_uom'
      and lower(pg_get_functiondef(p.oid)) like '%stock uom cannot be renamed%'
      and lower(pg_get_functiondef(p.oid)) like '%stock uom conversion factor must be 1%'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%setis_default_selling=false%'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%setis_default_purchase=false%'
  ),
  'UOM save command protects Stock UOM identity and atomically switches defaults'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='delete_sellertray_product_uom'
      and lower(pg_get_functiondef(p.oid)) like '%stock uom cannot be deleted%'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%setis_default_selling=true%'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%setis_default_purchase=true%'
  ),
  'UOM delete command protects Stock UOM and restores defaults when needed'
);

select extensions.ok(
  not has_function_privilege('anon','public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)','EXECUTE')
  and not has_function_privilege('anon','public.set_sellertray_product_active(uuid,uuid,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.delete_sellertray_product_uom(uuid,uuid,uuid)','EXECUTE'),
  'anonymous users cannot execute product or UOM management commands'
);

select * from extensions.finish();
rollback;
