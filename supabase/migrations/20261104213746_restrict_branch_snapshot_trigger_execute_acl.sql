begin;

-- SellerTray security hardening: two SECURITY DEFINER helpers are trigger-only.
-- Neither is a supported RPC; retaining their PUBLIC/anon/authenticated EXECUTE
-- grants makes them appear as exposed privileged functions in Supabase advisors.
-- Trigger attachments remain unchanged. Service-role execution is preserved.
-- Do NOT apply this pattern to merchant-facing governed RPCs.

do $guard$
begin
  if to_regprocedure('public.snapshot_sellertray_order_branch_name()') is null
     or to_regprocedure('public.snapshot_sellertray_receipt_branch_name()') is null then
    raise exception 'Expected SellerTray Branch snapshot trigger helpers are missing';
  end if;
end;
$guard$;

revoke execute on function public.snapshot_sellertray_order_branch_name()
  from public, anon, authenticated;
revoke execute on function public.snapshot_sellertray_receipt_branch_name()
  from public, anon, authenticated;

do $verify$
declare
  v_order_trigger_count integer;
  v_receipt_trigger_count integer;
begin
  if has_function_privilege('anon',
         'public.snapshot_sellertray_order_branch_name()', 'EXECUTE')
     or has_function_privilege('authenticated',
         'public.snapshot_sellertray_order_branch_name()', 'EXECUTE')
     or has_function_privilege('anon',
         'public.snapshot_sellertray_receipt_branch_name()', 'EXECUTE')
     or has_function_privilege('authenticated',
         'public.snapshot_sellertray_receipt_branch_name()', 'EXECUTE') then
    raise exception 'Branch snapshot trigger EXECUTE remains exposed to browser roles';
  end if;

  if not has_function_privilege('service_role',
         'public.snapshot_sellertray_order_branch_name()', 'EXECUTE')
     or not has_function_privilege('service_role',
         'public.snapshot_sellertray_receipt_branch_name()', 'EXECUTE') then
    raise exception 'Branch snapshot trigger service-role authority was lost';
  end if;

  select count(*) into v_order_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgfoid = 'public.snapshot_sellertray_order_branch_name()'::regprocedure
    and t.tgrelid = 'public.orders'::regclass
    and t.tgenabled <> 'D'
    and not t.tgisinternal;
  select count(*) into v_receipt_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgfoid = 'public.snapshot_sellertray_receipt_branch_name()'::regprocedure
    and t.tgrelid = 'public.sellertray_print_jobs'::regclass
    and t.tgenabled <> 'D'
    and not t.tgisinternal;

  if v_order_trigger_count <> 1 or v_receipt_trigger_count <> 1 then
    raise exception 'Branch/receipt snapshot trigger attachments changed unexpectedly';
  end if;
end;
$verify$;

commit;
