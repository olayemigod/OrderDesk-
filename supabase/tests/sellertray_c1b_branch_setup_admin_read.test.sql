begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

select extensions.ok(
  to_regprocedure('public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)') is not null,
  'C1B exact Branch setup Admin projection exists'
);

select extensions.ok(
  has_function_privilege(
    'service_role','public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'anon','public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)','EXECUTE'
  ),
  'C1B Branch setup projection remains service-authority only'
);

select extensions.ok(
  position('platform_admins' in pg_get_functiondef(
    'public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)'::regprocedure
  ))>0
  and position('line_type=''branch_setup''' in pg_get_functiondef(
    'public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)'::regprocedure
  ))>0,
  'C1B Branch setup projection checks platform role and reads governed setup purchase lines'
);

select extensions.ok(
  position('sellertray_commercial_branch_setup_readiness' in pg_get_functiondef(
    'public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)'::regprocedure
  ))>0
  and position('branchName' in pg_get_functiondef(
    'public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)'::regprocedure
  ))>0,
  'C1B Branch setup projection binds readiness evidence to merchant-facing Branch identity'
);

select * from extensions.finish();
rollback;
