begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.ok(
  to_regprocedure('public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)') is not null,
  'governed catalogue save command exists'
);

select extensions.ok(
  exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.oid='public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)'::regprocedure
      and p.prosecdef=true
  ),
  'catalogue save command is security definer'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)',
    'EXECUTE'
  ),
  'catalogue save command is authenticated-only'
);

select extensions.ok(
  exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.oid='public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)'::regprocedure
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
      and lower(pg_get_functiondef(p.oid)) like '%save_sellertray_product%'
  ),
  'catalogue save command reuses product authority and writable-subscription governance'
);

select extensions.ok(
  exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.oid='public.save_sellertray_catalogue_item(uuid,uuid,text,text,text,text,numeric,jsonb)'::regprocedure
      and lower(pg_get_functiondef(p.oid)) like '%select ci.stock_uom,ci.allow_fractional_stock%'
      and lower(pg_get_functiondef(p.oid)) like '%delete from public.catalog_item_aliases%'
      and lower(pg_get_functiondef(p.oid)) like '%group by lower(btrim%'
  ),
  'catalogue adapter preserves UOM foundations and replaces normalized aliases atomically'
);

select extensions.ok(
  has_table_privilege('authenticated','public.catalog_item_aliases','SELECT')
  and not has_table_privilege('authenticated','public.catalog_item_aliases','INSERT')
  and not has_table_privilege('authenticated','public.catalog_item_aliases','UPDATE')
  and not has_table_privilege('authenticated','public.catalog_item_aliases','DELETE'),
  'catalogue aliases are read-only to authenticated clients'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname='public'
      and tablename='catalog_item_aliases'
      and policyname in (
        'catalog_item_aliases_insert_owner_manager',
        'catalog_item_aliases_update_owner_manager',
        'catalog_item_aliases_delete_owner_manager',
        'catalog_item_aliases_manage_management'
      )
  ),
  0,
  'legacy direct alias mutation policies are removed'
);

select extensions.ok(
  to_regprocedure('public.save_sellertray_product(uuid,uuid,text,text,text,text,boolean,numeric)') is not null
  and to_regprocedure('public.set_sellertray_product_active(uuid,uuid,boolean)') is not null
  and to_regprocedure('public.save_sellertray_product_uom(uuid,uuid,uuid,text,numeric,numeric,text,boolean,boolean,boolean)') is not null
  and to_regprocedure('public.delete_sellertray_product_uom(uuid,uuid,uuid)') is not null,
  'authoritative product and UOM commands exist before catalogue direct writes are removed'
);

select extensions.ok(
  exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='catalog_items'
      and t.tgname='sync_sellertray_stock_uom_row'
      and not t.tgisinternal
  ),
  'catalogue writes retain Stock UOM synchronization trigger'
);

select * from extensions.finish();
rollback;
