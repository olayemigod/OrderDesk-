begin;

alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock',
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_review_shift',
      'can_print_receipt',
      'can_manage_devices'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock',
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_review_shift',
      'can_print_receipt',
      'can_manage_devices'
    ));

create or replace function public.sellertray_user_has_capability(
  p_tenant_id uuid,
  p_user_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_override boolean;
begin
  if p_tenant_id is null or p_user_id is null
     or p_capability not in (
       'can_receive_stock',
       'can_adjust_stock',
       'can_count_stock',
       'can_apply_stock_count',
       'can_transfer_stock',
       'can_open_shift',
       'can_record_cash_movement',
       'can_record_expense',
       'can_close_shift',
       'can_review_shift',
       'can_print_receipt',
       'can_manage_devices'
     ) then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_user_id;

  if v_role is null then
    return false;
  end if;

  if v_role='owner' then
    return true;
  end if;

  select c.allowed into v_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_user_id
    and c.capability=p_capability;

  if found then
    return v_override;
  end if;

  if v_role='manager' then
    return true;
  end if;

  if v_role='staff' then
    return p_capability in (
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_print_receipt'
    );
  end if;

  return false;
end;
$$;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text)
  to service_role;

create or replace function public.set_sellertray_member_capability(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_capability text,
  p_allowed boolean,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_capability text := lower(btrim(coalesce(p_capability,'')));
  v_previous_override boolean;
  v_previous_effective boolean;
  v_changed boolean := false;
begin
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null
     or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required'
      using errcode='22023';
  end if;

  if v_capability not in (
    'can_receive_stock',
    'can_adjust_stock',
    'can_count_stock',
    'can_apply_stock_count',
    'can_transfer_stock',
    'can_open_shift',
    'can_record_cash_movement',
    'can_record_expense',
    'can_close_shift',
    'can_review_shift',
    'can_print_receipt',
    'can_manage_devices'
  ) then
    raise exception 'Unknown SellerTray permission' using errcode='22023';
  end if;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  select tm.role into v_target_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions'
      using errcode='42501';
  end if;
  if v_target_role is null then
    raise exception 'Staff member does not belong to this business' using errcode='23503';
  end if;
  if v_target_role='owner' then
    raise exception 'Owner authority cannot be changed here' using errcode='42501';
  end if;
  if v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change permissions for Staff only'
      using errcode='42501';
  end if;

  v_previous_effective := public.sellertray_user_has_capability(
    p_tenant_id,p_target_user_id,v_capability
  );

  select c.allowed into v_previous_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_target_user_id
    and c.capability=v_capability;

  if not found or v_previous_override is distinct from p_allowed then
    v_changed := true;
  end if;

  insert into public.tenant_member_capabilities(
    tenant_id,user_id,capability,allowed,granted_by,created_at,updated_at
  ) values(
    p_tenant_id,p_target_user_id,v_capability,p_allowed,p_actor_user_id,now(),now()
  )
  on conflict(tenant_id,user_id,capability) do update
    set allowed=excluded.allowed,
        granted_by=excluded.granted_by,
        updated_at=now();

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
    ) values(
      p_tenant_id,p_target_user_id,v_capability,
      v_previous_effective,p_allowed,p_actor_user_id
    );
  end if;

  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  to service_role;

create table public.sellertray_printers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  transport text not null default 'bluetooth' check (transport='bluetooth'),
  hardware_identifier text not null check (char_length(btrim(hardware_identifier)) between 1 and 160),
  paper_width_mm integer not null check (paper_width_mm in (58,80)),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,branch_id,register_id,id),
  constraint sellertray_printers_register_same_branch
    foreign key (tenant_id,branch_id,register_id)
    references public.sellertray_registers(tenant_id,branch_id,id)
    on delete cascade
);

create unique index sellertray_printers_hardware_unique
  on public.sellertray_printers(tenant_id,lower(btrim(hardware_identifier)));
create unique index sellertray_printers_one_default_register
  on public.sellertray_printers(tenant_id,register_id)
  where is_default and is_active;
create index sellertray_printers_branch_register_idx
  on public.sellertray_printers(tenant_id,branch_id,register_id,is_active,display_name);

