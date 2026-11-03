-- OA5: P0 setup readiness must prove system-native Branch hardware, not
-- merely a claimed checklist. Historical readiness, agreements, payments,
-- entitlements and print history remain immutable. No C2 runtime cutover.
begin;
-- Immutable operational evidence, separate from merchant checklist assertions.
-- All new readiness facts require an active, registered, same-Branch device
-- with a native test print completed no later than the server readiness time.
create or replace function public.assert_sellertray_setup_printer_proof(
  p_tenant_id uuid, p_branch_id uuid, p_evidence jsonb, p_ready_at timestamptz
) returns void language plpgsql stable security invoker set search_path='' as $proof$
declare
  v_item jsonb;
  v_printer_id uuid;
  v_register_id uuid;
begin
  if p_tenant_id is null or p_branch_id is null or p_ready_at is null
     or jsonb_typeof(p_evidence->'equipment') is distinct from 'array' then
    raise exception 'Branch and structured equipment evidence are required' using errcode='22023';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_evidence->'equipment') e
    where e.value->>'kind'='bluetooth_printer' loop
    v_printer_id:=null;
    v_register_id:=null;
    select p.id,r.id into v_printer_id,v_register_id
    from public.sellertray_printers p
    join public.sellertray_registers r
      on r.id=p.register_id and r.tenant_id=p.tenant_id and r.branch_id=p.branch_id
    where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id
      and p.is_active and r.is_active and p.transport='bluetooth'
      and lower(btrim(p.hardware_identifier))=lower(btrim(v_item->>'identifier'))
      and p.created_at<=p_ready_at and r.created_at<=p_ready_at
    order by p.created_at desc,p.id desc limit 1;

    if v_printer_id is null then
      raise exception 'Register and activate the matching Branch receipt printer before completing setup' using errcode='23514';
    end if;
    if not exists (
      select 1 from public.sellertray_print_jobs j
      where j.tenant_id=p_tenant_id and j.branch_id=p_branch_id
        and j.register_id=v_register_id and j.printer_id=v_printer_id
        and j.job_type='test' and j.status='printed'
        and j.content_snapshot->>'documentType'='test'
        and j.order_id is null and j.financial_document_id is null
        and j.started_at is not null and j.completed_at is not null
        and j.started_at<=j.completed_at
        and j.requested_at<=j.started_at
        and j.completed_at<=p_ready_at
        and lower(btrim(j.hardware_identifier))=lower(btrim(v_item->>'identifier'))
    ) then
      raise exception 'A successful SellerTray test print for this Branch printer must precede setup completion' using errcode='23514';
    end if;
  end loop;
