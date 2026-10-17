begin;
select plan(5);

select ok(
  to_regprocedure('public.sellertray_inventory_command_business_at(text,timestamptz)') is not null,
  'inventory command business-time decoder exists'
);

select is(
  public.sellertray_inventory_command_business_at(
    'invop:adjust:mvctm680:abcdefghijklmn',
    timestamptz '2026-10-17 20:01:00+00'
  ),
  timestamptz '2026-10-17 20:00:00+00',
  'invop command identity preserves original event time'
);

select is(
  public.sellertray_inventory_command_business_at(
    'internal:legacy-command',
    timestamptz '2026-10-17 20:01:00+00'
  ),
  timestamptz '2026-10-17 20:01:00+00',
  'internal and legacy commands retain server fallback time'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_inventory_command_business_at(text,timestamptz)',
    'EXECUTE'
  ),
  'browser clients cannot call the internal business-time decoder'
);

select ok(
  position(
    'public.sellertray_inventory_command_business_at(v_command_id,now())'
    in replace(
      pg_catalog.pg_get_functiondef(
        'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::pg_catalog.regprocedure
      ),
      ' ',
      ''
    )
  )>0,
  'authoritative inventory command records decoded business time'
);

select * from finish();
rollback;
