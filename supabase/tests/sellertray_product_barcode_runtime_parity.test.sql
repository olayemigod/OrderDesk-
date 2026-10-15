begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'get_sellertray_product_capabilities',
        'resolve_sellertray_product_barcode',
        'create_sellertray_product_from_barcode'
      )
  ),
  3,
  'product barcode runtime RPCs exist'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'get_sellertray_product_capabilities',
        'resolve_sellertray_product_barcode',
        'create_sellertray_product_from_barcode'
      )
      and p.prosecdef=true
  ),
  3,
  'product barcode runtime RPCs are security definer functions'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'get_sellertray_product_capabilities',
        'resolve_sellertray_product_barcode',
        'create_sellertray_product_from_barcode'
      )
      and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']::text[]
  ),
  3,
  'product barcode runtime RPCs pin an empty search path'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_product_capabilities(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.resolve_sellertray_product_barcode(uuid,text)','EXECUTE')
  and has_function_privilege('authenticated','public.create_sellertray_product_from_barcode(uuid,text,text,text,text,numeric,text,boolean)','EXECUTE'),
  'authenticated merchants can execute product barcode runtime RPCs'
);

select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_product_capabilities(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.resolve_sellertray_product_barcode(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.create_sellertray_product_from_barcode(uuid,text,text,text,text,numeric,text,boolean)','EXECUTE'),
  'anonymous users cannot execute product barcode runtime RPCs'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='get_sellertray_product_capabilities'
      and lower(pg_get_functiondef(p.oid)) like '%tenant_members%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_manage_products%'
  ),
  'product capability RPC requires tenant membership and current product authority'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='resolve_sellertray_product_barcode'
      and lower(pg_get_functiondef(p.oid)) like '%tenant_members%'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%whereu.tenant_id=p_tenant_id%'
      and lower(pg_get_functiondef(p.oid)) like '%btrim(u.barcode)=v_barcode%'
  ),
  'barcode resolver requires tenant membership and keeps barcode lookup tenant scoped'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='create_sellertray_product_from_barcode'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'barcode product creation enforces current product authority and writable subscription'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='create_sellertray_product_from_barcode'
      and lower(pg_get_functiondef(p.oid)) like '%save_sellertray_product%'
      and lower(pg_get_functiondef(p.oid)) not like '%insert into public.catalog_items%'
  ),
  'barcode product creation reuses the governed shared product command'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='create_sellertray_product_from_barcode'
      and regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', '', 'g') like '%u.tenant_id=p_tenant_idandu.catalog_item_id=v_product_id%'
      and lower(pg_get_functiondef(p.oid)) like '%set barcode=v_barcode%'
  ),
  'barcode product creation attaches the barcode only to the governed product Stock UOM row'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='catalog_item_uoms'
      and indexname='catalog_item_uoms_barcode_unique'
      and lower(indexdef) like '%tenant_id%'
      and lower(indexdef) like '%btrim(barcode)%'
  ),
  'tenant-scoped barcode uniqueness remains enforced by the UOM index'
);

select * from extensions.finish();
rollback;
