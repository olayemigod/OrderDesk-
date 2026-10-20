begin;

alter table public.sellertray_printers
  add column if not exists receipt_copy_definitions jsonb not null default '[{"type":"customer","label":"Customer Copy","enabled":true,"sortOrder":1}]'::jsonb,
  add column if not exists merchant_receipt_footer text;
alter table public.sellertray_print_jobs
  add column if not exists receipt_copy_definitions jsonb not null default '[{"type":"customer","label":"Customer Copy","enabled":true,"sortOrder":1}]'::jsonb,
  add column if not exists merchant_receipt_footer text;

alter table public.sellertray_printers
  drop constraint if exists sellertray_printers_receipt_copy_definitions_check,
  add constraint sellertray_printers_receipt_copy_definitions_check check (jsonb_typeof(receipt_copy_definitions)='array' and jsonb_array_length(receipt_copy_definitions) between 1 and 8),
  drop constraint if exists sellertray_printers_merchant_receipt_footer_check,
  add constraint sellertray_printers_merchant_receipt_footer_check check (merchant_receipt_footer is null or char_length(btrim(merchant_receipt_footer)) between 1 and 240);

create or replace function public.save_sellertray_printer_receipt_settings(p_tenant_id uuid,p_printer_id uuid,p_copy_definitions jsonb,p_merchant_footer text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid := (select auth.uid()); v_printer public.sellertray_printers%rowtype; v_before jsonb; v_copy jsonb; v_type text; v_label text;
  v_footer text := nullif(btrim(coalesce(p_merchant_footer,'')),''); v_seen_labels text[] := array[]::text[];
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if p_tenant_id is null or p_printer_id is null or jsonb_typeof(p_copy_definitions)<>'array' or jsonb_array_length(p_copy_definitions) not between 1 and 8 then raise exception 'Add between 1 and 8 receipt copies' using errcode='22023'; end if;
  if v_footer is not null and char_length(v_footer)>240 then raise exception 'Receipt footer is too long' using errcode='22023'; end if;
  select * into v_printer from public.sellertray_printers p where p.tenant_id=p_tenant_id and p.id=p_printer_id for update;
  if not found then raise exception 'Printer not found' using errcode='22023'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_printer.branch_id,v_user_id) or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then raise exception 'You do not have permission to manage this printer' using errcode='42501'; end if;
  v_before := jsonb_build_object('receiptCopyDefinitions',v_printer.receipt_copy_definitions,'merchantReceiptFooter',v_printer.merchant_receipt_footer);
  for v_copy in select value from jsonb_array_elements(p_copy_definitions) loop
    v_type := lower(btrim(coalesce(v_copy->>'type',''))); v_label := btrim(coalesce(v_copy->>'label',''));
    if v_type not in ('customer','store','audit','accounts','dispatch','production','custom') then raise exception 'Choose a valid receipt copy type' using errcode='22023'; end if;
    if char_length(v_label) not between 1 and 40 then raise exception 'Each receipt copy needs a short label' using errcode='22023'; end if;
    if coalesce((v_copy->>'enabled')::boolean,true)=false then raise exception 'Remove disabled copies instead of saving them' using errcode='22023'; end if;
    if lower(v_label)=any(v_seen_labels) then raise exception 'Receipt copy labels must be unique' using errcode='22023'; end if;
    v_seen_labels := array_append(v_seen_labels,lower(v_label));
  end loop;
  update public.sellertray_printers set receipt_copy_definitions=p_copy_definitions,merchant_receipt_footer=v_footer,updated_at=now() where tenant_id=p_tenant_id and id=p_printer_id returning * into v_printer;
  if v_before is distinct from jsonb_build_object('receiptCopyDefinitions',p_copy_definitions,'merchantReceiptFooter',v_footer) then
    insert into public.sellertray_printer_events(tenant_id,printer_id,event_type,actor_user_id,before_state,after_state) values(p_tenant_id,p_printer_id,'updated',v_user_id,v_before,jsonb_build_object('receiptCopyDefinitions',p_copy_definitions,'merchantReceiptFooter',v_footer));
  end if;
  return jsonb_build_object('printerId',p_printer_id,'receiptCopyDefinitions',p_copy_definitions,'merchantReceiptFooter',v_footer);
end; $$;
revoke all on function public.save_sellertray_printer_receipt_settings(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.save_sellertray_printer_receipt_settings(uuid,uuid,jsonb,text) to authenticated;

create or replace function public.get_sellertray_printer_receipt_settings(p_tenant_id uuid,p_printer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user_id uuid := (select auth.uid()); v_printer public.sellertray_printers%rowtype;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  select * into v_printer from public.sellertray_printers p where p.tenant_id=p_tenant_id and p.id=p_printer_id;
  if not found then raise exception 'Printer not found' using errcode='22023'; end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_printer.branch_id,v_user_id) then raise exception 'You do not have access to this printer' using errcode='42501'; end if;
  return jsonb_build_object('printerId',v_printer.id,'receiptCopyDefinitions',v_printer.receipt_copy_definitions,'merchantReceiptFooter',v_printer.merchant_receipt_footer);
end; $$;
revoke all on function public.get_sellertray_printer_receipt_settings(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_printer_receipt_settings(uuid,uuid) to authenticated;

create or replace function public.sellertray_snapshot_printer_receipt_settings()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_printer public.sellertray_printers%rowtype;
begin
  select * into v_printer from public.sellertray_printers p where p.tenant_id=new.tenant_id and p.id=new.printer_id;
  if not found then return new; end if;
  new.receipt_copy_definitions := v_printer.receipt_copy_definitions; new.merchant_receipt_footer := v_printer.merchant_receipt_footer;
  if new.job_type='receipt' then
    -- Keep legacy footer in the snapshot so already-installed Build 28 clients remain compatible.
    new.content_snapshot := new.content_snapshot || jsonb_build_object('copyDefinitions',v_printer.receipt_copy_definitions,'merchantFooter',v_printer.merchant_receipt_footer,'platformAttribution','Powered by SellerTray');
  end if;
  return new;
end; $$;
revoke all on function public.sellertray_snapshot_printer_receipt_settings() from public,anon,authenticated;
grant execute on function public.sellertray_snapshot_printer_receipt_settings() to service_role;
drop trigger if exists sellertray_snapshot_printer_receipt_settings on public.sellertray_print_jobs;
create trigger sellertray_snapshot_printer_receipt_settings before insert on public.sellertray_print_jobs for each row execute function public.sellertray_snapshot_printer_receipt_settings();

commit;
