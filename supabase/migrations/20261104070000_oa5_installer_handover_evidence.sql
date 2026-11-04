-- OA5: ProcessEdge field handover is immutable installation evidence,
-- not a second setup readiness or activation state. Admin must approve and
-- complete the existing canonical setup appointment independently.
begin;

create table public.sellertray_installer_handover_submissions (
  id uuid primary key default gen_random_uuid(),
  command_key text not null unique check (char_length(command_key) between 12 and 128),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id) on delete restrict,
  printer_id uuid not null references public.sellertray_printers(id) on delete restrict,
  test_job_id uuid not null references public.sellertray_print_jobs(id) on delete restrict,
  request_facts jsonb not null check (jsonb_typeof(request_facts)='object'),
  evidence jsonb not null check (jsonb_typeof(evidence)='object'),
  reason text not null,
  submitted_at timestamptz not null default now()
);
create index sellertray_installer_handover_scope
  on public.sellertray_installer_handover_submissions(tenant_id,branch_id,appointment_id,submitted_at desc);
alter table public.sellertray_installer_handover_submissions enable row level security;
revoke all on public.sellertray_installer_handover_submissions from public,anon,authenticated;
grant select,insert on public.sellertray_installer_handover_submissions to service_role;
create trigger prevent_sellertray_installer_handover_mutation
  before update or delete on public.sellertray_installer_handover_submissions
  for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.platform_installer_submit_handover(
  p_actor_user_id uuid,p_tenant_id uuid,p_branch_id uuid,p_appointment_id uuid,
  p_printer_id uuid,p_test_job_id uuid,p_handover_condition text,
  p_received_by text,p_acknowledgement text,p_reason text,p_command_key text
) returns jsonb language plpgsql security definer set search_path='' as $handover$
declare
  v_condition text := btrim(coalesce(p_handover_condition,''));
  v_received_by text := btrim(coalesce(p_received_by,''));
  v_acknowledgement text := btrim(coalesce(p_acknowledgement,''));
  v_reason text := btrim(coalesce(p_reason,''));
  v_key text := btrim(coalesce(p_command_key,''));
  v_printer public.sellertray_printers%rowtype;
  v_test public.sellertray_print_jobs%rowtype;
  v_evidence jsonb;
  v_facts jsonb;
  v_previous public.sellertray_installer_handover_submissions%rowtype;
  v_id uuid;
