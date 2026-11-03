-- OA5 narrow inactive purchased-Branch register/printer preparation.
-- No changes to sellertray_user_can_operate_branch or live-selling authority.
begin;
-- Scoped device preparation is NOT a general Branch operating entitlement.
-- Only a verified merchant Owner/Manager with device management capability
-- may prepare an inactive Branch that is part of a purchased setup obligation.
create or replace function public.sellertray_can_prepare_purchased_branch_devices(
  p_tenant_id uuid,p_branch_id uuid,p_user_id uuid
) returns boolean language sql stable security definer set search_path='' as $access$
  select p_tenant_id is not null and p_branch_id is not null and p_user_id is not null
     and public.sellertray_business_is_preparing(p_tenant_id)
     and exists (
       select 1 from public.tenants t where t.id=p_tenant_id and t.retired_at is null
     )
     and exists (
       select 1 from public.tenant_members tm
       where tm.tenant_id=p_tenant_id and tm.user_id=p_user_id
         and tm.role in ('owner','manager')
     )
     and exists (
       select 1 from public.branches b
       join public.sellertray_commercial_order_price_snapshots s
         on s.tenant_id=b.tenant_id and s.branch_id=b.id
       where b.tenant_id=p_tenant_id and b.id=p_branch_id
         and s.line_type='branch_setup'
     )
     and public.sellertray_user_has_capability(p_tenant_id,p_user_id,'can_manage_devices');
$access$;
revoke all on function public.sellertray_can_prepare_purchased_branch_devices(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_can_prepare_purchased_branch_devices(uuid,uuid,uuid)
  to service_role;


-- Exact original function signature and grants preserved: get_sellertray_accessible_registers
CREATE OR REPLACE FUNCTION public.get_sellertray_accessible_registers(p_tenant_id uuid, p_branch_id uuid)
 RETURNS TABLE(id uuid, code text, name text, is_default boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare u uuid:=(select auth.uid()); begin if u is null or not (public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,u) or public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,p_branch_id,u)) then raise exception 'You do not have access to registers in this branch' using errcode='42501'; end if; return query select r.id,r.code,r.name,r.is_default from public.sellertray_registers r where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.is_active order by r.is_default desc,r.name; end; $function$;

-- Exact original function signature and grants preserved: get_sellertray_device_management_overview
CREATE OR REPLACE FUNCTION public.get_sellertray_device_management_overview(p_tenant_id uuid, p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not (public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id)
    or public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,p_branch_id,v_user_id)) then
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
$function$;

-- Exact original function signature and grants preserved: get_sellertray_printers
CREATE OR REPLACE FUNCTION public.get_sellertray_printers(p_tenant_id uuid, p_branch_id uuid, p_register_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, register_id uuid, register_name text, display_name text, transport text, hardware_identifier text, paper_width_mm integer, is_default boolean, is_active boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user_id uuid:=(select auth.uid()); v_manage boolean;
begin
 if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
 if not (public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) or public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,p_branch_id,v_user_id)) then raise exception 'You do not have access to printers in this branch' using errcode='42501'; end if;
 if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_print_receipt') and not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then raise exception 'You do not have permission to use printers' using errcode='42501'; end if;
 v_manage:=public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices');
 return query select p.id,p.register_id,r.name,p.display_name,p.transport,p.hardware_identifier,p.paper_width_mm,p.is_default,p.is_active from public.sellertray_printers p join public.sellertray_registers r on r.tenant_id=p.tenant_id and r.id=p.register_id where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and (p_register_id is null or p.register_id=p_register_id) and (p.is_active=true or v_manage) order by p.is_active desc,p.is_default desc,p.display_name,p.id;
end; $function$;

-- Exact original function signature and grants preserved: get_sellertray_printing_capabilities
CREATE OR REPLACE FUNCTION public.get_sellertray_printing_capabilities(p_tenant_id uuid, p_branch_id uuid)
 RETURNS TABLE(can_print_receipt boolean, can_manage_devices boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user_id uuid:=(select auth.uid()); v_branch_allowed boolean; begin
 if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
 v_branch_allowed:=public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id)
   or public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,p_branch_id,v_user_id);
 return query select v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_print_receipt'),v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices');
