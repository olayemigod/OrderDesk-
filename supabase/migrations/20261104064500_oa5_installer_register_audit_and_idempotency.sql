-- OA5: Installer register creation must be an audited, command-keyed
-- operation. The shared SellerTray register mutation remains authoritative;
-- this wrapper adds exact-appointment proof and atomic immutable history.
begin;

create table public.sellertray_installer_register_commands (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique
    check (char_length(btrim(request_key)) between 8 and 128),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id) on delete restrict,
  request_facts jsonb not null check (jsonb_typeof(request_facts)='object'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

create table public.sellertray_installer_register_events (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.sellertray_installer_register_commands(id)
    on delete restrict deferrable initially deferred,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id) on delete restrict,
  register_id uuid not null references public.sellertray_registers(id) on delete restrict,
  event_type text not null check (event_type in ('created','updated')),
  before_state jsonb,
  after_state jsonb not null check (jsonb_typeof(after_state)='object'),
  created_at timestamptz not null default now()
);
create index sellertray_installer_register_events_scope
  on public.sellertray_installer_register_events(tenant_id,branch_id,appointment_id,created_at desc);

alter table public.sellertray_installer_register_commands enable row level security;
alter table public.sellertray_installer_register_events enable row level security;
revoke all on public.sellertray_installer_register_commands from public,anon,authenticated;
revoke all on public.sellertray_installer_register_events from public,anon,authenticated;
grant select,insert on public.sellertray_installer_register_commands to service_role;
grant select,insert on public.sellertray_installer_register_events to service_role;
create trigger prevent_sellertray_installer_register_command_mutation
 before update or delete on public.sellertray_installer_register_commands
 for each row execute function public.prevent_sellertray_commercial_history_mutation();
create trigger prevent_sellertray_installer_register_event_mutation
 before update or delete on public.sellertray_installer_register_events
 for each row execute function public.prevent_sellertray_commercial_history_mutation();

-- Every row changed by an authenticated Setup Installer must have a matching
-- appointment/command envelope. Direct calls to legacy save_sellertray_register
-- without that envelope are denied, even though the shared service permits
-- the otherwise qualified staff identity. Merchant register operations remain
-- unchanged and do not inherit this installation-only audit model.
create or replace function public.sellertray_capture_installer_register_change()
returns trigger language plpgsql security definer set search_path='' as $event$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := new.tenant_id;
  v_branch_id uuid := new.branch_id;
  v_command_id uuid;
  v_appointment_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if v_actor is null or not exists(
    select 1 from public.sellertray_internal_setup_staff s where s.user_id=v_actor
  ) then return new; end if;

  if not public.sellertray_setup_installer_device_allowed(
    v_tenant_id,v_branch_id,v_actor,false
  ) then
    raise exception 'Installer register access requires a current verified Branch appointment'
      using errcode='42501';
  end if;
  v_command_id:=nullif(current_setting('sellertray.installer_register_command_id',true),'')::uuid;
  v_appointment_id:=nullif(current_setting('sellertray.installer_register_appointment_id',true),'')::uuid;
  if v_command_id is null or v_appointment_id is null or not
    public.sellertray_setup_installer_has_assignment(
      v_actor,v_tenant_id,v_branch_id,v_appointment_id,now()
    ) then
    raise exception 'Use the audited ProcessEdge installation register command'
      using errcode='42501';
  end if;
  if tg_op='UPDATE' and (
     new.tenant_id is distinct from old.tenant_id
     or new.branch_id is distinct from old.branch_id
  ) then
    raise exception 'Installer cannot change register Business or Branch' using errcode='42501';
  end if;
  v_before:=case when tg_op='INSERT' then null else
    jsonb_build_object('code',old.code,'name',old.name,
      'isDefault',old.is_default,'isActive',old.is_active) end;
  v_after:=jsonb_build_object('code',new.code,'name',new.name,
      'isDefault',new.is_default,'isActive',new.is_active);
  if tg_op='INSERT' or v_before is distinct from v_after then
    insert into public.sellertray_installer_register_events(
      command_id,actor_user_id,tenant_id,branch_id,appointment_id,
      register_id,event_type,before_state,after_state
    ) values(
      v_command_id,v_actor,v_tenant_id,v_branch_id,v_appointment_id,
      new.id,case when tg_op='INSERT' then 'created' else 'updated' end,
      v_before,v_after
    );
  end if;
  return new;