end;
$proof$;
revoke all on function public.assert_sellertray_setup_printer_proof(uuid,uuid,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.assert_sellertray_setup_printer_proof(uuid,uuid,jsonb,timestamptz)
  to service_role;


-- Retain original signature, authorization, command replay and audit.
CREATE OR REPLACE FUNCTION public.mark_sellertray_commercial_branch_setup_ready(p_tenant_id uuid, p_commercial_order_id uuid, p_branch_id uuid, p_command_id uuid, p_evidence jsonb, p_reason text, p_ready_at timestamp with time zone, p_actor_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.sellertray_commercial_branch_setup_readiness%rowtype;
  v_id uuid;
  v_database_owner_session boolean := session_user in ('postgres','supabase_admin');
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_branch_id is null
     or p_command_id is null or p_ready_at is null or p_actor_user_id is null then
    raise exception 'Business, commercial order, Branch, command, setup time and actor are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Setup readiness evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_reason) not between 1 and 1000 then
    raise exception 'Setup readiness reason is required' using errcode='22023';
  end if;
  if p_ready_at>now()+interval '5 minutes' then
    raise exception 'Setup readiness time cannot be in the future' using errcode='22023';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  perform public.assert_sellertray_setup_subject(p_tenant_id,p_commercial_order_id,p_branch_id);

  -- Preserve idempotent replay of readiness facts that already existed before
  -- OA3. Only creation of a new readiness fact requires appointment completion.
  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id
      and r.commercial_order_id=p_commercial_order_id
      and r.branch_id=p_branch_id;
  end if;

  if found then
    if v_existing.commercial_order_id<>p_commercial_order_id
       or v_existing.branch_id<>p_branch_id
       or v_existing.evidence is distinct from v_evidence
       or v_existing.actor_user_id<>p_actor_user_id
       or v_existing.reason<>v_reason
       or v_existing.ready_at<>p_ready_at then
      raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  if not v_database_owner_session then
    perform public.assert_sellertray_setup_completion_evidence(v_evidence);
  end if;
  -- Apply the device proof to every NEW readiness fact, including database-
  -- owner migration/test sessions; historical idempotent replay returned above.
  perform public.assert_sellertray_setup_printer_proof(
    p_tenant_id,p_branch_id,v_evidence,p_ready_at
  );
  if not v_database_owner_session and not exists (
    select 1
    from public.sellertray_commercial_setup_appointment_events e
    join public.sellertray_commercial_setup_appointments a
      on a.id=e.appointment_id
     and a.tenant_id=e.tenant_id
     and a.commercial_order_id=e.commercial_order_id
     and a.branch_id=e.branch_id
    where e.tenant_id=p_tenant_id
      and e.commercial_order_id=p_commercial_order_id
      and e.branch_id=p_branch_id
      and e.command_id=p_command_id
      and e.event_type='completed'
      and e.actor_user_id=p_actor_user_id
      and a.status='completed'
      and v_evidence = (e.details->'evidence') || jsonb_build_object('source','oa3_setup_appointment','appointmentId',a.id)
      and p_ready_at=a.completed_at
  ) then
    raise exception 'Branch setup readiness must come from a completed governed setup appointment' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_branch_setup_readiness(
    tenant_id,commercial_order_id,branch_id,command_id,evidence,
    actor_user_id,reason,ready_at,recorded_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_branch_id,p_command_id,v_evidence,
    p_actor_user_id,v_reason,p_ready_at,now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into strict v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id and r.branch_id=p_branch_id;
  end if;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.branch_id<>p_branch_id
     or v_existing.evidence is distinct from v_evidence
     or v_existing.actor_user_id<>p_actor_user_id
     or v_existing.reason<>v_reason
     or v_existing.ready_at<>p_ready_at then
    raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
  end if;
  return v_existing.id;
end;
$function$;

-- Retain original signature, authorization, command replay and audit.
CREATE OR REPLACE FUNCTION public.platform_admin_transition_branch_setup(p_actor_user_id uuid, p_tenant_id uuid, p_appointment_id uuid, p_target_status text, p_command_id uuid, p_reason text, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_target text:=lower(btrim(coalesce(p_target_status,'')));
  v_expected_event_type text:=case when lower(btrim(coalesce(p_target_status,'')))='in_progress' then 'started' else lower(btrim(coalesce(p_target_status,''))) end;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_readiness_id uuid;
  v_obligation_id uuid;
  v_state jsonb;
  v_reconciliation jsonb := null;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then raise exception 'Branch setup management capability required' using errcode='42501'; end if;
  if p_command_id is null or char_length(v_reason)<6 or jsonb_typeof(coalesce(p_evidence,'{}'::jsonb))<>'object' then raise exception 'Transition command, reason and evidence are required' using errcode='22023'; end if;
  if v_target not in ('in_progress','completed','cancelled','no_show') then raise exception 'Unsupported setup appointment transition' using errcode='22023'; end if;

  -- Serialize command retries, including concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select e.* into v_existing_event from public.sellertray_commercial_setup_appointment_events e where e.command_id=p_command_id;
  if found then
    if v_existing_event.tenant_id<>p_tenant_id or v_existing_event.appointment_id<>p_appointment_id or v_existing_event.event_type<>v_expected_event_type
      or v_existing_event.actor_user_id<>p_actor_user_id or v_existing_event.reason<>v_reason
      or v_existing_event.details->'evidence' is distinct from coalesce(p_evidence,'{}'::jsonb) then raise exception 'Setup transition command is already used for different facts' using errcode='23505'; end if;
    select jsonb_build_object('appointmentId',a.id,'status',a.status,'readinessId',r.id)
      into v_state
    from public.sellertray_commercial_setup_appointments a
    left join public.sellertray_commercial_branch_setup_readiness r on r.tenant_id=a.tenant_id and r.commercial_order_id=a.commercial_order_id and r.branch_id=a.branch_id
    where a.id=p_appointment_id;
    return v_state;
  end if;

  -- Same order lock as settlement/reconciliation, before appointment row locks.
  perform public.lock_sellertray_commercial_order(a.tenant_id,a.commercial_order_id)
  from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id;
  select a.* into strict v_appointment from public.sellertray_commercial_setup_appointments a where a.id=p_appointment_id and a.tenant_id=p_tenant_id for update;
  if v_target='in_progress' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup can start' using errcode='23514'; end if;
  if v_target in ('completed','no_show') and v_appointment.status not in ('scheduled','in_progress') then raise exception 'Only an active setup appointment can finish' using errcode='23514'; end if;
  if v_target='cancelled' and v_appointment.status<>'scheduled' then raise exception 'Only a scheduled setup appointment can be cancelled' using errcode='23514'; end if;

  if v_target='completed' then
    perform public.assert_sellertray_setup_completion_evidence(p_evidence);
    perform public.assert_sellertray_setup_printer_proof(
      p_tenant_id,v_appointment.branch_id,p_evidence,now()
    );
    -- Scheduled installations may finish early only on explicit operator
    -- approval. The reason and original scheduled slot persist in immutable
    -- appointment events; silent early completion is prohibited.
    if now()<v_appointment.scheduled_start_at and (
      jsonb_typeof(p_evidence->'earlyCompletionApproval') is distinct from 'object'
      or char_length(btrim(coalesce(p_evidence#>>'{earlyCompletionApproval,reason}','')))<12
    ) then
      raise exception 'Setup is scheduled for a later date. Record an authorised early-completion reason or reschedule the appointment'
        using errcode='23514';
    end if;
  end if;

  update public.sellertray_commercial_setup_appointments
  set status=v_target,updated_at=now(),completed_at=case when v_target='completed' then now() else completed_at end,cancelled_at=case when v_target='cancelled' then now() else cancelled_at end
  where id=p_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,tenant_id,commercial_order_id,branch_id,command_id,event_type,actor_user_id,actor_kind,reason,details
  ) values (
    p_appointment_id,p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
    v_expected_event_type,p_actor_user_id,'platform',v_reason,
    jsonb_build_object('fromStatus',v_appointment.status,'toStatus',v_target,'evidence',coalesce(p_evidence,'{}'::jsonb),'workerId',v_appointment.worker_id,'completedAt',case when v_target='completed' then now() else null end,'actorUserId',p_actor_user_id)
  );

  if v_target='completed' then
    v_readiness_id:=public.mark_sellertray_commercial_branch_setup_ready(
      p_tenant_id,v_appointment.commercial_order_id,v_appointment.branch_id,p_command_id,
      coalesce(p_evidence,'{}'::jsonb)||jsonb_build_object('source','oa3_setup_appointment','appointmentId',p_appointment_id),
      v_reason,now(),p_actor_user_id
    );
    select io.id into v_obligation_id from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id and io.commercial_order_id=v_appointment.commercial_order_id order by io.created_at,io.id limit 1;
    if v_obligation_id is not null then
      -- A failed entitlement attempt must not erase valid completion/readiness.
      begin
        v_reconciliation:=public.reconcile_sellertray_installment_entitlement(p_tenant_id,v_obligation_id);
      exception when others then
        v_reconciliation:=jsonb_build_object('retryRequired',true);
        insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
        values(p_actor_user_id,p_tenant_id,'setup_activation_reconciliation_failed',jsonb_build_object('appointmentId',p_appointment_id,'obligationId',v_obligation_id,'sqlstate',sqlstate));
      end;
    end if;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,p_tenant_id,'branch_setup_'||v_target,jsonb_build_object('appointmentId',p_appointment_id,'commercialOrderId',v_appointment.commercial_order_id,'branchId',v_appointment.branch_id,'commandId',p_command_id));

  return jsonb_build_object('appointmentId',p_appointment_id,'status',v_target,'readinessId',v_readiness_id,'reconciliation',v_reconciliation);
end;
$function$;

commit;
