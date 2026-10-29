begin;

alter table public.sellertray_print_jobs
  drop constraint if exists sellertray_print_jobs_printer_same_register,
  add constraint sellertray_print_jobs_printer_same_register
    foreign key (tenant_id,branch_id,register_id,printer_id)
    references public.sellertray_printers(tenant_id,branch_id,register_id,id)
    on delete cascade,
  drop constraint if exists sellertray_print_jobs_order_same_tenant,
  add constraint sellertray_print_jobs_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete cascade,
  drop constraint if exists sellertray_print_jobs_document_same_order,
  add constraint sellertray_print_jobs_document_same_order
    foreign key (tenant_id,order_id,financial_document_id)
    references public.order_financial_documents(tenant_id,order_id,id)
    on delete cascade;

commit;