begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(22);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_user_can_read_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute arbitrary-user historical Branch authority directly'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_user_can_operate_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute operational Branch authority helper directly'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_user_has_capability(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated cannot execute capability authority helper directly'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute arbitrary-user notification authority directly'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sellertray_user_can_read_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute historical Branch authority helper'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sellertray_user_can_operate_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute operational Branch authority helper'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sellertray_user_has_capability(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anon cannot execute capability authority helper'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute notification authority helper'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sellertray_user_can_read_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role retains historical Branch helper execution'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sellertray_user_can_operate_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role retains operational Branch helper execution'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sellertray_user_has_capability(uuid,uuid,text)',
    'EXECUTE'
  ),
  'service_role retains capability helper execution'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role retains notification authority helper execution'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_current_user_can_read_branch(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated can evaluate current-user historical Branch authority'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_current_user_can_access_notification_scope(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated can evaluate current-user notification authority'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sellertray_current_user_can_read_branch(uuid,uuid)',
    'EXECUTE'
  ),
  'anon cannot evaluate current-user historical Branch authority'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sellertray_current_user_can_access_notification_scope(uuid,uuid)',
    'EXECUTE'
  ),
  'anon cannot evaluate current-user notification authority'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_policies
    where concat_ws(' ',qual,with_check) ilike '%sellertray_user_can_read_branch(%'
  ),
  0,
  'RLS policies do not invoke the arbitrary-user historical Branch helper'
);
select extensions.is(
  (
    select count(*)::integer
    from pg_policies
    where concat_ws(' ',qual,with_check) ilike '%sellertray_user_can_access_notification_scope(%'
  ),
  0,
  'RLS policies do not invoke the arbitrary-user notification helper'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and not p.prosecdef
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and p.prosrc ilike '%sellertray_user_can_read_branch(%'
  ),
  0,
  'authenticated SECURITY INVOKER functions do not depend on the arbitrary-user historical helper'
);
select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and not p.prosecdef
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and p.prosrc ilike '%sellertray_user_can_access_notification_scope(%'
  ),
  0,
  'authenticated SECURITY INVOKER functions do not depend on the arbitrary-user notification helper'
);

select extensions.ok(
  (
    select p.prosrc ilike '%auth.uid%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sellertray_current_user_can_read_branch'
      and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_branch_id uuid'
  ),
  'historical Branch wrapper binds authority to auth.uid()'
);
select extensions.ok(
  (
    select p.prosrc ilike '%auth.uid%'
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='sellertray_current_user_can_access_notification_scope'
      and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_branch_id uuid'
  ),
  'notification wrapper binds authority to auth.uid()'
);

select * from extensions.finish();
rollback;
