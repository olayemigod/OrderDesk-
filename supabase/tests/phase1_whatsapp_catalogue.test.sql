begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);
select extensions.ok(to_regclass('public.inbound_message_media') is not null,'inbound WhatsApp image metadata table exists');
select extensions.ok(to_regclass('public.catalogue_capture_candidates') is not null,'catalogue chat candidate table exists');
select extensions.ok(to_regclass('public.tenant_channel_consents') is not null,'versioned channel consent table exists');
select extensions.ok(to_regclass('public.tenant_whatsapp_catalog_settings') is not null,'WhatsApp catalogue settings table exists');
select extensions.ok((select relrowsecurity from pg_class where oid='public.inbound_message_media'::regclass),'inbound media keeps RLS enabled');
select extensions.ok((select relrowsecurity from pg_class where oid='public.catalogue_capture_candidates'::regclass),'catalogue candidates keep RLS enabled');
select extensions.ok((select relrowsecurity from pg_class where oid='public.tenant_channel_consents'::regclass),'channel consents keep RLS enabled');
select extensions.ok((select relrowsecurity from pg_class where oid='public.tenant_whatsapp_catalog_settings'::regclass),'WhatsApp catalogue settings keep RLS enabled');
select extensions.ok(not has_function_privilege('authenticated','public.resolve_sellertray_whatsapp_catalog_items(uuid,text,text[])','EXECUTE'),'catalogue resolver is server-only');
select extensions.ok(has_function_privilege('service_role','public.resolve_sellertray_whatsapp_catalog_items(uuid,text,text[])','EXECUTE'),'service role can resolve WhatsApp catalogue mappings');
select extensions.ok(not has_function_privilege('authenticated','public.finalize_sellertray_catalogue_candidate_conversion(uuid,uuid,uuid,text,text,text,numeric,text,text,text)','EXECUTE'),'candidate conversion is server-only');
select extensions.ok(has_function_privilege('service_role','public.finalize_sellertray_catalogue_candidate_conversion(uuid,uuid,uuid,text,text,text,numeric,text,text,text)','EXECUTE'),'service role can finalize candidate conversion');
select extensions.ok(position('native_catalog' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.orders'::regclass and conname='orders_parser_source_check')))>0,'orders allow native catalogue provenance');
select extensions.ok(position('whatsapp_catalog' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.order_items'::regclass and conname='order_items_match_source_check')))>0,'order items allow WhatsApp catalogue match provenance');
select extensions.ok(not (select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_sellertray_customer_profile' limit 1),'customer profile RPC uses SECURITY INVOKER');
select extensions.ok(
  has_column_privilege('authenticated','public.customers','display_name','UPDATE')
  and has_column_privilege('authenticated','public.customers','email','UPDATE')
  and not has_column_privilege('authenticated','public.customers','phone','UPDATE')
  and not has_column_privilege('authenticated','public.customers','wa_id','UPDATE'),
  'customer update grants are limited to safe metadata');
select * from extensions.finish();
rollback;
