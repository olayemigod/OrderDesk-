begin;

-- OA3 scope repair.
-- Workers and service areas are ProcessEdge-global because worker capacity must
-- serialize across every merchant. Editing those masters therefore requires a
-- platform-scoped branch-setup capability. Tenant-scoped grants remain valid for
-- scheduling, Branch coverage assignment and appointment lifecycle commands for
-- their governed Business scope.

create or replace function public.platform_admin_upsert_setup_service_area(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_service_area_id uuid,
  p_code text,
  p_name text,
  p_active boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_code text:=lower(btrim(coalesce(p_code,'')));
  v_name text:=btrim(coalesce(p_name,''));
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'Platform-scoped Branch setup management capability required for service-area masters' using errcode='42501';
  end if;
  if char_length(v_code) not between 2 and 64 or char_length(v_name) not between 2 and 160 or char_length(v_reason)<6 then
    raise exception 'Service area code, name and reason are required' using errcode='22023';
  end if;

  if p_service_area_id is null then
    insert into public.sellertray_setup_service_areas(code,name,active)
    values(v_code,v_name,coalesce(p_active,true)) returning id into v_id;
  else
    update public.sellertray_setup_service_areas
    set code=v_code,name=v_name,active=coalesce(p_active,true),updated_at=now()
    where id=p_service_area_id returning id into v_id;
    if v_id is null then raise exception 'Setup service area not found' using errcode='P0002'; end if;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,p_tenant_id,'setup_service_area_saved',
    jsonb_build_object('serviceAreaId',v_id,'reason',v_reason,'authorityScope','platform')
  );
  return v_id;
end;
$$;

create or replace function public.platform_admin_upsert_setup_worker(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_worker_id uuid,
  p_worker_code text,
  p_display_name text,
  p_active boolean,
  p_max_concurrent_setups integer,
  p_travel_buffer_minutes integer,
  p_service_area_ids uuid[],
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_code text:=lower(btrim(coalesce(p_worker_code,'')));
  v_name text:=btrim(coalesce(p_display_name,''));
  v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',null,now()) then
    raise exception 'Platform-scoped Branch setup management capability required for workforce masters' using errcode='42501';
  end if;
  if char_length(v_code) not between 2 and 64 or char_length(v_name) not between 2 and 160 or char_length(v_reason)<6
     or coalesce(p_max_concurrent_setups,0) not between 1 and 20
     or coalesce(p_travel_buffer_minutes,-1) not between 0 and 480 then
    raise exception 'Valid worker identity, capacity, travel buffer and reason are required' using errcode='22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_service_area_ids,'{}'::uuid[])) x(id)
    where not exists (
      select 1 from public.sellertray_setup_service_areas a where a.id=x.id and a.active
    )
  ) then
    raise exception 'Worker coverage contains an inactive or unknown service area' using errcode='23514';
  end if;

  if p_worker_id is null then
    insert into public.sellertray_setup_workers(
      worker_code,display_name,active,max_concurrent_setups,travel_buffer_minutes
    ) values(
      v_code,v_name,coalesce(p_active,true),p_max_concurrent_setups,p_travel_buffer_minutes
    ) returning id into v_id;
  else
    update public.sellertray_setup_workers
    set worker_code=v_code,
        display_name=v_name,
        active=coalesce(p_active,true),
        max_concurrent_setups=p_max_concurrent_setups,
        travel_buffer_minutes=p_travel_buffer_minutes,
        updated_at=now()
    where id=p_worker_id returning id into v_id;
    if v_id is null then raise exception 'Setup worker not found' using errcode='P0002'; end if;
  end if;

  delete from public.sellertray_setup_worker_service_areas where worker_id=v_id;
  insert into public.sellertray_setup_worker_service_areas(worker_id,service_area_id)
  select v_id,x.id from unnest(coalesce(p_service_area_ids,'{}'::uuid[])) x(id)
  on conflict do nothing;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,p_tenant_id,'setup_worker_saved',
    jsonb_build_object(
      'workerId',v_id,
      'reason',v_reason,
      'serviceAreaIds',coalesce(to_jsonb(p_service_area_ids),'[]'::jsonb),
      'authorityScope','platform'
    )
  );
  return v_id;
end;
$$;

-- Merchant requested windows are advisory but must still be prospective.
create or replace function public.request_sellertray_setup_reschedule(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_requested_start_at timestamptz,
  p_requested_end_at timestamptz,
  p_merchant_note text,
  p_command_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=(select auth.uid());
  v_role text;
  v_appointment public.sellertray_commercial_setup_appointments%rowtype;
  v_existing public.sellertray_setup_reschedule_requests%rowtype;
  v_id uuid;
  v_note text:=btrim(coalesce(p_merchant_note,''));
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Setup reschedule requests require an Owner or Manager' using errcode='42501';
  end if;
  if p_command_id is null or char_length(v_note) not between 6 and 2000 then
    raise exception 'Reschedule command and note are required' using errcode='22023';
  end if;
  if (p_requested_start_at is null)<>(p_requested_end_at is null)
     or (p_requested_start_at is not null and p_requested_end_at<=p_requested_start_at) then
    raise exception 'Requested setup window must be complete and valid' using errcode='22023';
  end if;
  if p_requested_start_at is not null and p_requested_start_at<now()-interval '5 minutes' then
    raise exception 'Requested setup window cannot start in the past' using errcode='22023';
  end if;

  select a.* into strict v_appointment
  from public.sellertray_commercial_setup_appointments a
  where a.id=p_appointment_id and a.tenant_id=p_tenant_id;
  if v_appointment.status<>'scheduled' then
    raise exception 'Only a scheduled setup can be changed' using errcode='23514';
  end if;

  select r.* into v_existing
  from public.sellertray_setup_reschedule_requests r
  where r.command_id=p_command_id;
  if found then
    if v_existing.tenant_id<>p_tenant_id
       or v_existing.appointment_id<>p_appointment_id
       or v_existing.requested_by_user_id<>v_user_id
       or v_existing.requested_start_at is distinct from p_requested_start_at
       or v_existing.requested_end_at is distinct from p_requested_end_at
       or v_existing.merchant_note<>v_note then
      raise exception 'Setup reschedule command is already used for different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;
  if exists(
    select 1 from public.sellertray_setup_reschedule_requests r
    where r.appointment_id=p_appointment_id and r.status='pending'
  ) then
    raise exception 'A setup reschedule request is already pending' using errcode='23505';
  end if;

  insert into public.sellertray_setup_reschedule_requests(
    appointment_id,tenant_id,branch_id,command_id,requested_by_user_id,
    requested_start_at,requested_end_at,merchant_note
  ) values(
    p_appointment_id,p_tenant_id,v_appointment.branch_id,p_command_id,v_user_id,
    p_requested_start_at,p_requested_end_at,v_note
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text) from public,anon,authenticated;
revoke all on function public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated;

grant execute on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text) to service_role;
grant execute on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text) to service_role;
grant execute on function public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid) to authenticated;

comment on function public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text)
  is 'OA3 ProcessEdge-global workforce master mutation. Requires platform-scoped admin.branch_setup.manage; appointment scheduling remains tenant-scoped.';
comment on function public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text)
  is 'OA3 ProcessEdge-global service-area master mutation. Requires platform-scoped admin.branch_setup.manage; Branch area assignment remains tenant-scoped.';

commit;
