begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'get_sellertray_manageable_branches',
        'save_sellertray_branch',
        'set_sellertray_member_branch_access',
        'reset_sellertray_member_branch_access',
        'set_sellertray_member_capability_for_current_user',
        'get_sellertray_team_access_matrix'
      )
  ),
  6,
  'shared Team and Branch management commands exist'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'get_sellertray_manageable_branches',
        'save_sellertray_branch',
        'set_sellertray_member_branch_access',
        'reset_sellertray_member_branch_access',
        'set_sellertray_member_capability_for_current_user',
        'get_sellertray_team_access_matrix'
      )
      and p.prosecdef=true
  ),
  6,
  'Team and Branch management commands are security definer functions'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_manageable_branches(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.save_sellertray_branch(uuid,uuid,text,text,boolean,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.reset_sellertray_member_branch_access(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.set_sellertray_member_capability_for_current_user(uuid,uuid,text,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_team_access_matrix(uuid)','EXECUTE'),
  'authenticated management sessions can call governed Team and Branch commands'
);

select extensions.ok(
  has_table_privilege('authenticated','public.branches','SELECT')
  and not has_table_privilege('authenticated','public.branches','INSERT')
  and not has_table_privilege('authenticated','public.branches','UPDATE')
  and not has_table_privilege('authenticated','public.branches','DELETE'),
  'Branch rows are readable but not directly mutable from authenticated clients'
);

select extensions.ok(
  has_table_privilege('authenticated','public.branch_user_access','SELECT')
  and not has_table_privilege('authenticated','public.branch_user_access','INSERT')
  and not has_table_privilege('authenticated','public.branch_user_access','UPDATE')
  and not has_table_privilege('authenticated','public.branch_user_access','DELETE'),
  'Staff Branch assignments are readable but not directly mutable from authenticated clients'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_branch_access_events','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_branch_access_events','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_branch_access_events','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_branch_access_events','DELETE'),
  'Branch access audit events are not directly exposed to browser sessions'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sellertray_branch_access_events'
      and t.tgname='prevent_sellertray_branch_access_event_mutation'
      and not t.tgisinternal
  ),
  'Branch access audit history has an immutability trigger'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_sellertray_branch'
      and lower(pg_get_functiondef(p.oid)) like '%owner%'
      and lower(pg_get_functiondef(p.oid)) like '%manager%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
      and lower(pg_get_functiondef(p.oid)) like '%default branch must remain active%'
      and lower(pg_get_functiondef(p.oid)) like '%choose another default branch%'
  ),
  'Branch save command enforces management, subscription and default-Branch invariants'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_sellertray_member_branch_access'
      and lower(pg_get_functiondef(p.oid)) like '%target_role%staff%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_branch_access_events%'
  ),
  'Staff Branch assignment command is Staff-only, subscription-aware and audited'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='reset_sellertray_member_branch_access'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_branch_access_events%'
      and lower(pg_get_functiondef(p.oid)) like '%delete from public.branch_user_access%'
  ),
  'Branch reset records history before restoring default-Branch fallback'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_sellertray_member_capability_for_current_user'
      and lower(pg_get_functiondef(p.oid)) like '%auth.uid%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
      and lower(pg_get_functiondef(p.oid)) like '%set_sellertray_member_capability%'
  ),
  'capability wrapper binds the current actor and reuses the audited shared capability command'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_team_access_matrix'
      and lower(pg_get_functiondef(p.oid)) like '%usesdefaultbranchfallback%'
      and lower(pg_get_functiondef(p.oid)) like '%branchaccess%'
      and lower(pg_get_functiondef(p.oid)) like '%capabilities%'
  ),
  'Team access matrix exposes effective Branch and capability governance state'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_team_access_matrix'
      and lower(pg_get_functiondef(p.oid)) like '%can_receive_stock%'
      and lower(pg_get_functiondef(p.oid)) like '%can_transfer_stock%'
      and lower(pg_get_functiondef(p.oid)) like '%can_open_shift%'
      and lower(pg_get_functiondef(p.oid)) like '%can_review_shift%'
      and lower(pg_get_functiondef(p.oid)) like '%can_print_receipt%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_devices%'
  ),
  'Team access matrix includes inventory, cashier and device capability families'
);

select extensions.ok(
  not has_function_privilege('anon','public.get_sellertray_manageable_branches(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.save_sellertray_branch(uuid,uuid,text,text,boolean,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.reset_sellertray_member_branch_access(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.set_sellertray_member_capability_for_current_user(uuid,uuid,text,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.get_sellertray_team_access_matrix(uuid)','EXECUTE'),
  'anonymous users cannot execute Team or Branch management commands'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_sellertray_manageable_branches'
      and lower(pg_get_functiondef(p.oid)) like '%owner%'
      and lower(pg_get_functiondef(p.oid)) like '%manager%'
  ),
  'inactive Branch management list remains restricted to management roles'
);

select extensions.ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_sellertray_member_branch_access'
      and lower(pg_get_functiondef(p.oid)) like '%is_active%'
      and lower(pg_get_functiondef(p.oid)) like '%p_can_operate=false%'
  ),
  'new operating access cannot be granted to an inactive Branch'
);

select * from extensions.finish();
rollback;
