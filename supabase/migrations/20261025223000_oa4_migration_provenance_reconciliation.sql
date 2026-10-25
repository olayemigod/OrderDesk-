begin;

-- OA4 production history contains a historical migration-ledger version
-- 20261024190904_oa4_onboarding_activation_live_convergence while repository
-- authority carries the corresponding OA4 convergence work under the earlier
-- 20261024185939 filename. Do not rewrite or delete historical production
-- migration records. This forward-only checkpoint establishes a new shared
-- repository/live boundary and fails closed unless the required OA4 authority
-- is already present with the approved execution boundary.

do $$
begin
  if to_regprocedure('public.assert_sellertray_setup_completion_evidence(jsonb)') is null then
    raise exception 'OA4 provenance reconciliation: structured setup evidence authority is missing';
  end if;

  if to_regprocedure('public.platform_admin_transition_branch_setup(uuid,uuid,uuid,text,uuid,text,jsonb)') is null then
    raise exception 'OA4 provenance reconciliation: governed setup transition authority is missing';
  end if;

  if to_regprocedure('public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamp with time zone,uuid)') is null then
    raise exception 'OA4 provenance reconciliation: Branch readiness authority is missing';
  end if;

  if to_regprocedure('public.get_sellertray_onboarding_state_core(uuid)') is null
     or to_regprocedure('public.get_sellertray_onboarding_state(uuid)') is null then
    raise exception 'OA4 provenance reconciliation: shared onboarding read authority is missing';
  end if;

  if to_regprocedure('public.reconcile_sellertray_installment_entitlement(uuid,uuid)') is null
     or to_regprocedure('public.platform_admin_retry_setup_activation(uuid,uuid,uuid,text)') is null then
    raise exception 'OA4 provenance reconciliation: entitlement reconciliation authority is missing';
  end if;

  if to_regclass('public.sellertray_commercial_branch_setup_readiness') is null then
    raise exception 'OA4 provenance reconciliation: Branch readiness evidence table is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema='public'
      and c.table_name='sellertray_commercial_branch_setup_readiness'
      and c.column_name in ('tenant_id','commercial_order_id','branch_id','command_id','evidence','actor_user_id','reason','ready_at','recorded_at')
    group by c.table_schema,c.table_name
    having count(*)=9
  ) then
    raise exception 'OA4 provenance reconciliation: Branch readiness audit columns are incomplete';
  end if;

  if has_function_privilege('authenticated','public.platform_admin_transition_branch_setup(uuid,uuid,uuid,text,uuid,text,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamp with time zone,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.reconcile_sellertray_installment_entitlement(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.platform_admin_retry_setup_activation(uuid,uuid,uuid,text)','EXECUTE') then
    raise exception 'OA4 provenance reconciliation: merchant role has a privileged activation/setup shortcut';
  end if;

  if not has_function_privilege('authenticated','public.get_sellertray_onboarding_state(uuid)','EXECUTE') then
    raise exception 'OA4 provenance reconciliation: authenticated shared onboarding reader is unavailable';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class r on r.oid=c.conrelid
    join pg_namespace n on n.oid=r.relnamespace
    where n.nspname='public'
      and r.relname='platform_admin_capability_grant_versions'
      and c.conname='platform_admin_capability_code_check'
      and pg_get_constraintdef(c.oid) like '%admin.branch_setup.manage%'
  ) then
    raise exception 'OA4 provenance reconciliation: Branch setup Admin capability is not governed';
  end if;
end;
$$;

commit;
