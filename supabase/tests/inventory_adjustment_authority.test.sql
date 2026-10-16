begin;
select plan(5);

select ok(
  to_regprocedure('public.apply_sellertray_stock_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,text,text,uuid)') is not null,
  'narrow stock adjustment command exists'
);
select ok(
  not has_function_privilege('anon', 'public.apply_sellertray_stock_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,text,text,uuid)', 'EXECUTE'),
  'anon cannot execute stock adjustment command'
);
select ok(
  not has_function_privilege('authenticated', 'public.apply_sellertray_stock_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,text,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot execute stock adjustment command directly'
);
select ok(
  has_function_privilege('service_role', 'public.apply_sellertray_stock_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,text,text,uuid)', 'EXECUTE'),
  'service runtime can execute governed stock adjustment command'
);
select ok(
  has_function_privilege('service_role', 'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)', 'EXECUTE'),
  'governed server workflows retain the authoritative inventory command'
);

select * from finish();
rollback;
