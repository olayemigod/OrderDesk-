begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(
  to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)') is not null,
  'paged product management read model exists'
);
select extensions.ok(
  to_regprocedure('public.get_sellertray_product_management_detail(uuid,uuid)') is not null,
  'product management detail read model exists'
);
select extensions.ok(
  (
    select p.prosecdef and p.provolatile='s'
    from pg_proc p
    where p.oid=to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)')
  ),
  'product page read model is stable and security definer'
);
select extensions.ok(
  (
    select p.prosecdef and p.provolatile='s'
    from pg_proc p
    where p.oid=to_regprocedure('public.get_sellertray_product_management_detail(uuid,uuid)')
  ),
  'product detail read model is stable and security definer'
);
select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_product_management_detail(uuid,uuid)','EXECUTE'),
  'authenticated management clients can use product read models'
);
select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_product_management_detail(uuid,uuid)','EXECUTE'),
  'anonymous clients cannot use product management read models'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)')))
    like '%sellertray_user_can_manage_products%',
  'product page uses shared product management authority'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_detail(uuid,uuid)')))
    like '%sellertray_user_can_manage_products%',
  'product detail uses shared product management authority'
);
select extensions.ok(
  regexp_replace(lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)'))), '\s+', '', 'g')
    like '%ci.tenant_id=p_tenant_id%'
  and regexp_replace(lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)'))), '\s+', '', 'g')
    like '%u.tenant_id=ci.tenant_id%',
  'product page keeps product and UOM reads tenant isolated'
);
select extensions.ok(
  regexp_replace(lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)'))), '\s+', '', 'g')
    like '%limitv_page_size%'
  and regexp_replace(lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)'))), '\s+', '', 'g')
    like '%offset((v_page-1)*v_page_size)%'
  and regexp_replace(lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)'))), '\s+', '', 'g')
    like '%least(coalesce(p_page_size,25),100)%',
  'product page enforces bounded server pagination'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)')))
    like '%p_missing_barcode%'
  and lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)')))
    like '%p_missing_price%'
  and lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)')))
    like '%v_category%'
  and lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_page(uuid,text,text,text,text,boolean,boolean,integer,integer)')))
    like '%v_uom%',
  'product page applies governed management filters'
);
select extensions.ok(
  lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_detail(uuid,uuid)')))
    like '%catalog_item_uoms%'
  and regexp_replace(lower(pg_get_functiondef(to_regprocedure('public.get_sellertray_product_management_detail(uuid,uuid)'))), '\s+', '', 'g')
    like '%ci.id=p_product_id%',
  'product detail returns governed UOM and barcode configuration for one product'
);

select * from extensions.finish();
rollback;
