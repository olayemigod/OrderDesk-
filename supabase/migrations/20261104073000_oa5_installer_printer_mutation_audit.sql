-- OA5 forward-only: preserve the existing printer + receipt-copy business
-- authority, but require transaction-atomic, appointment-specific provenance
-- for EVERY field-installer printer event, including default-printer changes.
-- Merchant device history and the canonical printer events remain unchanged.
begin;

create table public.sellertray_installer_printer_commands (
  command_key text primary key check (char_length(command_key) between 12 and 128),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id) on delete restrict,
  assignment_id uuid not null references public.sellertray_internal_setup_staff_assignments(id) on delete restrict,
  command_type text not null check (command_type in ('printer_save','receipt_settings')),
  request_facts jsonb not null check (jsonb_typeof(request_facts)='object'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  recorded_at timestamptz not null default now()
);
create index sellertray_installer_printer_commands_scope on
  public.sellertray_installer_printer_commands(tenant_id,branch_id,appointment_id,recorded_at desc);
alter table public.sellertray_installer_printer_commands enable row level security;
revoke all on public.sellertray_installer_printer_commands from public,anon,authenticated;
grant select,insert on public.sellertray_installer_printer_commands to service_role;
create trigger prevent_sellertray_installer_printer_commands_mutation
  before update or delete on public.sellertray_installer_printer_commands
  for each row execute function public.prevent_sellertray_commercial_history_mutation();

create table public.sellertray_installer_printer_events (
  id uuid primary key default gen_random_uuid(),
  command_key text not null references public.sellertray_installer_printer_commands(command_key)
    on delete restrict deferrable initially deferred,
  canonical_event_id uuid not null unique references public.sellertray_printer_events(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id) on delete restrict,
  assignment_id uuid not null references public.sellertray_internal_setup_staff_assignments(id) on delete restrict,
  printer_id uuid not null references public.sellertray_printers(id) on delete restrict,
  event_type text not null,
  before_state jsonb,
  after_state jsonb not null,
  recorded_at timestamptz not null default now()
);
create index sellertray_installer_printer_events_scope
  on public.sellertray_installer_printer_events(tenant_id,branch_id,appointment_id,recorded_at desc);
alter table public.sellertray_installer_printer_events enable row level security;
revoke all on public.sellertray_installer_printer_events from public,anon,authenticated;
grant select,insert on public.sellertray_installer_printer_events to service_role;
create trigger prevent_sellertray_installer_printer_events_mutation
  before update or delete on public.sellertray_installer_printer_events
  for each row execute function public.prevent_sellertray_commercial_history_mutation();

-- This trigger is the mandatory guard for both service-role printer writes
-- and authenticated receipt-setting writes. An authenticated caller can
-- set custom GUCs, but cannot insert a command row; attempting to reuse any
-- committed command is explicitly rejected. The deferrable FK makes a new
-- fake command fail at commit without ever retaining the printer mutation.
create or replace function public.sellertray_capture_installer_printer_event()
returns trigger language plpgsql security definer set search_path='' as $capture$
declare
  v_key text := nullif(current_setting('sellertray.installer_printer_command_key',true),'');
  v_appointment_id uuid;
  v_actor uuid := new.actor_user_id;
  v_branch_id uuid;
  v_assignment_id uuid;
  v_setting_assignment text;
begin
  if not exists (select 1 from public.sellertray_internal_setup_staff s
    where s.user_id=v_actor and s.staff_role='setup_installer') then
    return new;
  end if;
  if v_key is null or char_length(v_key) not between 12 and 128 then
    raise exception 'Audited installation printer command required'
      using errcode='42501';
  end if;
  if exists (select 1 from public.sellertray_installer_printer_commands c
    where c.command_key=v_key) then
    raise exception 'Already recorded printer command cannot authorize further changes'
      using errcode='23505';
  end if;
  v_appointment_id:=nullif(
    current_setting('sellertray.installer_printer_appointment_id',true),''
  )::uuid;
  v_setting_assignment:=nullif(
    current_setting('sellertray.installer_printer_assignment_id',true),''
  );
  v_assignment_id:=v_setting_assignment::uuid;
  select p.branch_id into v_branch_id from public.sellertray_printers p
    where p.id=new.printer_id and p.tenant_id=new.tenant_id;
  if v_branch_id is null or v_appointment_id is null or v_assignment_id is null
    or not (
      (auth.jwt()->>'role'='service_role') or
      (auth.uid()=v_actor and auth.jwt()->>'aal'='aal2')
    )
    or not public.sellertray_setup_installer_has_assignment(
      v_actor,new.tenant_id,v_branch_id,v_appointment_id,now()
    )
    or not exists (
      select 1 from public.sellertray_internal_setup_staff_assignments a
      where a.id=v_assignment_id and a.staff_user_id=v_actor
        and a.tenant_id=new.tenant_id and a.branch_id=v_branch_id
        and a.appointment_id=v_appointment_id
        and a.revoked_at is null and a.valid_from<=now() and a.valid_until>now()
    ) then
    raise exception 'Printer mutation requires verified active exact appointment'
      using errcode='42501';
  end if;
  insert into public.sellertray_installer_printer_events(
    command_key,canonical_event_id,actor_user_id,tenant_id,branch_id,
    appointment_id,assignment_id,printer_id,event_type,before_state,after_state
  ) values (
    v_key,new.id,v_actor,new.tenant_id,v_branch_id,v_appointment_id,
    v_assignment_id,new.printer_id,new.event_type,new.before_state,new.after_state
  );
  return new;
