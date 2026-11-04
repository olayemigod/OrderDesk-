-- OA5: appointment-scoped setup device operations for authenticated ProcessEdge
-- installers. Shared SellerTray register, printer and native print-job records
-- remain the only device/readiness authority; live POS is not enabled.
begin;

create table public.sellertray_installer_device_commands (
  command_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  action text not null check (action in ('create_register','register_printer','request_test','transition_test')),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot)='object'),
  result_snapshot jsonb not null check (jsonb_typeof(result_snapshot)='object'),
  created_at timestamptz not null default now()
);
create index sellertray_installer_device_command_scope
  on public.sellertray_installer_device_commands(actor_user_id,appointment_id,created_at desc);
alter table public.sellertray_installer_device_commands enable row level security;
revoke all on public.sellertray_installer_device_commands from public,anon,authenticated;
grant select,insert on public.sellertray_installer_device_commands to service_role;
create trigger prevent_sellertray_installer_device_command_mutation
  before update or delete on public.sellertray_installer_device_commands
  for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.sellertray_installer_setup_device(
  p_actor_user_id uuid,
  p_appointment_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_command_id uuid default null
) returns jsonb
language plpgsql security definer set search_path='' as $install$
declare
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
  v_old public.sellertray_installer_device_commands%rowtype;
  v_result jsonb;
  v_register public.sellertray_registers%rowtype;
  v_printer public.sellertray_printers%rowtype;
  v_job public.sellertray_print_jobs%rowtype;
  v_registers jsonb;
  v_printers jsonb;
  v_code text;
  v_name text;
  v_identifier text;
  v_status text;
  v_failure text;
  v_width integer;
  v_register_id uuid;
  v_printer_id uuid;
  v_job_id uuid;
  v_is_default boolean;
