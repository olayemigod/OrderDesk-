begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.ok(
  to_regprocedure('public.get_sellertray_whatsapp_management_route(uuid)') is not null,
  'WhatsApp management route read exists at runtime'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_whatsapp_management_route(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_whatsapp_management_route(uuid)','EXECUTE'),
  'WhatsApp management route remains authenticated-only'
);

select extensions.ok(
  to_regprocedure('public.save_sellertray_register(uuid,uuid,uuid,text,text,boolean,boolean)') is not null
  and to_regprocedure('public.get_sellertray_device_management_overview(uuid,uuid)') is not null,
  'device management write and read RPCs exist at runtime'
);

select extensions.ok(
  has_function_privilege('authenticated','public.save_sellertray_register(uuid,uuid,uuid,text,text,boolean,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_device_management_overview(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.save_sellertray_register(uuid,uuid,uuid,text,text,boolean,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_device_management_overview(uuid,uuid)','EXECUTE'),
  'device management runtime RPCs remain authenticated-only'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_printer_receipt_settings(uuid,uuid)') is not null
  and to_regprocedure('public.save_sellertray_printer_receipt_settings(uuid,uuid,jsonb,text)') is not null,
  'governed receipt-copy read and write RPCs remain available'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_printer_receipt_settings(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.save_sellertray_printer_receipt_settings(uuid,uuid,jsonb,text)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_printer_receipt_settings(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.save_sellertray_printer_receipt_settings(uuid,uuid,jsonb,text)','EXECUTE'),
  'receipt-copy settings remain authenticated-only'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_printer_receipt_settings'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_devices%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_printer_events%'
  ),
  'receipt-copy writes preserve Branch, capability and audit governance'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_whatsapp_management_route'
      and lower(pg_get_functiondef(p.oid)) not like '%credentials_ciphertext%'
      and lower(pg_get_functiondef(p.oid)) not like '%credentials_iv%'
      and lower(pg_get_functiondef(p.oid)) not like '%credential_fingerprint%'
  ),
  'WhatsApp management route does not expose credential material'
);

select * from extensions.finish();
rollback;