end; $function$;

-- Exact original function signature and grants preserved: request_sellertray_print_job
CREATE OR REPLACE FUNCTION public.request_sellertray_print_job(p_tenant_id uuid, p_printer_id uuid, p_job_type text, p_order_id uuid, p_request_key text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_printer public.sellertray_printers%rowtype; v_job public.sellertray_print_jobs%rowtype; v_job_type text:=lower(btrim(coalesce(p_job_type,''))); v_request_key text:=nullif(btrim(coalesce(p_request_key,'')),''); v_document public.order_financial_documents%rowtype; v_order public.orders%rowtype; v_branch_name text; v_register_name text; v_customer_name text; v_customer_phone text; v_payment public.order_payments%rowtype; v_items jsonb:='[]'::jsonb; v_snapshot jsonb;
begin
 if p_tenant_id is null or p_printer_id is null or p_actor_user_id is null or v_job_type not in ('receipt','test') or v_request_key is null or char_length(v_request_key)>128 then raise exception 'Business, printer, print type and request key are required' using errcode='22023'; end if;
 if v_job_type='receipt' and p_order_id is null then raise exception 'Receipt printing requires an order' using errcode='22023'; end if;
 if v_job_type='test' and p_order_id is not null then raise exception 'Test print cannot reference a business order' using errcode='22023'; end if;
 select * into v_printer from public.sellertray_printers p where p.tenant_id=p_tenant_id and p.id=p_printer_id for share;
 if not found or not v_printer.is_active then raise exception 'Selected printer is unavailable' using errcode='23514'; end if;
 if not (public.sellertray_user_can_operate_branch(p_tenant_id,v_printer.branch_id,p_actor_user_id)
   or (v_job_type='test' and public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,v_printer.branch_id,p_actor_user_id))) then raise exception 'You do not have access to print in this branch' using errcode='42501'; end if;
 if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_print_receipt') then raise exception 'You do not have permission to print receipts' using errcode='42501'; end if;
 select * into v_job from public.sellertray_print_jobs j where j.tenant_id=p_tenant_id and j.request_key=v_request_key limit 1;
 if found then
  if v_job.printer_id<>p_printer_id or v_job.job_type<>v_job_type or v_job.order_id is distinct from p_order_id then raise exception 'This print request key is already used for different facts' using errcode='23505'; end if;
  return jsonb_build_object('jobId',v_job.id,'status',v_job.status,'jobType',v_job.job_type,'printerId',v_job.printer_id,'printerName',v_job.printer_name,'transport',v_job.transport,'hardwareIdentifier',v_job.hardware_identifier,'paperWidthMm',v_job.paper_width_mm,'contentSnapshot',v_job.content_snapshot,'idempotentReplay',true);
 end if;
 select b.name into v_branch_name from public.branches b where b.tenant_id=p_tenant_id and b.id=v_printer.branch_id;
 select r.name into v_register_name from public.sellertray_registers r where r.tenant_id=p_tenant_id and r.id=v_printer.register_id;
 if v_job_type='test' then
  v_snapshot:=jsonb_build_object('formatVersion',1,'documentType','test','title','SellerTray printer test','businessName',(select t.name from public.tenants t where t.id=p_tenant_id),'branchName',v_branch_name,'registerName',v_register_name,'printerName',v_printer.display_name,'paperWidthMm',v_printer.paper_width_mm,'requestedAt',now(),'footer','SellerTray · ProcessEdge Solutions Limited');
 else
  select * into v_order from public.orders o where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if not found then raise exception 'Order not found' using errcode='22023'; end if;
  if v_order.branch_id<>v_printer.branch_id then raise exception 'Receipt order and printer must belong to the same branch' using errcode='23514'; end if;
  select * into v_document from public.order_financial_documents d where d.tenant_id=p_tenant_id and d.order_id=p_order_id and d.document_type='receipt' and d.status='issued';
  if not found then raise exception 'This order does not have an issued payment receipt' using errcode='23514'; end if;
  select * into v_payment from public.order_payments p where p.tenant_id=p_tenant_id and p.order_id=p_order_id and p.id=v_document.payment_id and p.status='confirmed';
  if not found then raise exception 'Receipt payment evidence is unavailable' using errcode='23514'; end if;
  select coalesce(c.display_name,c.phone,c.wa_id,'Walk-in Customer'),coalesce(c.phone,c.wa_id) into v_customer_name,v_customer_phone from public.customers c where c.tenant_id=p_tenant_id and c.id=v_order.customer_id;
  if v_customer_name is null then v_customer_name:='Walk-in Customer'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',oi.item_name,'quantity',oi.quantity,'uom',coalesce(oi.selected_uom,'Each'),'unitPrice',oi.unit_price,'lineTotal',oi.line_total) order by oi.created_at,oi.id),'[]'::jsonb) into v_items from public.order_items oi where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;
  v_snapshot:=jsonb_build_object('formatVersion',1,'documentType','receipt','businessName',(select t.name from public.tenants t where t.id=p_tenant_id),'businessEmail',(select t.business_email from public.tenants t where t.id=p_tenant_id),'businessPhone',(select t.business_phone from public.tenants t where t.id=p_tenant_id),'branchName',v_branch_name,'registerName',v_register_name,'orderReference',v_order.public_order_id,'receiptReference',v_document.document_reference,'issuedAt',v_document.issued_at,'customerName',v_customer_name,'customerPhone',v_customer_phone,'currency',v_document.currency,'amountPaid',v_document.amount,'paymentMethod',v_payment.method_type,'paymentProvider',v_payment.provider,'paymentReference',v_payment.provider_reference,'paymentConfirmedAt',v_payment.confirmed_at,'items',v_items,'footer','Payment received · SellerTray · ProcessEdge Solutions Limited');
 end if;
 insert into public.sellertray_print_jobs(tenant_id,branch_id,register_id,printer_id,job_type,order_id,financial_document_id,request_key,status,transport,printer_name,hardware_identifier,paper_width_mm,content_snapshot,requested_by_user_id,requested_at) values(p_tenant_id,v_printer.branch_id,v_printer.register_id,v_printer.id,v_job_type,case when v_job_type='receipt' then p_order_id else null end,case when v_job_type='receipt' then v_document.id else null end,v_request_key,'requested',v_printer.transport,v_printer.display_name,v_printer.hardware_identifier,v_printer.paper_width_mm,v_snapshot,p_actor_user_id,now()) returning * into v_job;
 return jsonb_build_object('jobId',v_job.id,'status',v_job.status,'jobType',v_job.job_type,'printerId',v_job.printer_id,'printerName',v_job.printer_name,'transport',v_job.transport,'hardwareIdentifier',v_job.hardware_identifier,'paperWidthMm',v_job.paper_width_mm,'contentSnapshot',v_job.content_snapshot,'idempotentReplay',false);
