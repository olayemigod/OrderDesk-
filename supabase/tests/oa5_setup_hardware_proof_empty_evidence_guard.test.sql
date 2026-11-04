begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

-- New setup facts must never be created with an empty/non-printer array,
-- including postgres/supabase_admin maintenance sessions that bypass the
-- historical human checklist but still hit the canonical proof validator.
select extensions.throws_ok(
  $test$ select public.assert_sellertray_setup_printer_proof(
    gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, now()) $test$,
  '22023', null::text, 'No structured equipment array fails closed'
);
select extensions.throws_ok(
  $test$ select public.assert_sellertray_setup_printer_proof(
    gen_random_uuid(), gen_random_uuid(), '{"equipment":[]}'::jsonb, now()) $test$,
  '23514', null::text, 'Empty equipment array cannot bypass the Branch readiness proof'
);
select extensions.throws_ok(
  $test$ select public.assert_sellertray_setup_printer_proof(
    gen_random_uuid(), gen_random_uuid(),
    '{"equipment":[{"kind":"barcode_scanner","identifier":"scanner-1"}]}'::jsonb, now()) $test$,
  '23514', null::text, 'Non-printer equipment cannot satisfy Bluetooth readiness'
);
select extensions.throws_ok(
  $test$ select public.assert_sellertray_setup_printer_proof(
    gen_random_uuid(), gen_random_uuid(),
    '{"equipment":[{"kind":"bluetooth_printer","identifier":"not-registered"}]}'::jsonb, now()) $test$,
  '23514', null::text, 'Unregistered Bluetooth printer never qualifies as native setup proof'
);
select extensions.ok(
  position('assert_sellertray_setup_printer_proof' in pg_get_functiondef(
    'public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)'::regprocedure
  ))>0,
  'Direct new readiness command enforces canonical hardware proof'
);
select * from extensions.finish();
rollback;
