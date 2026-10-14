begin;

select plan(6);

select ok(
  to_regprocedure('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)') is not null,
  'governed inventory operation command exists'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure)
    like '%inventory-operation:%',
  'inventory operation uses an internal retry identity namespace'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure)
    like '%pg_catalog.md5%'
  and pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure)
    like '%pg_catalog.concat_ws%',
  'internal retry identity fingerprints governed command facts'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure)
    like '%lower(btrim(im.reference_id)) = lower(v_reference)%',
  'merchant-facing reference remains a separate duplicate guard'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure)
    like '%Reference is already used for a different stock movement%',
  'conflicting reuse of one business reference fails closed'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,uuid)'::regprocedure)
    not like '%''inventory:'' || v_operation || '':'' || p_branch_id::text || '':'' ||%lower(v_reference)%',
  'business reference is no longer used as the transport idempotency key'
);

select * from finish();
rollback;
