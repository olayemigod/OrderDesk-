begin;

select plan(7);

select ok(
  to_regprocedure('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)') is not null,
  'governed inventory operation command with explicit command identity exists'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%inventory-operation:%',
  'inventory operation uses an internal retry identity namespace'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%p_command_id%'
  and pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%pg_catalog.md5%',
  'transport retry identity derives from the hidden command identity'
);

select ok(
  position('reference_id' in pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)) > 0
  and position('reference_type' in pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)) > 0
  and position('v_reference' in pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)) > 0,
  'merchant-facing reference remains a separate duplicate guard'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%Stock action retry identity is already used for different stock facts%',
  'conflicting reuse of one command identity fails closed'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%Reference is already used for a different stock movement%',
  'conflicting reuse of one business reference also fails closed'
);

select ok(
  pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    not like '%p_command_id%v_reference%'
  or pg_get_functiondef('public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure)
    like '%p_tenant_id::text || ''|'' || v_command_id%',
  'business reference is not the transport idempotency key'
);

select * from finish();
rollback;