begin
  if p_actor_user_id is null or p_tenant_id is null or p_branch_id is null
    or p_appointment_id is null or p_printer_id is null or p_test_job_id is null
    or char_length(v_condition) not between 2 and 500
    or char_length(v_received_by) not between 2 and 200
    or char_length(v_acknowledgement) not between 2 and 1000
    or char_length(v_reason) not between 6 and 1000
    or char_length(v_key) not between 12 and 128 then
    raise exception 'Installation, real printer test and merchant handover details are required'
      using errcode='22023';
  end if;
  -- Never accept a self-claimed installer or another Branch's appointment.
  if not public.sellertray_setup_installer_has_assignment(
      p_actor_user_id,p_tenant_id,p_branch_id,p_appointment_id,now()
    ) then
    raise exception 'Current assigned ProcessEdge installation required'
      using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('installer-handover:'||v_key,0));
  v_facts:=jsonb_build_object(
    'actorUserId',p_actor_user_id,'tenantId',p_tenant_id,'branchId',p_branch_id,
    'appointmentId',p_appointment_id,'printerId',p_printer_id,
    'testJobId',p_test_job_id,'condition',v_condition,
    'receivedBy',v_received_by,'acknowledgement',v_acknowledgement,
    'reason',v_reason
  );
  select * into v_previous from public.sellertray_installer_handover_submissions h
  where h.command_key=v_key;
  if found then
    if v_previous.request_facts is distinct from v_facts then
      raise exception 'Handover command has different facts' using errcode='23505';
    end if;
    return jsonb_build_object(
      'submissionId',v_previous.id,'appointmentId',v_previous.appointment_id,
      'submittedAt',v_previous.submitted_at,'idempotentReplay',true,
      'requiresAdminCompletion',true
    );
  end if;

  select p.* into v_printer from public.sellertray_printers p
  join public.sellertray_registers r on r.tenant_id=p.tenant_id
    and r.id=p.register_id and r.branch_id=p.branch_id and r.is_active
  where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id
    and p.id=p_printer_id and p.is_active and p.transport='bluetooth'
  for share of p;
  if not found then
    raise exception 'A configured active same-Branch printer and register are required'
      using errcode='23514';
  end if;
  select j.* into v_test from public.sellertray_print_jobs j
  join public.sellertray_internal_setup_staff_assignments a
    on a.staff_user_id=p_actor_user_id and a.tenant_id=j.tenant_id
      and a.branch_id=j.branch_id and a.appointment_id=p_appointment_id
      and a.revoked_at is null and a.valid_from<=j.requested_at
  where j.id=p_test_job_id and j.tenant_id=p_tenant_id
    and j.branch_id=p_branch_id and j.register_id=v_printer.register_id
    and j.printer_id=v_printer.id and j.job_type='test'
    and j.status='printed' and j.requested_by_user_id=p_actor_user_id
    and j.content_snapshot->>'documentType'='test'
    and j.order_id is null and j.financial_document_id is null
    and j.requested_at is not null and j.started_at is not null
    and j.completed_at is not null
    and j.requested_at<=j.started_at and j.started_at<=j.completed_at
    and j.completed_at<=now()
    and lower(btrim(j.hardware_identifier))=lower(btrim(v_printer.hardware_identifier))
  for share of j;
  if not found then
    raise exception 'A completed native test print by the assigned installer is required'
      using errcode='23514';
  end if;

  -- Reported walkthrough/recipient details remain operator testimony until
  -- Admin verifies them; actual printer/test authority is system-derived.
  v_evidence:=jsonb_build_object(
    'schemaVersion',1,
    'checklist',jsonb_build_object('branchConfigured',true,'merchantWalkthrough',true),
    'equipment',jsonb_build_array(jsonb_build_object(
      'kind','bluetooth_printer','provisioning','configured',
      'identifier',v_printer.hardware_identifier,'pairingTestResult','passed',
      'testReceiptPrinted',true,'handoverCondition',v_condition
    )),
    'receivedBy',v_received_by,'acknowledgement',v_acknowledgement
  );
  perform public.assert_sellertray_setup_printer_proof(
    p_tenant_id,p_branch_id,v_evidence,now()
  );
  insert into public.sellertray_installer_handover_submissions(
    command_key,actor_user_id,tenant_id,branch_id,appointment_id,
    printer_id,test_job_id,request_facts,evidence,reason
  ) values (
    v_key,p_actor_user_id,p_tenant_id,p_branch_id,p_appointment_id,
    p_printer_id,p_test_job_id,v_facts,v_evidence,v_reason
  ) returning id into v_id;
  return jsonb_build_object(
    'submissionId',v_id,'appointmentId',p_appointment_id,
    'idempotentReplay',false,'requiresAdminCompletion',true
  );
end;
$handover$;
revoke all on function public.platform_installer_submit_handover(
 uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.platform_installer_submit_handover(
 uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text) to service_role;

create or replace function public.platform_admin_list_installer_handovers(
  p_actor_user_id uuid,p_tenant_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $list$
begin
  if p_actor_user_id is null or p_tenant_id is null or not exists(
    select 1 from public.platform_admins a
      where a.user_id=p_actor_user_id and a.role='admin'
  ) or not public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()
  ) then
    raise exception 'ProcessEdge setup review authority required' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'submissionId',h.id,'appointmentId',h.appointment_id,
      'branchId',h.branch_id,'actorUserId',h.actor_user_id,
      'printerId',h.printer_id,'testJobId',h.test_job_id,
      'evidence',h.evidence,'reason',h.reason,'submittedAt',h.submitted_at
    ) order by h.submitted_at desc,h.id)
    from (select * from public.sellertray_installer_handover_submissions
      where tenant_id=p_tenant_id
      order by submitted_at desc,id desc limit 100) h
  ),'[]'::jsonb);
end;
$list$;
revoke all on function public.platform_admin_list_installer_handovers(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.platform_admin_list_installer_handovers(uuid,uuid)
 to service_role;

commit;