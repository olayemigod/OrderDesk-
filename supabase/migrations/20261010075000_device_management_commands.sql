begin;

create or replace function public.save_sellertray_register(
  p_tenant_id uuid,
  p_register_id uuid,
  p_branch_id uuid,
  p_code text,
  p_name text,
  p_is_default boolean,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_code text := upper(nullif(btrim(coalesce(p_code,'')),''));
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_register public.sellertray_registers%rowtype;
  v_existing_default uuid;
  v_make_default boolean;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null or v_code is null or v_name is null
     or p_is_default is null or p_is_active is null then
    raise exception 'Business, Branch, register code, register name and status are required' using errcode='22023';
  end if;
  if char_length(v_code)>40 or char_length(v_name)>120 then
    raise exception 'Register details are too long' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Only business management can manage registers' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to manage devices in this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then
    raise exception 'You do not have permission to manage devices' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id and b.is_active=true
  ) then
    raise exception 'Selected Branch is unavailable' using errcode='23514';
  end if;
  if p_is_default and not p_is_active then
    raise exception 'Default register must remain active' using errcode='23514';
  end if;

  select r.id into v_existing_default
  from public.sellertray_registers r
  where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.is_default=true
  limit 1;

  if p_register_id is null then
    v_make_default := p_is_default or v_existing_default is null;
    insert into public.sellertray_registers(
      tenant_id,branch_id,code,name,is_default,is_active,created_at,updated_at
    ) values(
      p_tenant_id,p_branch_id,v_code,v_name,false,
      case when v_make_default then true else p_is_active end,now(),now()
    ) returning * into v_register;
  else
    select * into v_register
    from public.sellertray_registers r
    where r.tenant_id=p_tenant_id and r.id=p_register_id
    for update;
    if not found then
      raise exception 'Register not found' using errcode='P0002';
    end if;
    if v_register.branch_id<>p_branch_id then
      raise exception 'Register Branch cannot be changed after creation' using errcode='23514';
    end if;
    if v_register.is_default and (not p_is_default or not p_is_active) then
      raise exception 'Choose another default register before changing this register' using errcode='23514';
    end if;
    v_make_default := p_is_default;
    update public.sellertray_registers
    set code=v_code,
        name=v_name,
        is_active=p_is_active,
        updated_at=now()
    where tenant_id=p_tenant_id and id=p_register_id
    returning * into v_register;
  end if;

  if v_make_default then
    update public.sellertray_registers
    set is_default=false,updated_at=now()
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and id<>v_register.id and is_default=true;
    update public.sellertray_registers
    set is_default=true,is_active=true,updated_at=now()
    where tenant_id=p_tenant_id and id=v_register.id
    returning * into v_register;
  else
    update public.sellertray_registers
    set is_default=false,updated_at=now()
    where tenant_id=p_tenant_id and id=v_register.id
    returning * into v_register;
  end if;

  return jsonb_build_object(
    'registerId',v_register.id,
    'branchId',v_register.branch_id,
    'code',v_register.code,
    'name',v_register.name,
    'isDefault',v_register.is_default,
    'isActive',v_register.is_active
  );
end;
$$;

revoke all on function public.save_sellertray_register(uuid,uuid,uuid,text,text,boolean,boolean)
  from public,anon;
grant execute on function public.save_sellertray_register(uuid,uuid,uuid,text,text,boolean,boolean)
  to authenticated;

create or replace function public.get_sellertray_device_management_overview(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_registers jsonb;
  v_printers jsonb;
  v_jobs jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Only business management can review devices' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to devices in this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then
    raise exception 'You do not have permission to manage devices' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,
    'code',r.code,
    'name',r.name,
    'isDefault',r.is_default,
    'isActive',r.is_active
  ) order by r.is_active desc,r.is_default desc,r.name,r.id),'[]'::jsonb)
  into v_registers
  from public.sellertray_registers r
  where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,
    'registerId',p.register_id,
    'registerName',r.name,
    'displayName',p.display_name,
    'transport',p.transport,
    'hardwareIdentifier',p.hardware_identifier,
    'paperWidthMm',p.paper_width_mm,
    'isDefault',p.is_default,
    'isActive',p.is_active,
    'updatedAt',p.updated_at
  ) order by p.is_active desc,p.is_default desc,p.display_name,p.id),'[]'::jsonb)
  into v_printers
  from public.sellertray_printers p
  join public.sellertray_registers r
    on r.tenant_id=p.tenant_id and r.id=p.register_id
  where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',x.id,
    'jobType',x.job_type,
    'status',x.status,
    'printerName',x.printer_name,
    'registerName',x.register_name,
    'orderReference',x.public_order_id,
    'requestedAt',x.requested_at,
    'completedAt',x.completed_at,
    'failedAt',x.failed_at,
    'failureMessage',x.failure_message
  ) order by x.requested_at desc,x.id),'[]'::jsonb)
  into v_jobs
  from (
    select j.id,j.job_type,j.status,j.printer_name,r.name as register_name,
           o.public_order_id,j.requested_at,j.completed_at,j.failed_at,j.failure_message
    from public.sellertray_print_jobs j
    join public.sellertray_registers r
      on r.tenant_id=j.tenant_id and r.id=j.register_id
    left join public.orders o
      on o.tenant_id=j.tenant_id and o.id=j.order_id
    where j.tenant_id=p_tenant_id and j.branch_id=p_branch_id
    order by j.requested_at desc,j.id
    limit 50
  ) x;

  return jsonb_build_object(
    'branchId',p_branch_id,
    'registers',v_registers,
    'printers',v_printers,
    'recentJobs',v_jobs
  );
end;
$$;

revoke all on function public.get_sellertray_device_management_overview(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_device_management_overview(uuid,uuid)
  to authenticated;

commit;
