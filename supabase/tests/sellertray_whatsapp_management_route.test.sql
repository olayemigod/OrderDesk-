begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

select extensions.ok(
  to_regprocedure('public.get_sellertray_whatsapp_management_route(uuid)') is not null,
  'WhatsApp management route read model exists'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='get_sellertray_whatsapp_management_route'
      and p.prosecdef=true
  ),
  'WhatsApp management route read model is security definer'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_whatsapp_management_route(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_whatsapp_management_route(uuid)','EXECUTE'),
  'management route is authenticated-only'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_whatsapp_management_route'
      and lower(pg_get_functiondef(p.oid)) like '%owner%'
      and lower(pg_get_functiondef(p.oid)) like '%manager%'
  ),
  'WhatsApp route read remains limited to business management roles'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_whatsapp_management_route'
      and lower(pg_get_functiondef(p.oid)) like '%displayphonenumber%'
      and lower(pg_get_functiondef(p.oid)) like '%verifiedname%'
      and lower(pg_get_functiondef(p.oid)) like '%branchid%'
      and lower(pg_get_functiondef(p.oid)) like '%connectionstatus%'
      and lower(pg_get_functiondef(p.oid)) not like '%credentials_ciphertext%'
      and lower(pg_get_functiondef(p.oid)) not like '%credentials_iv%'
      and lower(pg_get_functiondef(p.oid)) not like '%credential_fingerprint%'
  ),
  'WhatsApp management read model returns safe connection/routing fields without credential material'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_sellertray_whatsapp_branch'
      and lower(pg_get_functiondef(p.oid)) like '%owner%'
      and lower(pg_get_functiondef(p.oid)) like '%manager%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
      and lower(pg_get_functiondef(p.oid)) like '%is_active = true%'
  ),
  'existing receiving-Branch mutation remains management-only, subscription-aware and active-Branch-only'
);

select * from extensions.finish();
rollback;