end;
$event$;
revoke all on function public.sellertray_capture_installer_register_change()
 from public,anon,authenticated;
create trigger sellertray_installer_register_mutation_audit
  after insert or update on public.sellertray_registers
  for each row execute function public.sellertray_capture_installer_register_change();

create or replace function public.save_sellertray_installer_register(
  p_tenant_id uuid,p_branch_id uuid,p_appointment_id uuid,
  p_code text,p_name text,p_request_key text
) returns jsonb language plpgsql security definer set search_path='' as $command$
declare
  v_actor uuid := auth.uid();
  v_key text := nullif(btrim(coalesce(p_request_key,'')),'');
  v_facts jsonb;
  v_previous public.sellertray_installer_register_commands%rowtype;
  v_command_id uuid := gen_random_uuid();
  v_result jsonb;
  v_is_first boolean;
begin
  if v_actor is null or p_tenant_id is null or p_branch_id is null
    or p_appointment_id is null or v_key is null or char_length(v_key) not between 8 and 128 then
    raise exception 'Installer appointment and register command key are required' using errcode='22023';
  end if;
  if not public.sellertray_setup_installer_device_allowed(
    p_tenant_id,p_branch_id,v_actor,false
  ) or not public.sellertray_setup_installer_has_assignment(
    v_actor,p_tenant_id,p_branch_id,p_appointment_id,now()
  ) then
    raise exception 'Current ProcessEdge installation assignment and MFA required' using errcode='42501';
  end if;
  v_facts:=jsonb_build_object(
    'tenantId',p_tenant_id,'branchId',p_branch_id,'appointmentId',p_appointment_id,
    'code',upper(btrim(coalesce(p_code,''))),'name',btrim(coalesce(p_name,''))
  );
  perform pg_advisory_xact_lock(hashtextextended('installer-register:'||v_key,0));
  select * into v_previous from public.sellertray_installer_register_commands
    where request_key=v_key;
  if found then
    if v_previous.actor_user_id<>v_actor or v_previous.tenant_id<>p_tenant_id
      or v_previous.branch_id<>p_branch_id
      or v_previous.appointment_id<>p_appointment_id
      or v_previous.request_facts is distinct from v_facts then
      raise exception 'Installer register request key already used for other facts'
        using errcode='23505';
    end if;
    return v_previous.result||jsonb_build_object('idempotentReplay',true);
  end if;
  v_is_first:=not exists(
    select 1 from public.sellertray_registers r
    where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.is_default
  );
  perform set_config('sellertray.installer_register_command_id',v_command_id::text,true);
  perform set_config('sellertray.installer_register_appointment_id',p_appointment_id::text,true);
  v_result:=public.save_sellertray_register(
    p_tenant_id,null,p_branch_id,p_code,p_name,v_is_first,true
  );
  perform set_config('sellertray.installer_register_command_id','',true);
  perform set_config('sellertray.installer_register_appointment_id','',true);
  insert into public.sellertray_installer_register_commands(
    id,request_key,actor_user_id,tenant_id,branch_id,appointment_id,request_facts,result
  ) values(v_command_id,v_key,v_actor,p_tenant_id,p_branch_id,p_appointment_id,v_facts,v_result);
  return v_result||jsonb_build_object('idempotentReplay',false);
end;
$command$;
revoke all on function public.save_sellertray_installer_register(
  uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.save_sellertray_installer_register(
  uuid,uuid,uuid,text,text,text) to authenticated,service_role;

commit;