end; $function$;

-- Exact original function signature and grants preserved: transition_sellertray_print_job
CREATE OR REPLACE FUNCTION public.transition_sellertray_print_job(p_tenant_id uuid, p_job_id uuid, p_status text, p_failure_code text, p_failure_message text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if not (public.sellertray_user_can_operate_branch(p_tenant_id,v_job.branch_id,p_actor_user_id)
   or (v_job.job_type='test' and public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,v_job.branch_id,p_actor_user_id))) then
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
$function$;

-- Exact original function signature and grants preserved: save_sellertray_register
CREATE OR REPLACE FUNCTION public.save_sellertray_register(p_tenant_id uuid, p_register_id uuid, p_branch_id uuid, p_code text, p_name text, p_is_default boolean, p_is_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not public.orderdesk_subscription_can_write(p_tenant_id)
    and not (
      public.sellertray_business_is_preparing(p_tenant_id)
      and exists (
        select 1 from public.tenants t
        where t.id=p_tenant_id and t.retired_at is null
      )
    ) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not (public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id)
    or public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,p_branch_id,v_user_id)) then
    raise exception 'You do not have access to manage devices in this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then
    raise exception 'You do not have permission to manage devices' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.branches b
    where b.tenant_id=p_tenant_id and b.id=p_branch_id
      and (b.is_active=true or public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,p_branch_id,v_user_id))
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
$function$;