create table public.sellertray_printer_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  printer_id uuid not null,
  event_type text not null check (event_type in ('registered','updated','default_removed')),
  actor_user_id uuid not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint sellertray_printer_events_printer_same_tenant
    foreign key (tenant_id,printer_id)
    references public.sellertray_printers(tenant_id,id)
    on delete cascade
);

create index sellertray_printer_events_printer_created_idx
  on public.sellertray_printer_events(tenant_id,printer_id,created_at desc);

create table public.sellertray_print_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  printer_id uuid not null,
  job_type text not null check (job_type in ('receipt','test')),
  order_id uuid,
  financial_document_id uuid,
  request_key text not null check (char_length(btrim(request_key)) between 1 and 128),
  status text not null default 'requested'
    check (status in ('requested','printing','printed','failed')),
  transport text not null check (transport='bluetooth'),
  printer_name text not null,
  hardware_identifier text not null,
  paper_width_mm integer not null check (paper_width_mm in (58,80)),
  content_snapshot jsonb not null,
  requested_by_user_id uuid not null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,request_key),
  constraint sellertray_print_jobs_printer_same_register
    foreign key (tenant_id,branch_id,register_id,printer_id)
    references public.sellertray_printers(tenant_id,branch_id,register_id,id)
    on delete restrict,
  constraint sellertray_print_jobs_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_print_jobs_document_same_order
    foreign key (tenant_id,order_id,financial_document_id)
    references public.order_financial_documents(tenant_id,order_id,id)
    on delete restrict,
  constraint sellertray_print_jobs_source_check check (
    (job_type='test' and order_id is null and financial_document_id is null)
    or (job_type='receipt' and order_id is not null and financial_document_id is not null)
  ),
  constraint sellertray_print_jobs_state_check check (
    (status='requested'
      and started_at is null and completed_at is null and failed_at is null
      and failure_code is null and failure_message is null)
    or (status='printing'
      and started_at is not null and completed_at is null and failed_at is null
      and failure_code is null and failure_message is null)
    or (status='printed'
      and started_at is not null and completed_at is not null and failed_at is null
      and failure_code is null and failure_message is null)
    or (status='failed'
      and completed_at is null and failed_at is not null
      and nullif(btrim(coalesce(failure_message,'')),'') is not null)
  )
);

create index sellertray_print_jobs_branch_requested_idx
  on public.sellertray_print_jobs(tenant_id,branch_id,requested_at desc);
create index sellertray_print_jobs_order_requested_idx
  on public.sellertray_print_jobs(tenant_id,order_id,requested_at desc)
  where order_id is not null;

alter table public.sellertray_printers enable row level security;
alter table public.sellertray_printer_events enable row level security;
alter table public.sellertray_print_jobs enable row level security;
revoke all on public.sellertray_printers from public,anon,authenticated;
revoke all on public.sellertray_printer_events from public,anon,authenticated;
revoke all on public.sellertray_print_jobs from public,anon,authenticated;
grant all on public.sellertray_printers to service_role;
grant all on public.sellertray_printer_events to service_role;
grant all on public.sellertray_print_jobs to service_role;

create or replace function public.sellertray_printer_state(p public.sellertray_printers)
returns jsonb
language sql
immutable
set search_path=''
as $$
  select jsonb_build_object(
    'printerId',p.id,
    'branchId',p.branch_id,
    'registerId',p.register_id,
    'displayName',p.display_name,
    'transport',p.transport,
    'hardwareIdentifier',p.hardware_identifier,
    'paperWidthMm',p.paper_width_mm,
    'isDefault',p.is_default,
    'isActive',p.is_active
  );
$$;

revoke all on function public.sellertray_printer_state(public.sellertray_printers)
  from public,anon,authenticated;
grant execute on function public.sellertray_printer_state(public.sellertray_printers)
  to service_role;

