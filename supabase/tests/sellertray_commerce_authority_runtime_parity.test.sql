begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

select extensions.ok(
  to_regprocedure('public.sellertray_purchase_management_role(uuid,uuid)') is not null,
  'purchasing authority helper exists'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_purchase_management_role'
      and p.prosecdef=true
      and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']::text[]
  ),
  'purchasing authority helper is security definer with empty search path'
);

select extensions.ok(
  has_function_privilege('service_role','public.sellertray_purchase_management_role(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.sellertray_purchase_management_role(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_purchase_management_role(uuid,uuid)','EXECUTE'),
  'purchasing authority helper remains internal'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_purchase_management_role'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_has_capability%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_purchasing%'
      and lower(pg_get_functiondef(p.oid)) not like '%role in (%'
  ),
  'purchasing authority resolves through the governed capability engine'
);

select extensions.ok(
  to_regprocedure('public.sellertray_user_can_manage_products(uuid,uuid)') is not null,
  'product management authority helper exists'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_user_can_manage_products'
      and p.prosecdef=true
      and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']::text[]
  ),
  'product management authority helper is security definer with empty search path'
);

select extensions.ok(
  has_function_privilege('service_role','public.sellertray_user_can_manage_products(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.sellertray_user_can_manage_products(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.sellertray_user_can_manage_products(uuid,uuid)','EXECUTE'),
  'product management authority helper remains internal to governed commands'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_user_can_manage_products'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_has_capability%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) not like '%role in (%'
  ),
  'product management authority resolves through the governed capability engine'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.tenant_member_capabilities'::regclass
      and c.conname='tenant_member_capabilities_capability_check'
      and pg_get_constraintdef(c.oid) like '%can_manage_products%'
      and pg_get_constraintdef(c.oid) like '%can_manage_purchasing%'
      and pg_get_constraintdef(c.oid) like '%can_refund_sale%'
  ),
  'current member capability vocabulary preserves product, purchasing and refund authority'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellertray_user_has_capability'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_purchasing%'
      and lower(pg_get_functiondef(p.oid)) like '%can_refund_sale%'
  ),
  'central capability engine keeps the current commerce authority vocabulary'
);

select * from extensions.finish();
rollback;