end;
$capture$;
revoke all on function public.sellertray_capture_installer_printer_event()
  from public,anon,authenticated;
create trigger sellertray_installer_printer_event_audit
  after insert on public.sellertray_printer_events
  for each row execute function public.sellertray_capture_installer_printer_event();

-- A single SQL command selects a current exact assignment, enforces
-- immutable command facts and wraps the existing canonical printer service.
create or replace function public.save_sellertray_installer_printer(
  p_actor_user_id uuid,p_tenant_id uuid,p_branch_id uuid,
  p_appointment_id uuid,p_printer_id uuid,p_register_id uuid,
  p_display_name text,p_hardware_identifier text,p_paper_width_mm integer,
  p_is_default boolean,p_is_active boolean,p_command_key text
) returns jsonb language plpgsql security definer set search_path='' as $save$
declare
  v_key text:=btrim(coalesce(p_command_key,''));
  v_assignment uuid;
  v_facts jsonb;
  v_prior public.sellertray_installer_printer_commands%rowtype;
  v_result jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then
    raise exception 'Server-only ProcessEdge printer command required' using errcode='42501';
  end if;
  if p_actor_user_id is null or p_tenant_id is null or p_branch_id is null
    or p_appointment_id is null or p_register_id is null
    or char_length(v_key) not between 12 and 128 then
    raise exception 'Installer identity, appointment, register and command are required'
      using errcode='22023';
  end if;
  if not public.sellertray_setup_installer_has_assignment(
    p_actor_user_id,p_tenant_id,p_branch_id,p_appointment_id,now()
  ) then
    raise exception 'Installer appointment is not active' using errcode='42501';
  end if;
  select a.id into v_assignment from public.sellertray_internal_setup_staff_assignments a
  where a.staff_user_id=p_actor_user_id and a.tenant_id=p_tenant_id
    and a.branch_id=p_branch_id and a.appointment_id=p_appointment_id
    and a.revoked_at is null and a.valid_from<=now() and a.valid_until>now()
  order by a.valid_from desc,a.id desc limit 1 for share;
  if v_assignment is null then
    raise exception 'Exact installer assignment is required' using errcode='42501';
  end if;
  v_facts:=jsonb_build_object(
    'actor',p_actor_user_id,'tenant',p_tenant_id,'branch',p_branch_id,
    'appointment',p_appointment_id,'printerId',p_printer_id,'registerId',p_register_id,
    'displayName',btrim(coalesce(p_display_name,'')),
    'hardwareIdentifier',btrim(coalesce(p_hardware_identifier,'')),
    'paperWidthMm',p_paper_width_mm,'isDefault',p_is_default,'isActive',p_is_active
  );
  perform pg_advisory_xact_lock(hashtextextended('installer-printer:'||v_key,0));
  select * into v_prior from public.sellertray_installer_printer_commands c
    where c.command_key=v_key;
  if found then
    if v_prior.actor_user_id<>p_actor_user_id
      or v_prior.tenant_id<>p_tenant_id or v_prior.branch_id<>p_branch_id
      or v_prior.appointment_id<>p_appointment_id
      or v_prior.command_type<>'printer_save'
      or v_prior.request_facts is distinct from v_facts then
      raise exception 'Installer printer command already used for different facts'
        using errcode='23505';
    end if;
    return v_prior.result||jsonb_build_object('idempotentReplay',true);
  end if;
  perform set_config('sellertray.installer_printer_command_key',v_key,true);
  perform set_config('sellertray.installer_printer_appointment_id',p_appointment_id::text,true);
  perform set_config('sellertray.installer_printer_assignment_id',v_assignment::text,true);
  v_result:=public.save_sellertray_printer(
    p_tenant_id,p_printer_id,p_branch_id,p_register_id,
    p_display_name,p_hardware_identifier,p_paper_width_mm,
    p_is_default,p_is_active,p_actor_user_id
  );
  perform set_config('sellertray.installer_printer_command_key','',true);
  perform set_config('sellertray.installer_printer_appointment_id','',true);
  perform set_config('sellertray.installer_printer_assignment_id','',true);
  insert into public.sellertray_installer_printer_commands(
    command_key,actor_user_id,tenant_id,branch_id,appointment_id,
    assignment_id,command_type,request_facts,result
  ) values (
    v_key,p_actor_user_id,p_tenant_id,p_branch_id,p_appointment_id,
    v_assignment,'printer_save',v_facts,v_result
  );
  return v_result||jsonb_build_object('idempotentReplay',false);