create or replace function public.save_sellertray_printer(
  p_tenant_id uuid,
  p_printer_id uuid,
  p_branch_id uuid,
  p_register_id uuid,
  p_display_name text,
  p_hardware_identifier text,
  p_paper_width_mm integer,
  p_is_default boolean,
  p_is_active boolean,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_printer public.sellertray_printers%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_display_name text := nullif(btrim(coalesce(p_display_name,'')),'');
  v_hardware_identifier text := nullif(btrim(coalesce(p_hardware_identifier,'')),'');
  v_event_type text;
  v_other record;
begin
  if p_tenant_id is null or p_branch_id is null or p_register_id is null
     or p_actor_user_id is null or v_display_name is null or v_hardware_identifier is null
     or p_paper_width_mm not in (58,80) or p_is_default is null or p_is_active is null then
    raise exception 'Business, branch, register, printer identity and paper width are required'
      using errcode='22023';
  end if;
  if char_length(v_display_name)>120 or char_length(v_hardware_identifier)>160 then
    raise exception 'Printer details are too long' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to manage devices in this branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_manage_devices') then
    raise exception 'You do not have permission to manage printers' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.sellertray_registers r
    where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
      and r.id=p_register_id and r.is_active=true
  ) then
    raise exception 'Selected register is unavailable for this branch' using errcode='23514';
  end if;

  if p_printer_id is null then
    insert into public.sellertray_printers(
      tenant_id,branch_id,register_id,display_name,transport,hardware_identifier,
      paper_width_mm,is_default,is_active,created_by_user_id
    ) values(
      p_tenant_id,p_branch_id,p_register_id,v_display_name,'bluetooth',v_hardware_identifier,
      p_paper_width_mm,false,p_is_active,p_actor_user_id
    ) returning * into v_printer;
    v_event_type := 'registered';
    v_before := null;
  else
    select * into v_printer
    from public.sellertray_printers p
    where p.tenant_id=p_tenant_id and p.id=p_printer_id
    for update;
    if not found then raise exception 'Printer not found' using errcode='22023'; end if;
    if v_printer.branch_id<>p_branch_id or v_printer.register_id<>p_register_id then
      raise exception 'Printer branch and register cannot be changed after registration' using errcode='23514';
    end if;
    v_before := public.sellertray_printer_state(v_printer);
    update public.sellertray_printers
    set display_name=v_display_name,
        hardware_identifier=v_hardware_identifier,
        paper_width_mm=p_paper_width_mm,
        is_active=p_is_active,
        is_default=case when p_is_active then is_default else false end,
        updated_at=now()
    where tenant_id=p_tenant_id and id=p_printer_id
    returning * into v_printer;
    v_event_type := 'updated';
  end if;

  if p_is_default and p_is_active then
    for v_other in
      select p.* from public.sellertray_printers p
      where p.tenant_id=p_tenant_id
        and p.register_id=p_register_id
        and p.id<>v_printer.id
        and p.is_default=true
      for update
    loop
      insert into public.sellertray_printer_events(
        tenant_id,printer_id,event_type,actor_user_id,before_state,after_state
      ) values(
        p_tenant_id,v_other.id,'default_removed',p_actor_user_id,
        public.sellertray_printer_state(v_other),
        jsonb_set(public.sellertray_printer_state(v_other),'{isDefault}','false'::jsonb)
      );
    end loop;

    update public.sellertray_printers
    set is_default=false,updated_at=now()
    where tenant_id=p_tenant_id
      and register_id=p_register_id
      and id<>v_printer.id
      and is_default=true;

    update public.sellertray_printers
    set is_default=true,updated_at=now()
    where tenant_id=p_tenant_id and id=v_printer.id
    returning * into v_printer;
  else
    update public.sellertray_printers
    set is_default=false,updated_at=now()
    where tenant_id=p_tenant_id and id=v_printer.id
    returning * into v_printer;
  end if;

  v_after := public.sellertray_printer_state(v_printer);
  if v_before is null or v_before is distinct from v_after then
    insert into public.sellertray_printer_events(
      tenant_id,printer_id,event_type,actor_user_id,before_state,after_state
    ) values(p_tenant_id,v_printer.id,v_event_type,p_actor_user_id,v_before,v_after);
  end if;

  return v_after;
end;
$$;

