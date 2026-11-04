-- OA5: extend only device setup evidence reads on purchased inactive Branches.
-- Real sale receipts remain under original operating-Branch authority.
begin;

CREATE OR REPLACE FUNCTION public.get_sellertray_print_job(p_tenant_id uuid, p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user_id uuid:=(select auth.uid()); v_role text; v_job public.sellertray_print_jobs%rowtype; begin
 if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
 select * into v_job from public.sellertray_print_jobs j where j.tenant_id=p_tenant_id and j.id=p_job_id;
 if not found then return null; end if;
 if not (public.sellertray_user_can_operate_branch(p_tenant_id,v_job.branch_id,v_user_id)
  or (v_job.job_type='test' and public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,v_job.branch_id,v_user_id))) then raise exception 'You do not have access to this print job' using errcode='42501'; end if;
 if not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_print_receipt') and not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_devices') then raise exception 'You do not have permission to view print jobs' using errcode='42501'; end if;
 select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
 if v_role='staff' and v_job.requested_by_user_id<>v_user_id then raise exception 'Staff can view only their own print attempts' using errcode='42501'; end if;
 return jsonb_build_object('jobId',v_job.id,'status',v_job.status,'jobType',v_job.job_type,'orderId',v_job.order_id,'financialDocumentId',v_job.financial_document_id,'printerId',v_job.printer_id,'printerName',v_job.printer_name,'transport',v_job.transport,'hardwareIdentifier',v_job.hardware_identifier,'paperWidthMm',v_job.paper_width_mm,'contentSnapshot',v_job.content_snapshot,'requestedAt',v_job.requested_at,'startedAt',v_job.started_at,'completedAt',v_job.completed_at,'failedAt',v_job.failed_at,'failureCode',v_job.failure_code,'failureMessage',v_job.failure_message);
end; $function$;

CREATE OR REPLACE FUNCTION public.get_sellertray_printer_receipt_settings(p_tenant_id uuid, p_printer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_user_id uuid := (select auth.uid()); v_printer public.sellertray_printers%rowtype; begin if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if; select * into v_printer from public.sellertray_printers p where p.tenant_id=p_tenant_id and p.id=p_printer_id; if not found then raise exception 'Printer not found' using errcode='22023'; end if; if not (public.sellertray_user_can_operate_branch(p_tenant_id,v_printer.branch_id,v_user_id)
  or public.sellertray_can_prepare_purchased_branch_devices(p_tenant_id,v_printer.branch_id,v_user_id)) then raise exception 'You do not have access to this printer' using errcode='42501'; end if; return jsonb_build_object('printerId',v_printer.id,'receiptCopyDefinitions',v_printer.receipt_copy_definitions,'merchantReceiptFooter',v_printer.merchant_receipt_footer); end; $function$;

commit;