end;
$save$;
revoke all on function public.save_sellertray_installer_printer(
 uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,boolean,boolean,text
) from public,anon,authenticated;
grant execute on function public.save_sellertray_installer_printer(
 uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,boolean,boolean,text
) to service_role;

-- Receipt profiles still use the SAME merchant-owned save RPC. The installer
-- wrapper adds AAL2, exact appointment and a durable action envelope without
-- changing that RPC's merchant/default-copies behavior or authority.
create or replace function public.save_sellertray_installer_receipt_settings(
  p_tenant_id uuid,p_appointment_id uuid,p_printer_id uuid,
  p_copy_definitions jsonb,p_merchant_footer text,p_command_key text
) returns jsonb language plpgsql security definer set search_path='' as $copies$
declare
  v_actor uuid:=auth.uid();
  v_key text:=btrim(coalesce(p_command_key,''));
  v_branch uuid;
  v_assignment uuid;
  v_facts jsonb;
  v_prior public.sellertray_installer_printer_commands%rowtype;
  v_result jsonb;
begin
  if v_actor is null or auth.jwt()->>'aal' is distinct from 'aal2'
    or p_tenant_id is null or p_appointment_id is null or p_printer_id is null
    or char_length(v_key) not between 12 and 128 then
    raise exception 'Verified installer and receipt-profile command are required'
      using errcode='42501';
  end if;
  select p.branch_id into v_branch from public.sellertray_printers p
    where p.tenant_id=p_tenant_id and p.id=p_printer_id for share;
  if v_branch is null or not public.sellertray_setup_installer_has_assignment(
    v_actor,p_tenant_id,v_branch,p_appointment_id,now()
  ) then
    raise exception 'Receipt profile is not in this installer appointment' using errcode='42501';
  end if;
  select a.id into v_assignment from public.sellertray_internal_setup_staff_assignments a
  where a.staff_user_id=v_actor and a.tenant_id=p_tenant_id
    and a.branch_id=v_branch and a.appointment_id=p_appointment_id
    and a.revoked_at is null and a.valid_from<=now() and a.valid_until>now()
  order by a.valid_from desc,a.id desc limit 1 for share;
  if v_assignment is null then
    raise exception 'Active installer assignment is required' using errcode='42501';
  end if;
  v_facts:=jsonb_build_object(
    'actor',v_actor,'tenant',p_tenant_id,'branch',v_branch,
    'appointment',p_appointment_id,'printerId',p_printer_id,
    'copyDefinitions',p_copy_definitions,
    'merchantFooter',nullif(btrim(coalesce(p_merchant_footer,'')),'')
  );
  perform pg_advisory_xact_lock(hashtextextended('installer-printer:'||v_key,0));
  select * into v_prior from public.sellertray_installer_printer_commands c
    where c.command_key=v_key;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.tenant_id<>p_tenant_id
      or v_prior.branch_id<>v_branch or v_prior.appointment_id<>p_appointment_id
      or v_prior.command_type<>'receipt_settings'
      or v_prior.request_facts is distinct from v_facts then
      raise exception 'Receipt profile command already used with different facts'
        using errcode='23505';
    end if;
    return v_prior.result||jsonb_build_object('idempotentReplay',true);
  end if;
  perform set_config('sellertray.installer_printer_command_key',v_key,true);
  perform set_config('sellertray.installer_printer_appointment_id',p_appointment_id::text,true);
  perform set_config('sellertray.installer_printer_assignment_id',v_assignment::text,true);
  v_result:=public.save_sellertray_printer_receipt_settings(
    p_tenant_id,p_printer_id,p_copy_definitions,p_merchant_footer
  );
  perform set_config('sellertray.installer_printer_command_key','',true);
  perform set_config('sellertray.installer_printer_appointment_id','',true);
  perform set_config('sellertray.installer_printer_assignment_id','',true);
  insert into public.sellertray_installer_printer_commands(
    command_key,actor_user_id,tenant_id,branch_id,appointment_id,
    assignment_id,command_type,request_facts,result
  ) values (
    v_key,v_actor,p_tenant_id,v_branch,p_appointment_id,v_assignment,
    'receipt_settings',v_facts,v_result
  );
  return v_result||jsonb_build_object('idempotentReplay',false);
end;
$copies$;
revoke all on function public.save_sellertray_installer_receipt_settings(
 uuid,uuid,uuid,jsonb,text,text) from public,anon;
grant execute on function public.save_sellertray_installer_receipt_settings(
 uuid,uuid,uuid,jsonb,text,text) to authenticated;

commit;