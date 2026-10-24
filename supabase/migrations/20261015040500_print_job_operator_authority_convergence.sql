begin;

create or replace function public.transition_sellertray_print_job(
  p_tenant_id uuid,
  p_job_id uuid,
  p_status text,
  p_failure_code text,
  p_failure_message text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.sellertray_print_jobs%rowtype;
  v_status text := lower(btrim(coalesce(p_status,'')));
  v_failure_code text := nullif(btrim(coalesce(p_failure_code,'')),'');
  v_failure_message text := nullif(btrim(coalesce(p_failure_message,'')),'');
begin
  if p_tenant_id is null or p_job_id is null or p_actor_user_id is null
     or v_status not in ('printing','printed','failed') then
    raise exception 'Print job, status and operator are required' using errcode='22023';
  end if;
  if v_failure_code is not null and char_length(v_failure_code)>80 then
    raise exception 'Printer failure code is too long' using errcode='22023';
  end if;
  if v_failure_message is not null and char_length(v_failure_message)>500 then
    raise exception 'Printer failure message is too long' using errcode='22023';
  end if;
  if v_status='failed' and v_failure_message is null then
    raise exception 'Failed print requires an error message' using errcode='22023';
  end if;

  select * into v_job
  from public.sellertray_print_jobs j
  where j.tenant_id=p_tenant_id and j.id=p_job_id
  for update;
  if not found then raise exception 'Print job not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_job.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to this print job' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_print_receipt') then
    raise exception 'You do not have permission to print receipts' using errcode='42501';
  end if;
  if v_job.requested_by_user_id<>p_actor_user_id then
    raise exception 'You do not have permission to update another user''s print attempt' using errcode='42501';
  end if;

  if v_job.status=v_status then
    return jsonb_build_object(
      'jobId',v_job.id,'status',v_job.status,'idempotentReplay',true
    );
  end if;
  if v_job.status in ('printed','failed') then
    raise exception 'Completed print attempt is immutable; request a reprint instead' using errcode='23514';
  end if;
  if v_job.status='requested' and v_status not in ('printing','failed') then
    raise exception 'Print job must start printing before it can complete' using errcode='23514';
  end if;
  if v_job.status='printing' and v_status not in ('printed','failed') then
    raise exception 'Printing job can only complete or fail' using errcode='23514';
  end if;

  update public.sellertray_print_jobs
  set status=v_status,
      started_at=case when v_status='printing' then coalesce(started_at,now()) else started_at end,
      completed_at=case when v_status='printed' then now() else null end,
      failed_at=case when v_status='failed' then now() else null end,
      failure_code=case when v_status='failed' then v_failure_code else null end,
      failure_message=case when v_status='failed' then v_failure_message else null end,
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_job_id
  returning * into v_job;

  return jsonb_build_object(
    'jobId',v_job.id,'status',v_job.status,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.transition_sellertray_print_job(uuid,uuid,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.transition_sellertray_print_job(uuid,uuid,text,text,text,uuid)
  to service_role;

commit;
