begin;

select plan(8);

select ok(
  to_regprocedure('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)') is not null,
  'governed inventory operation command exists'
);

select ok(
  to_regprocedure('public.record_sellertray_inventory_movement(uuid,uuid,uuid,uuid,text,numeric,text,numeric,numeric,text,text,text,timestamptz,uuid,text,jsonb,date)') is null,
  'stale live-only expiry ledger overload is absent'
);

select ok(
  to_regprocedure('public.record_sellertray_inventory_movement(uuid,uuid,uuid,uuid,text,numeric,text,numeric,numeric,text,text,text,timestamptz,uuid,text,jsonb,uuid)') is not null,
  'authoritative reversal-aware ledger writer exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute inventory operation command'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated role cannot bypass inventory Edge Function'
);

select like(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure),
  '%u.uom_name%',
  'inventory operation uses current UOM schema'
);

select like(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure),
  '%purchase_receipt%',
  'stock receipt uses canonical inventory movement vocabulary'
);

select like(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure),
  '%null::uuid%',
  'inventory operation binds explicitly to authoritative ledger writer'
);

select * from finish();
rollback;
