begin;

select plan(10);

select ok(
  to_regprocedure('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)') is not null,
  'authoritative governed inventory operation command exists'
);

select ok(
  to_regprocedure('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)') is not null,
  'internal compatibility inventory operation command exists'
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
    'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute authoritative inventory operation command'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated role cannot bypass inventory Edge Function'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%u.uom_name%',
  'inventory operation uses current UOM schema'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%purchase_receipt%'
  and pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%opening%'
  and pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%damaged%'
  and pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%expired%',
  'inventory operation uses canonical movement vocabulary'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%null::uuid%',
  'inventory operation binds explicitly to authoritative ledger writer'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure)
    like '%internal:%'
  and pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure)
    like '%public.apply_sellertray_inventory_operation%',
  'legacy internal callers delegate to the authoritative command overload'
);

select * from finish();
rollback;