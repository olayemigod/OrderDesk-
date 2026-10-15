begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_user_can_read_branch(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute historical Branch authority helper directly'
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

select * from extensions.finish();
rollback;
