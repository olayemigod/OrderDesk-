begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_stock_movements'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'stock movement history uses historical Branch read access'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_stock_count'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'stock count detail uses historical Branch read access'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_stock_transfer'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'stock transfer detail uses historical Branch read access'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_stock_transfers'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'stock transfer history list uses historical Branch read access'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_cash_shift_history'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'cashier shift history uses historical Branch read access'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_cash_shift'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'cashier shift detail uses historical Branch read access'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_branch_stock'
      and lower(pg_get_functiondef(p.oid)) like '%is_active = true%'
  )
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_branch_stock'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'current stock remains restricted to an active Branch'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_active_stock_count'
  )
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_active_stock_count'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'active stock-count lookup does not use historical Branch authority'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_active_cash_shift'
  )
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_active_cash_shift'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'active cashier-shift lookup does not use historical Branch authority'
);

select extensions.ok(
  (
    select count(distinct p.proname)=5
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'start_sellertray_stock_count',
        'capture_sellertray_stock_count_item',
        'submit_sellertray_stock_count',
        'apply_sellertray_stock_count',
        'cancel_sellertray_stock_count'
      )
  )
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'start_sellertray_stock_count',
        'capture_sellertray_stock_count_item',
        'submit_sellertray_stock_count',
        'apply_sellertray_stock_count',
        'cancel_sellertray_stock_count'
      )
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'all stock-count mutations exist and reject historical Branch authority'
);

select extensions.ok(
  (
    select count(distinct p.proname)=4
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'create_sellertray_stock_transfer',
        'dispatch_sellertray_stock_transfer',
        'receive_sellertray_stock_transfer',
        'cancel_sellertray_stock_transfer'
      )
  )
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'create_sellertray_stock_transfer',
        'dispatch_sellertray_stock_transfer',
        'receive_sellertray_stock_transfer',
        'cancel_sellertray_stock_transfer'
      )
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'all stock-transfer mutations exist and reject historical Branch authority'
);

select extensions.ok(
  (
    select count(distinct p.proname)=4
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'open_sellertray_cash_shift',
        'record_sellertray_shift_cash_movement',
        'close_sellertray_cash_shift',
        'review_sellertray_cash_shift'
      )
  )
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'open_sellertray_cash_shift',
        'record_sellertray_shift_cash_movement',
        'close_sellertray_cash_shift',
        'review_sellertray_cash_shift'
      )
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
  ),
  'all cashier-shift mutations exist and reject historical Branch authority'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_stock_movements(uuid,uuid,uuid,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_stock_count(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_stock_transfer(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_stock_transfers(uuid,uuid,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_cash_shift_history(uuid,uuid,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_cash_shift(uuid,uuid)','EXECUTE'),
  'authenticated users retain explicit execute access to operational history RPCs'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.dispatch_sellertray_stock_transfer(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.receive_sellertray_stock_transfer(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.apply_sellertray_stock_count(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.open_sellertray_cash_shift(uuid,uuid,uuid,numeric,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.close_sellertray_cash_shift(uuid,uuid,numeric,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.review_sellertray_cash_shift(uuid,uuid,text,text,uuid)','EXECUTE'),
  'privileged stock and cashier mutations remain server-only despite historical read access'
);

select * from extensions.finish();
rollback;
