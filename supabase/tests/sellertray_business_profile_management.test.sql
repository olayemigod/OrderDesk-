begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

select extensions.ok(
  to_regprocedure('public.get_sellertray_business_profile(uuid)') is not null,
  'Business profile management read exists'
);

select extensions.ok(
  to_regprocedure('public.save_sellertray_business_profile(uuid,text,text,text,text,text,text,text)') is not null,
  'Business profile management command exists'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_business_profile'
      and p.prosecdef=true and p.provolatile='s'
  ),
  'Business profile read is stable security definer'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_business_profile'
      and p.prosecdef=true
  ),
  'Business profile save is security definer'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_business_profile(uuid)','EXECUTE')
  and has_function_privilege('service_role','public.get_sellertray_business_profile(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_business_profile(uuid)','EXECUTE'),
  'Business profile read is authenticated/server only'
);

select extensions.ok(
  has_function_privilege('authenticated','public.save_sellertray_business_profile(uuid,text,text,text,text,text,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.save_sellertray_business_profile(uuid,text,text,text,text,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.save_sellertray_business_profile(uuid,text,text,text,text,text,text,text)','EXECUTE'),
  'Business profile save is authenticated/server only'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_business_profile'
      and lower(pg_get_functiondef(p.oid)) like '%owner%manager%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'Business profile updates require Owner/Manager write authority and writable subscription'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_business_profile'
      and lower(pg_get_functiondef(p.oid)) like '%currency%3-letter%'
      and lower(pg_get_functiondef(p.oid)) like '%pg_timezone_names%'
  ),
  'Business profile command validates currency and timezone server-side'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_business_profile'
      and lower(pg_get_functiondef(p.oid)) like '%business-logos%'
      and lower(pg_get_functiondef(p.oid)) like '%storage.objects%'
      and lower(pg_get_functiondef(p.oid)) like '%business logo must use the governed sellertray logo store%'
      and lower(pg_get_functiondef(p.oid)) like '%business logo is not a valid sellertray-managed image%'
  ),
  'Business profile command accepts only existing tenant-scoped governed logo objects'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_business_profile'
      and lower(pg_get_functiondef(p.oid)) like '%merchant_code%'
      and lower(pg_get_functiondef(p.oid)) like '%subscription_status%'
      and lower(pg_get_functiondef(p.oid)) like '%whatsapp_connection_status%'
  ),
  'Business profile read exposes management identity/status without browser table reads'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_business_profile'
      and lower(pg_get_functiondef(p.oid)) not like '%delete from public.%'
      and lower(pg_get_functiondef(p.oid)) not like '%insert into public.orders%'
  ),
  'Business profile command is scoped to profile mutation only'
);

select * from extensions.finish();
rollback;