-- Exact original function signature and grants preserved: save_sellertray_printer
CREATE OR REPLACE FUNCTION public.save_sellertray_printer(p_tenant_id uuid, p_printer_id uuid, p_branch_id uuid, p_register_id uuid, p_display_name text, p_hardware_identifier text, p_paper_width_mm integer, p_is_default boolean, p_is_active boolean, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_printer public.sellertray_printers%rowtype; v_before jsonb; v_after jsonb; v_display_name text:=nullif(btrim(coalesce(p_display_name,'')),''); v_hardware_identifier text:=nullif(btrim(coalesce(p_hardware_identifier,'')),''); v_event_type text; v_other record;
begin
 if p_tenant_id is null or p_branch_id is null or p_register_id is null or p_actor_user_id is null or v_display_name is null or v_hardware_identifier is null or p_paper_width_mm not in (58,80) or p_is_default is null or p_is_active is null then raise exception 'Business, branch, register, printer identity and paper width are required' using errcode='22023'; end if;
 if char_length(v_display_name)>120 or char_length(v_hardware_identifier)>160 then raise exception 'Printer details are too long' using errcode='22023'; end if;
 if not public.orderdesk_subscription_can_write(p_tenant_id)
    and not (
      public.sellertray_business_is_preparing(p_tenant_id)
      and exists (
        select 1 from public.tenants t
        where t.id=p_tenant_id and t.retired_at is null
      )
    ) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
 if not (public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,p_actor_user_id)
    or public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,p_branch_id,p_actor_user_id)) then raise exception 'You do not have access to manage devices in this branch' using errcode='42501'; end if;
 if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_manage_devices') then raise exception 'You do not have permission to manage printers' using errcode='42501'; end if;
 if not exists(select 1 from public.sellertray_registers r where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.id=p_register_id and r.is_active=true) then raise exception 'Selected register is unavailable for this branch' using errcode='23514'; end if;
 if p_printer_id is null then
  insert into public.sellertray_printers(tenant_id,branch_id,register_id,display_name,transport,hardware_identifier,paper_width_mm,is_default,is_active,created_by_user_id) values(p_tenant_id,p_branch_id,p_register_id,v_display_name,'bluetooth',v_hardware_identifier,p_paper_width_mm,false,p_is_active,p_actor_user_id) returning * into v_printer;
  v_event_type:='registered'; v_before:=null;
 else
  select * into v_printer from public.sellertray_printers p where p.tenant_id=p_tenant_id and p.id=p_printer_id for update;
  if not found then raise exception 'Printer not found' using errcode='22023'; end if;
  if v_printer.branch_id<>p_branch_id or v_printer.register_id<>p_register_id then raise exception 'Printer branch and register cannot be changed after registration' using errcode='23514'; end if;
  v_before:=public.sellertray_printer_state(v_printer);
  update public.sellertray_printers set display_name=v_display_name,hardware_identifier=v_hardware_identifier,paper_width_mm=p_paper_width_mm,is_active=p_is_active,is_default=case when p_is_active then is_default else false end,updated_at=now() where tenant_id=p_tenant_id and id=p_printer_id returning * into v_printer;
  v_event_type:='updated';
 end if;
 if p_is_default and p_is_active then
  for v_other in select p.* from public.sellertray_printers p where p.tenant_id=p_tenant_id and p.register_id=p_register_id and p.id<>v_printer.id and p.is_default=true for update loop
   insert into public.sellertray_printer_events(tenant_id,printer_id,event_type,actor_user_id,before_state,after_state) values(p_tenant_id,v_other.id,'default_removed',p_actor_user_id,public.sellertray_printer_state(v_other),jsonb_set(public.sellertray_printer_state(v_other),'{isDefault}','false'::jsonb));
  end loop;
  update public.sellertray_printers set is_default=false,updated_at=now() where tenant_id=p_tenant_id and register_id=p_register_id and id<>v_printer.id and is_default=true;
  update public.sellertray_printers set is_default=true,updated_at=now() where tenant_id=p_tenant_id and id=v_printer.id returning * into v_printer;
 else
  update public.sellertray_printers set is_default=false,updated_at=now() where tenant_id=p_tenant_id and id=v_printer.id returning * into v_printer;
 end if;
 v_after:=public.sellertray_printer_state(v_printer);
 if v_before is null or v_before is distinct from v_after then insert into public.sellertray_printer_events(tenant_id,printer_id,event_type,actor_user_id,before_state,after_state) values(p_tenant_id,v_printer.id,v_event_type,p_actor_user_id,v_before,v_after); end if;
 return v_after;
