-- OA5 pre-C2 preparation and Merchant acceptance history convergence.
-- Preserve the full existing signature, SECURITY DEFINER, permission and audit
-- boundaries. Scope only non-transactional setup configuration to preparing,
-- non-retired Businesses. Live POS, payment and stock guards are unchanged.
-- The global immutable legal version history stays intact; the response now
-- exposes exact-Business acceptance identifiers for context-specific display.
begin;

-- A historical production QA/version quarantine authority existed outside the
-- clean-history migration ledger. Converge it without modifying quarantined
-- version rows or rewriting Master acceptance evidence.
create table if not exists public.sellertray_master_agreement_version_quarantines (
  id uuid primary key default gen_random_uuid(),
  agreement_version_id uuid not null
    constraint sellertray_master_agreement_version_qu_agreement_version_id_key unique
    references public.sellertray_master_agreement_versions(id) on delete restrict,
  reason text not null
    constraint sellertray_master_agreement_quarantine_reason_check
    check (char_length(btrim(reason)) between 6 and 1000 and reason=btrim(reason)),
  quarantined_by_user_id uuid not null
    references auth.users(id) on delete restrict,
  quarantined_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.sellertray_master_agreement_version_quarantines enable row level security;
revoke all on public.sellertray_master_agreement_version_quarantines from public,anon,authenticated;
grant all on public.sellertray_master_agreement_version_quarantines to service_role;
create index if not exists sellertray_master_agreement_quarantine_actor_idx
  on public.sellertray_master_agreement_version_quarantines
  (quarantined_by_user_id,quarantined_at desc);

do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='sellertray_master_agreement_version_quarantines')<>6
    or not exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='sellertray_master_agreement_version_quarantines'
      and column_name='agreement_version_id' and data_type='uuid' and is_nullable='NO')
    or not exists (select 1 from pg_constraint where conrelid='public.sellertray_master_agreement_version_quarantines'::regclass
      and contype='u' and pg_get_constraintdef(oid)='UNIQUE (agreement_version_id)')
  then
    raise exception 'Master Agreement quarantine schema diverges from governed version history';
  end if;
  if not exists (select 1 from pg_trigger
    where tgrelid='public.sellertray_master_agreement_version_quarantines'::regclass
    and tgname='prevent_sellertray_master_agreement_quarantine_mutation') then
    create trigger prevent_sellertray_master_agreement_quarantine_mutation
      before update or delete on public.sellertray_master_agreement_version_quarantines
      for each row execute function public.prevent_sellertray_commercial_history_mutation();
  end if;
end $$;

-- Forward-only convergence: get_sellertray_master_agreement_admin
CREATE OR REPLACE FUNCTION public.get_sellertray_master_agreement_admin(p_actor_user_id uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text;
  v_versions jsonb;
  v_tenant_state jsonb:=null;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  if p_tenant_id is not null then
    v_tenant_state:=public.get_sellertray_master_agreement_state(p_tenant_id,now());
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',v.id,
    'versionCode',v.version_code,
    'title',v.title,
    'contentBody',v.content_body,
    'contentSha256',v.content_sha256,
    'effectiveFrom',v.effective_from,
    'publishedAt',v.published_at,
    'publishedByUserId',v.published_by_user_id,
    'publishReason',v.publish_reason,
    'quarantined',q.id is not null,
    'quarantineReason',q.reason,
    'quarantinedAt',q.quarantined_at,
    'quarantinedByUserId',q.quarantined_by_user_id,
    'sourceDocument',case when s.id is null then null else jsonb_build_object(
      'filename',s.original_filename,
      'pdfSha256',s.pdf_sha256,
      'byteSize',s.byte_size,
      'pageCount',s.page_count
    ) end
  ) order by v.effective_from desc,v.published_at desc),'[]'::jsonb)
  into v_versions
  from public.sellertray_master_agreement_versions v
  left join public.sellertray_master_agreement_version_quarantines q
    on q.agreement_version_id=v.id
  left join public.sellertray_master_agreement_source_documents s
    on s.agreement_version_id=v.id;

  return jsonb_build_object(
    'actorRole',v_role,
    'canPublish',public.platform_admin_has_capability(
      p_actor_user_id,'admin.agreements.publish',null,now()
    ),
    'versions',v_versions,
    -- Only the exact Merchant's acceptance evidence may populate Merchant
    -- history. The global published history remains unchanged for publication.
    'acceptedVersionIds',case when p_tenant_id is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(a.agreement_version_id),'[]'::jsonb)
      from public.sellertray_master_agreement_acceptances a
      where a.tenant_id=p_tenant_id
    ) end,
    'tenantState',v_tenant_state,
    'generatedAt',now()
  );
end;
$function$;

-- Forward-only convergence: save_sellertray_printer
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
 if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,p_actor_user_id) then raise exception 'You do not have access to manage devices in this branch' using errcode='42501'; end if;
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

-- Forward-only convergence: save_sellertray_printer_receipt_settings
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
    ) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if; if not public.sellertray_user_can_operate_branch(p_tenant_id,v_printer.branch_id,v_user_id) or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then raise exception 'You do not have permission to manage this printer' using errcode='42501'; end if; v_before := jsonb_build_object('receiptCopyDefinitions',v_printer.receipt_copy_definitions,'merchantReceiptFooter',v_printer.merchant_receipt_footer); for v_copy in select value from jsonb_array_elements(p_copy_definitions) loop v_type := lower(btrim(coalesce(v_copy->>'type',''))); v_label := btrim(coalesce(v_copy->>'label','')); if v_type not in ('customer','store','audit','accounts','dispatch','production','custom') then raise exception 'Choose a valid receipt copy type' using errcode='22023'; end if; if char_length(v_label) not between 1 and 40 then raise exception 'Each receipt copy needs a short label' using errcode='22023'; end if; if coalesce((v_copy->>'enabled')::boolean,true)=false then raise exception 'Remove disabled copies instead of saving them' using errcode='22023'; end if; if lower(v_label)=any(v_seen_labels) then raise exception 'Receipt copy labels must be unique' using errcode='22023'; end if; v_seen_labels := array_append(v_seen_labels,lower(v_label)); end loop; update public.sellertray_printers set receipt_copy_definitions=p_copy_definitions,merchant_receipt_footer=v_footer,updated_at=now() where tenant_id=p_tenant_id and id=p_printer_id returning * into v_printer; if v_before is distinct from jsonb_build_object('receiptCopyDefinitions',p_copy_definitions,'merchantReceiptFooter',v_footer) then insert into public.sellertray_printer_events(tenant_id,printer_id,event_type,actor_user_id,before_state,after_state) values(p_tenant_id,p_printer_id,'updated',v_user_id,v_before,jsonb_build_object('receiptCopyDefinitions',p_copy_definitions,'merchantReceiptFooter',v_footer)); end if; return jsonb_build_object('printerId',p_printer_id,'receiptCopyDefinitions',p_copy_definitions,'merchantReceiptFooter',v_footer); end; $function$;

-- Forward-only convergence: save_sellertray_register
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
$function$;

commit;