revoke all on function public.save_sellertray_printer(uuid,uuid,uuid,uuid,text,text,integer,boolean,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.save_sellertray_printer(uuid,uuid,uuid,uuid,text,text,integer,boolean,boolean,uuid)
  to service_role;

create or replace function public.get_sellertray_printers(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_register_id uuid default null
)
returns table(
  id uuid,
  register_id uuid,
  register_name text,
  display_name text,
  transport text,
  hardware_identifier text,
  paper_width_mm integer,
  is_default boolean,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_manage boolean;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to printers in this branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_print_receipt')
     and not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then
    raise exception 'You do not have permission to use printers' using errcode='42501';
  end if;
  v_manage := public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices');

  return query
  select p.id,p.register_id,r.name,p.display_name,p.transport,p.hardware_identifier,
         p.paper_width_mm,p.is_default,p.is_active
  from public.sellertray_printers p
  join public.sellertray_registers r
    on r.tenant_id=p.tenant_id and r.id=p.register_id
  where p.tenant_id=p_tenant_id
    and p.branch_id=p_branch_id
    and (p_register_id is null or p.register_id=p_register_id)
    and (p.is_active=true or v_manage)
  order by p.is_active desc,p.is_default desc,p.display_name,p.id;
end;
$$;

revoke all on function public.get_sellertray_printers(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_printers(uuid,uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_printing_capabilities(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
  can_print_receipt boolean,
  can_manage_devices boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_branch_allowed boolean;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  v_branch_allowed := public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id);
  return query select
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_print_receipt'),
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices');
end;
$$;

revoke all on function public.get_sellertray_printing_capabilities(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_printing_capabilities(uuid,uuid)
  to authenticated;

create or replace function public.request_sellertray_print_job(
  p_tenant_id uuid,
  p_printer_id uuid,
  p_job_type text,
  p_order_id uuid,
  p_request_key text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_printer public.sellertray_printers%rowtype;
  v_job public.sellertray_print_jobs%rowtype;
  v_job_type text := lower(btrim(coalesce(p_job_type,'')));
  v_request_key text := nullif(btrim(coalesce(p_request_key,'')),'');
  v_document public.order_financial_documents%rowtype;
  v_order public.orders%rowtype;
  v_branch_name text;
  v_register_name text;
  v_customer_name text;
  v_customer_phone text;
  v_payment public.order_payments%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_snapshot jsonb;
begin
  if p_tenant_id is null or p_printer_id is null or p_actor_user_id is null
     or v_job_type not in ('receipt','test') or v_request_key is null
     or char_length(v_request_key)>128 then
    raise exception 'Business, printer, print type and request key are required' using errcode='22023';
  end if;
  if v_job_type='receipt' and p_order_id is null then
    raise exception 'Receipt printing requires an order' using errcode='22023';
  end if;
  if v_job_type='test' and p_order_id is not null then
    raise exception 'Test print cannot reference a business order' using errcode='22023';
  end if;

  select * into v_printer
  from public.sellertray_printers p
  where p.tenant_id=p_tenant_id and p.id=p_printer_id
  for share;
  if not found or not v_printer.is_active then
    raise exception 'Selected printer is unavailable' using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_printer.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to print in this branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_print_receipt') then
    raise exception 'You do not have permission to print receipts' using errcode='42501';
  end if;

  select * into v_job
  from public.sellertray_print_jobs j
  where j.tenant_id=p_tenant_id and j.request_key=v_request_key
  limit 1;
  if found then
    if v_job.printer_id<>p_printer_id
       or v_job.job_type<>v_job_type
       or v_job.order_id is distinct from p_order_id then
      raise exception 'This print request key is already used for different facts' using errcode='23505';
    end if;
    return jsonb_build_object(
      'jobId',v_job.id,'status',v_job.status,'jobType',v_job.job_type,
      'printerId',v_job.printer_id,'printerName',v_job.printer_name,
      'transport',v_job.transport,'hardwareIdentifier',v_job.hardware_identifier,
      'paperWidthMm',v_job.paper_width_mm,'contentSnapshot',v_job.content_snapshot,
      'idempotentReplay',true
    );
  end if;

  select b.name into v_branch_name
  from public.branches b
  where b.tenant_id=p_tenant_id and b.id=v_printer.branch_id;
  select r.name into v_register_name
  from public.sellertray_registers r
  where r.tenant_id=p_tenant_id and r.id=v_printer.register_id;

  if v_job_type='test' then
    v_snapshot := jsonb_build_object(
      'formatVersion',1,
      'documentType','test',
      'title','SellerTray printer test',
      'businessName',(select t.name from public.tenants t where t.id=p_tenant_id),
      'branchName',v_branch_name,
      'registerName',v_register_name,
      'printerName',v_printer.display_name,
      'paperWidthMm',v_printer.paper_width_mm,
      'requestedAt',now(),
      'footer','SellerTray · ProcessEdge Solutions Limited'
    );
  else
    select * into v_order
    from public.orders o
    where o.tenant_id=p_tenant_id and o.id=p_order_id;
    if not found then raise exception 'Order not found' using errcode='22023'; end if;
    if v_order.branch_id<>v_printer.branch_id then
      raise exception 'Receipt order and printer must belong to the same branch' using errcode='23514';
    end if;

    select * into v_document
    from public.order_financial_documents d
    where d.tenant_id=p_tenant_id
      and d.order_id=p_order_id
      and d.document_type='receipt'
      and d.status='issued';
    if not found then
      raise exception 'This order does not have an issued payment receipt' using errcode='23514';
    end if;

    select * into v_payment
    from public.order_payments p
    where p.tenant_id=p_tenant_id
      and p.order_id=p_order_id
      and p.id=v_document.payment_id
      and p.status='confirmed';
    if not found then
      raise exception 'Receipt payment evidence is unavailable' using errcode='23514';
    end if;

    select coalesce(c.display_name,c.phone,c.wa_id,'Walk-in Customer'),coalesce(c.phone,c.wa_id)
    into v_customer_name,v_customer_phone
    from public.customers c
    where c.tenant_id=p_tenant_id and c.id=v_order.customer_id;
    if v_customer_name is null then v_customer_name := 'Walk-in Customer'; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'name',oi.item_name,
      'quantity',oi.quantity,
      'uom',coalesce(oi.selected_uom,'Each'),
      'unitPrice',oi.unit_price,
      'lineTotal',oi.line_total
    ) order by oi.created_at,oi.id),'[]'::jsonb)
    into v_items
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;

    v_snapshot := jsonb_build_object(
      'formatVersion',1,
      'documentType','receipt',
      'businessName',(select t.name from public.tenants t where t.id=p_tenant_id),
      'businessEmail',(select t.business_email from public.tenants t where t.id=p_tenant_id),
      'businessPhone',(select t.business_phone from public.tenants t where t.id=p_tenant_id),
      'branchName',v_branch_name,
      'registerName',v_register_name,
      'orderReference',v_order.public_order_id,
      'receiptReference',v_document.document_reference,
      'issuedAt',v_document.issued_at,
      'customerName',v_customer_name,
      'customerPhone',v_customer_phone,
      'currency',v_document.currency,
      'amountPaid',v_document.amount,
      'paymentMethod',v_payment.method_type,
      'paymentProvider',v_payment.provider,
      'paymentReference',v_payment.provider_reference,
      'paymentConfirmedAt',v_payment.confirmed_at,
      'items',v_items,
      'footer','Payment received · SellerTray · ProcessEdge Solutions Limited'
    );
  end if;

  insert into public.sellertray_print_jobs(
    tenant_id,branch_id,register_id,printer_id,job_type,order_id,financial_document_id,
    request_key,status,transport,printer_name,hardware_identifier,paper_width_mm,
    content_snapshot,requested_by_user_id,requested_at
  ) values(
    p_tenant_id,v_printer.branch_id,v_printer.register_id,v_printer.id,v_job_type,
    case when v_job_type='receipt' then p_order_id else null end,
    case when v_job_type='receipt' then v_document.id else null end,
    v_request_key,'requested',v_printer.transport,v_printer.display_name,
    v_printer.hardware_identifier,v_printer.paper_width_mm,v_snapshot,p_actor_user_id,now()
  ) returning * into v_job;

  return jsonb_build_object(
    'jobId',v_job.id,'status',v_job.status,'jobType',v_job.job_type,
    'printerId',v_job.printer_id,'printerName',v_job.printer_name,
    'transport',v_job.transport,'hardwareIdentifier',v_job.hardware_identifier,
    'paperWidthMm',v_job.paper_width_mm,'contentSnapshot',v_job.content_snapshot,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.request_sellertray_print_job(uuid,uuid,text,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.request_sellertray_print_job(uuid,uuid,text,uuid,text,uuid)
  to service_role;

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

create or replace function public.get_sellertray_receipt_for_order(
  p_tenant_id uuid,
  p_order_id uuid
)
returns table(
  document_id uuid,
  document_reference text,
  amount numeric,
  currency text,
  issued_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_branch_id uuid;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  select o.branch_id into v_branch_id
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if v_branch_id is null then return; end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_branch_id,v_user_id) then
    raise exception 'You do not have access to this receipt' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_print_receipt') then
    raise exception 'You do not have permission to print receipts' using errcode='42501';
  end if;

  return query
  select d.id,d.document_reference,d.amount,d.currency,d.issued_at
  from public.order_financial_documents d
  where d.tenant_id=p_tenant_id
    and d.order_id=p_order_id
    and d.document_type='receipt'
    and d.status='issued'
  limit 1;
end;
$$;

revoke all on function public.get_sellertray_receipt_for_order(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_receipt_for_order(uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_print_job(
  p_tenant_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_job public.sellertray_print_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  select * into v_job
  from public.sellertray_print_jobs j
  where j.tenant_id=p_tenant_id and j.id=p_job_id;
  if not found then return null; end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_job.branch_id,v_user_id) then
    raise exception 'You do not have access to this print job' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_print_receipt')
     and not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then
    raise exception 'You do not have permission to view print jobs' using errcode='42501';
  end if;
  select tm.role into v_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role='staff' and v_job.requested_by_user_id<>v_user_id then
    raise exception 'Staff can view only their own print attempts' using errcode='42501';
  end if;

  return jsonb_build_object(
    'jobId',v_job.id,'status',v_job.status,'jobType',v_job.job_type,
    'orderId',v_job.order_id,'financialDocumentId',v_job.financial_document_id,
    'printerId',v_job.printer_id,'printerName',v_job.printer_name,
    'transport',v_job.transport,'hardwareIdentifier',v_job.hardware_identifier,
    'paperWidthMm',v_job.paper_width_mm,'contentSnapshot',v_job.content_snapshot,
    'requestedAt',v_job.requested_at,'startedAt',v_job.started_at,
    'completedAt',v_job.completed_at,'failedAt',v_job.failed_at,
    'failureCode',v_job.failure_code,'failureMessage',v_job.failure_message
  );
end;
$$;

revoke all on function public.get_sellertray_print_job(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_print_job(uuid,uuid)
  to authenticated;

create or replace function public.guard_sellertray_print_job_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
      return old;
    end if;
    raise exception 'Print history cannot be deleted while this business exists' using errcode='55000';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.branch_id is distinct from old.branch_id
     or new.register_id is distinct from old.register_id
     or new.printer_id is distinct from old.printer_id
     or new.job_type is distinct from old.job_type
     or new.order_id is distinct from old.order_id
     or new.financial_document_id is distinct from old.financial_document_id
     or new.request_key is distinct from old.request_key
     or new.transport is distinct from old.transport
     or new.printer_name is distinct from old.printer_name
     or new.hardware_identifier is distinct from old.hardware_identifier
     or new.paper_width_mm is distinct from old.paper_width_mm
     or new.content_snapshot is distinct from old.content_snapshot
     or new.requested_by_user_id is distinct from old.requested_by_user_id
     or new.requested_at is distinct from old.requested_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Print job source facts are immutable' using errcode='55000';
  end if;

  if old.status in ('printed','failed') then
    raise exception 'Completed print attempt is immutable' using errcode='55000';
  end if;
  if old.status='requested' and new.status not in ('printing','failed') then
    raise exception 'Invalid print job transition' using errcode='55000';
  end if;
  if old.status='printing' and new.status not in ('printed','failed') then
    raise exception 'Invalid print job transition' using errcode='55000';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sellertray_print_job_history()
  from public,anon,authenticated;

create trigger guard_sellertray_print_job_history
before update or delete on public.sellertray_print_jobs
for each row execute function public.guard_sellertray_print_job_history();

create or replace function public.prevent_sellertray_printer_event_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Printer history is immutable while this business exists' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_printer_event_mutation()
  from public,anon,authenticated;

create trigger prevent_sellertray_printer_events_mutation
before update or delete on public.sellertray_printer_events
for each row execute function public.prevent_sellertray_printer_event_mutation();

create or replace function public.prevent_sellertray_printer_delete()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Deactivate printers instead of deleting device history' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_printer_delete()
  from public,anon,authenticated;

create trigger prevent_sellertray_printer_delete
before delete on public.sellertray_printers
for each row execute function public.prevent_sellertray_printer_delete();

commit;