end; $function$;

-- Exact original function signature and grants preserved: save_sellertray_printer_receipt_settings
CREATE OR REPLACE FUNCTION public.save_sellertray_printer_receipt_settings(p_tenant_id uuid, p_printer_id uuid, p_copy_definitions jsonb, p_merchant_footer text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_user_id uuid := (select auth.uid()); v_printer public.sellertray_printers%rowtype; v_before jsonb; v_copy jsonb; v_type text; v_label text; v_footer text := nullif(btrim(coalesce(p_merchant_footer,'')),''); v_seen_labels text[] := array[]::text[]; begin if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if; if p_tenant_id is null or p_printer_id is null or jsonb_typeof(p_copy_definitions)<>'array' or jsonb_array_length(p_copy_definitions) not between 1 and 8 then raise exception 'Add between 1 and 8 receipt copies' using errcode='22023'; end if; if v_footer is not null and char_length(v_footer)>240 then raise exception 'Receipt footer is too long' using errcode='22023'; end if; select * into v_printer from public.sellertray_printers p where p.tenant_id=p_tenant_id and p.id=p_printer_id for update; if not found then raise exception 'Printer not found' using errcode='22023'; end if; if not public.orderdesk_subscription_can_write(p_tenant_id)
    and not (
      public.sellertray_business_is_preparing(p_tenant_id)
      and exists (
        select 1 from public.tenants t
        where t.id=p_tenant_id and t.retired_at is null
      )
    ) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if; if not (public.sellertray_user_can_operate_branch(p_tenant_id,v_printer.branch_id,v_user_id)
   or public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,v_printer.branch_id,v_user_id)) or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then raise exception 'You do not have permission to manage this printer' using errcode='42501'; end if; v_before := jsonb_build_object('receiptCopyDefinitions',v_printer.receipt_copy_definitions,'merchantReceiptFooter',v_printer.merchant_receipt_footer); for v_copy in select value from jsonb_array_elements(p_copy_definitions) loop v_type := lower(btrim(coalesce(v_copy->>'type',''))); v_label := btrim(coalesce(v_copy->>'label','')); if v_type not in ('customer','store','audit','accounts','dispatch','production','custom') then raise exception 'Choose a valid receipt copy type' using errcode='22023'; end if; if char_length(v_label) not between 1 and 40 then raise exception 'Each receipt copy needs a short label' using errcode='22023'; end if; if coalesce((v_copy->>'enabled')::boolean,true)=false then raise exception 'Remove disabled copies instead of saving them' using errcode='22023'; end if; if lower(v_label)=any(v_seen_labels) then raise exception 'Receipt copy labels must be unique' using errcode='22023'; end if; v_seen_labels := array_append(v_seen_labels,lower(v_label)); end loop; update public.sellertray_printers set receipt_copy_definitions=p_copy_definitions,merchant_receipt_footer=v_footer,updated_at=now() where tenant_id=p_tenant_id and id=p_printer_id returning * into v_printer; if v_before is distinct from jsonb_build_object('receiptCopyDefinitions',p_copy_definitions,'merchantReceiptFooter',v_footer) then insert into public.sellertray_printer_events(tenant_id,printer_id,event_type,actor_user_id,before_state,after_state) values(p_tenant_id,p_printer_id,'updated',v_user_id,v_before,jsonb_build_object('receiptCopyDefinitions',p_copy_definitions,'merchantReceiptFooter',v_footer)); end if; return jsonb_build_object('printerId',p_printer_id,'receiptCopyDefinitions',p_copy_definitions,'merchantReceiptFooter',v_footer); end; $function$;

commit;