begin
  if p_actor_user_id is null or p_appointment_id is null
     or v_action not in ('list_devices','create_register','register_printer','request_test','transition_test','get_job')
     or jsonb_typeof(v_payload)<>'object' then
    raise exception 'Installation appointment, action and details are required' using errcode='22023';
  end if;

  select * into v_appointment from public.sellertray_commercial_setup_appointments ap
  where ap.id=p_appointment_id for share;
  if not found or not public.sellertray_setup_installer_has_assignment(
    p_actor_user_id,v_appointment.tenant_id,v_appointment.branch_id,
    p_appointment_id,now()
  ) then
    raise exception 'No active ProcessEdge installation assignment for this appointment'
      using errcode='42501';
  end if;

  if v_action='list_devices' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'name',r.name,'code',r.code,
      'isDefault',r.is_default,'isActive',r.is_active
    ) order by r.is_default desc,r.name,r.id),'[]'::jsonb)
    into v_registers
    from public.sellertray_registers r
    where r.tenant_id=v_appointment.tenant_id and r.branch_id=v_appointment.branch_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'registerId',p.register_id,'displayName',p.display_name,
      'hardwareIdentifier',p.hardware_identifier,'transport',p.transport,
      'paperWidthMm',p.paper_width_mm,'isDefault',p.is_default,'isActive',p.is_active
    ) order by p.is_default desc,p.display_name,p.id),'[]'::jsonb)
    into v_printers
    from public.sellertray_printers p
    where p.tenant_id=v_appointment.tenant_id and p.branch_id=v_appointment.branch_id;
    return jsonb_build_object(
      'appointmentId',p_appointment_id,'tenantId',v_appointment.tenant_id,
      'branchId',v_appointment.branch_id,'registers',v_registers,'printers',v_printers
    );
  end if;

  if v_action='get_job' then
    begin
      v_job_id:=(v_payload->>'jobId')::uuid;
    exception when invalid_text_representation then
      raise exception 'A valid print job ID is required' using errcode='22023';
    end;
    select * into v_job from public.sellertray_print_jobs j
    where j.tenant_id=v_appointment.tenant_id
      and j.branch_id=v_appointment.branch_id
      and j.id=v_job_id and j.job_type='test'
      and j.requested_by_user_id=p_actor_user_id;
    if not found then raise exception 'Test print job is unavailable' using errcode='23514'; end if;
    return jsonb_build_object(
      'jobId',v_job.id,'status',v_job.status,'jobType','test',
      'printerId',v_job.printer_id,'printerName',v_job.printer_name,
      'transport',v_job.transport,'hardwareIdentifier',v_job.hardware_identifier,
      'paperWidthMm',v_job.paper_width_mm,'contentSnapshot',v_job.content_snapshot,
      'requestedAt',v_job.requested_at,'startedAt',v_job.started_at,
      'completedAt',v_job.completed_at,'failedAt',v_job.failed_at
    );
  end if;

  if p_command_id is null then
    raise exception 'An idempotent installation command ID is required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select * into v_old from public.sellertray_installer_device_commands c
  where c.command_id=p_command_id;
  if found then
    if v_old.actor_user_id<>p_actor_user_id or v_old.appointment_id<>p_appointment_id
       or v_old.action<>v_action or v_old.input_snapshot<>v_payload then
      raise exception 'Installation command ID reused for different facts' using errcode='23505';
    end if;
    return v_old.result_snapshot||jsonb_build_object('idempotentReplay',true);
  end if;

  if v_action='create_register' then
    v_code:=upper(btrim(coalesce(v_payload->>'code','')));
    v_name:=btrim(coalesce(v_payload->>'name',''));
    if char_length(v_code) not between 2 and 40 or char_length(v_name) not between 2 and 120 then
      raise exception 'Register code and name are required within allowed lengths' using errcode='22023';
    end if;
    if exists(select 1 from public.sellertray_registers r
      where r.tenant_id=v_appointment.tenant_id and r.branch_id=v_appointment.branch_id
        and upper(r.code)=v_code) then
      raise exception 'This Branch already has a register with this code' using errcode='23505';
    end if;
    -- Installation never modifies an existing register, shift or sales state.
    v_is_default:=not exists(select 1 from public.sellertray_registers r
      where r.tenant_id=v_appointment.tenant_id and r.branch_id=v_appointment.branch_id
        and r.is_default);
    insert into public.sellertray_registers(
      tenant_id,branch_id,code,name,is_default,is_active
    ) values(
      v_appointment.tenant_id,v_appointment.branch_id,v_code,v_name,v_is_default,true
    ) returning * into v_register;
    v_result:=jsonb_build_object(
      'registerId',v_register.id,'code',v_register.code,'name',v_register.name,
      'isDefault',v_register.is_default,'isActive',v_register.is_active
    );
  elsif v_action='register_printer' then
    begin v_register_id:=(v_payload->>'registerId')::uuid;
    exception when invalid_text_representation then
      raise exception 'A valid Branch register ID is required' using errcode='22023';
    end;
    v_name:=btrim(coalesce(v_payload->>'displayName',''));
    v_identifier:=upper(btrim(coalesce(v_payload->>'hardwareIdentifier','')));
    begin v_width:=(v_payload->>'paperWidthMm')::integer;
    exception when invalid_text_representation then v_width:=null;
    end;
    if v_register_id is null or char_length(v_name) not between 1 and 120
       or char_length(v_identifier) not between 1 and 160 or v_width not in (58,80) then
      raise exception 'Register, printer identity, name and supported paper width are required' using errcode='22023';
    end if;
    if not exists(select 1 from public.sellertray_registers r
       where r.tenant_id=v_appointment.tenant_id and r.branch_id=v_appointment.branch_id
         and r.id=v_register_id and r.is_active=true) then
      raise exception 'Selected register is not an active register in this Branch' using errcode='23514';
    end if;
    if exists(select 1 from public.sellertray_printers p
      where p.tenant_id=v_appointment.tenant_id and p.hardware_identifier=v_identifier
        and p.is_active) then
      raise exception 'This physical printer is already registered for the Business' using errcode='23505';
    end if;
    v_is_default:=not exists(select 1 from public.sellertray_printers p
      where p.tenant_id=v_appointment.tenant_id and p.register_id=v_register_id
        and p.is_default and p.is_active);
    insert into public.sellertray_printers(
      tenant_id,branch_id,register_id,display_name,transport,hardware_identifier,
      paper_width_mm,is_default,is_active,created_by_user_id
    ) values(
      v_appointment.tenant_id,v_appointment.branch_id,v_register_id,
      v_name,'bluetooth',v_identifier,v_width,v_is_default,true,p_actor_user_id
    ) returning * into v_printer;
    insert into public.sellertray_printer_events(
      tenant_id,printer_id,event_type,actor_user_id,before_state,after_state
    ) values(
      v_appointment.tenant_id,v_printer.id,'registered',p_actor_user_id,
      null,public.sellertray_printer_state(v_printer)
    );
    v_result:=jsonb_build_object(
      'printerId',v_printer.id,'registerId',v_register_id,
      'displayName',v_printer.display_name,
      'hardwareIdentifier',v_printer.hardware_identifier,
      'paperWidthMm',v_printer.paper_width_mm,
      'isDefault',v_printer.is_default,'isActive',v_printer.is_active
    );
  elsif v_action='request_test' then
    begin v_printer_id:=(v_payload->>'printerId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Valid registered Bluetooth printer required' using errcode='22023';
    end;
    select * into v_printer from public.sellertray_printers p
    where p.tenant_id=v_appointment.tenant_id
      and p.branch_id=v_appointment.branch_id
      and p.id=v_printer_id and p.transport='bluetooth' and p.is_active=true for share;
    if not found then raise exception 'Printer must be registered in the assigned Branch' using errcode='23514'; end if;
    select * into v_register from public.sellertray_registers r
    where r.tenant_id=v_appointment.tenant_id and r.branch_id=v_appointment.branch_id
      and r.id=v_printer.register_id and r.is_active=true;
    if not found then raise exception 'Printer register is unavailable' using errcode='23514'; end if;
    insert into public.sellertray_print_jobs(
      tenant_id,branch_id,register_id,printer_id,job_type,request_key,
      status,transport,printer_name,hardware_identifier,paper_width_mm,
      content_snapshot,requested_by_user_id
    ) values(
      v_appointment.tenant_id,v_appointment.branch_id,v_register.id,v_printer.id,
      'test','installer-test-'||p_command_id::text,'requested','bluetooth',
      v_printer.display_name,v_printer.hardware_identifier,v_printer.paper_width_mm,
      jsonb_build_object(
        'formatVersion',1,'documentType','test','title','SellerTray printer test',
        'businessName',(select t.name from public.tenants t where t.id=v_appointment.tenant_id),
        'branchName',(select b.name from public.branches b
          where b.id=v_appointment.branch_id and b.tenant_id=v_appointment.tenant_id),
        'registerName',v_register.name,'printerName',v_printer.display_name,
        'paperWidthMm',v_printer.paper_width_mm,'requestedAt',now(),
        'footer','SellerTray · ProcessEdge Solutions Limited'
      ),p_actor_user_id
    ) returning * into v_job;
    v_result:=jsonb_build_object(
      'jobId',v_job.id,'status',v_job.status,'jobType','test',
      'printerId',v_job.printer_id,'printerName',v_job.printer_name,
      'transport',v_job.transport,'hardwareIdentifier',v_job.hardware_identifier,
      'paperWidthMm',v_job.paper_width_mm,'contentSnapshot',v_job.content_snapshot,
      'requestedAt',v_job.requested_at
    );
  elsif v_action='transition_test' then
    begin v_job_id:=(v_payload->>'jobId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Valid native test print job required' using errcode='22023';
    end;
    v_status:=lower(btrim(coalesce(v_payload->>'status','')));
    v_failure:=nullif(btrim(coalesce(v_payload->>'failureMessage','')),'');
    if v_status not in ('printing','printed','failed')
       or (v_status='failed' and (v_failure is null or char_length(v_failure)>500)) then
      raise exception 'Print status and bounded failure message are required' using errcode='22023';
    end if;
    select * into v_job from public.sellertray_print_jobs j
    where j.tenant_id=v_appointment.tenant_id and j.branch_id=v_appointment.branch_id
      and j.id=v_job_id and j.job_type='test'
      and j.requested_by_user_id=p_actor_user_id for update;
    if not found then raise exception 'Assigned installer test attempt is unavailable' using errcode='42501'; end if;
    if v_job.status=v_status then
      v_result:=jsonb_build_object('jobId',v_job.id,'status',v_status,'idempotentReplay',true);
    else
      if v_job.status in ('printed','failed')
         or (v_job.status='requested' and v_status not in ('printing','failed'))
         or (v_job.status='printing' and v_status not in ('printed','failed')) then
        raise exception 'Native printer test must follow the recorded print state machine'
          using errcode='23514';
      end if;
      update public.sellertray_print_jobs set status=v_status,
        started_at=case when v_status='printing' then coalesce(started_at,now()) else started_at end,
        completed_at=case when v_status='printed' then now() else null end,
        failed_at=case when v_status='failed' then now() else null end,
        failure_code=case when v_status='failed' then 'PRINT_FAILED' else null end,
        failure_message=case when v_status='failed' then v_failure else null end,
        updated_at=now()
      where id=v_job.id and tenant_id=v_appointment.tenant_id
      returning * into v_job;
      v_result:=jsonb_build_object('jobId',v_job.id,'status',v_job.status);
    end if;
  end if;

  insert into public.sellertray_installer_device_commands(
    command_id,actor_user_id,appointment_id,tenant_id,branch_id,
    action,input_snapshot,result_snapshot
  ) values (
    p_command_id,p_actor_user_id,p_appointment_id,v_appointment.tenant_id,
    v_appointment.branch_id,v_action,v_payload,v_result
  );
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,v_appointment.tenant_id,'setup_installer_device_'||v_action,
    jsonb_build_object('appointmentId',p_appointment_id,
      'branchId',v_appointment.branch_id,'commandId',p_command_id,
      'result',v_result)
  );
  return v_result||jsonb_build_object('idempotentReplay',false);
end;
$install$;
revoke all on function public.sellertray_installer_setup_device(uuid,uuid,text,jsonb,uuid)
from public,anon,authenticated;
grant execute on function public.sellertray_installer_setup_device(uuid,uuid,text,jsonb,uuid)
to service_role;

commit;
