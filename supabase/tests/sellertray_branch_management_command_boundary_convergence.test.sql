begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

select extensions.ok(
  to_regprocedure('public.get_sellertray_manageable_branches(uuid)') is not null,
  'manageable Branch reader exists'
);
select extensions.ok(
  to_regprocedure('public.save_sellertray_branch(uuid,uuid,text,text,boolean,boolean)') is not null,
  'Branch save command exists'
);
select extensions.ok(
  to_regprocedure('public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean)') is not null,
  'Staff Branch access command exists'
);
select extensions.ok(
  to_regprocedure('public.reset_sellertray_member_branch_access(uuid,uuid)') is not null,
  'Staff Branch reset command exists'
);
select extensions.ok(
  to_regprocedure('public.set_sellertray_member_capability_for_current_user(uuid,uuid,text,boolean)') is not null,
  'current-user capability command exists'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_manageable_branches(uuid)','EXECUTE'),
  'authenticated management UI can read manageable Branches'
);
select extensions.ok(
  has_function_privilege('authenticated','public.save_sellertray_branch(uuid,uuid,text,text,boolean,boolean)','EXECUTE'),
  'authenticated management UI can call Branch save command'
);
select extensions.ok(
  has_function_privilege('authenticated','public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean)','EXECUTE'),
  'authenticated management UI can call Staff Branch command'
);
select extensions.ok(
  has_function_privilege('authenticated','public.reset_sellertray_member_branch_access(uuid,uuid)','EXECUTE'),
  'authenticated management UI can call Staff Branch reset command'
);
select extensions.ok(
  has_function_privilege('authenticated','public.set_sellertray_member_capability_for_current_user(uuid,uuid,text,boolean)','EXECUTE'),
  'authenticated management UI can call capability command'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.branches','INSERT')
  and not has_table_privilege('authenticated','public.branches','UPDATE')
  and not has_table_privilege('authenticated','public.branches','DELETE'),
  'authenticated users cannot bypass Branch commands with direct table writes'
);
select extensions.ok(
  has_table_privilege('authenticated','public.branches','SELECT'),
  'authenticated Branch reads remain available through RLS'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.branch_user_access','INSERT')
  and not has_table_privilege('authenticated','public.branch_user_access','UPDATE')
  and not has_table_privilege('authenticated','public.branch_user_access','DELETE'),
  'authenticated users cannot bypass Staff Branch commands with direct access-table writes'
);
select extensions.ok(
  has_table_privilege('authenticated','public.branch_user_access','SELECT'),
  'authenticated Staff Branch reads remain available through RLS'
);

select extensions.ok(
  not exists(select 1 from pg_policies where schemaname='public' and tablename='branches' and policyname='branches_insert_management'),
  'legacy direct Branch insert policy is removed'
);
select extensions.ok(
  not exists(select 1 from pg_policies where schemaname='public' and tablename='branches' and policyname='branches_update_management'),
  'legacy direct Branch update policy is removed'
);
select extensions.ok(
  not exists(select 1 from pg_policies where schemaname='public' and tablename='branch_user_access' and policyname='branch_user_access_manage_management'),
  'legacy direct Staff Branch mutation policy is removed'
);

select extensions.ok(
  (select prosrc ilike '%orderdesk_subscription_can_write%'
      and prosrc ilike '%auth.uid()%'
   from pg_proc where oid='public.save_sellertray_branch(uuid,uuid,text,text,boolean,boolean)'::regprocedure),
  'Branch save command binds the current user and enforces subscription writability'
);
select extensions.ok(
  (select prosrc ilike '%Choose another default Branch%'
      and prosrc ilike '%default Branch must remain active%'
   from pg_proc where oid='public.save_sellertray_branch(uuid,uuid,text,text,boolean,boolean)'::regprocedure),
  'Branch save command protects the active default Branch invariant'
);
select extensions.ok(
  (select prosrc ilike '%sellertray_branch_access_events%'
      and prosrc ilike '%orderdesk_subscription_can_write%'
   from pg_proc where oid='public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean)'::regprocedure),
  'Staff Branch assignment enforces subscription state and writes immutable access history'
);
select extensions.ok(
  (select prosrc ilike '%v_had_any_assignment%'
      and prosrc ilike '%v_default_branch_id%'
   from pg_proc where oid='public.set_sellertray_member_branch_access(uuid,uuid,uuid,boolean)'::regprocedure),
  'first custom Staff assignment preserves the historical default-Branch fallback'
);
select extensions.ok(
  (select prosrc ilike '%sellertray_branch_access_events%'
      and prosrc ilike '%delete from public.branch_user_access%'
   from pg_proc where oid='public.reset_sellertray_member_branch_access(uuid,uuid)'::regprocedure),
  'Staff Branch reset audits prior explicit assignments before returning to fallback'
);
select extensions.ok(
  (select prosrc ilike '%auth.uid()%'
      and prosrc ilike '%orderdesk_subscription_can_write%'
      and prosrc ilike '%set_sellertray_member_capability%'
   from pg_proc where oid='public.set_sellertray_member_capability_for_current_user(uuid,uuid,text,boolean)'::regprocedure),
  'capability wrapper binds the actor, subscription state and shared permission command'
);

select * from extensions.finish();
rollback;
