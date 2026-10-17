-- SellerTray Build 7 P0 follow-up: cover Payment Core foreign keys found by DB advisor.
create index order_financial_documents_payment_idx
  on public.order_financial_documents(tenant_id, order_id, payment_id);

create index order_payments_invoice_idx
  on public.order_payments(tenant_id, order_id, invoice_document_id);

create index order_payments_confirmed_by_user_idx
  on public.order_payments(confirmed_by_user_id);