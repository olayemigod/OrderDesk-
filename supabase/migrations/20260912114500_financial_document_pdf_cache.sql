alter table public.order_financial_documents
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_generated_at timestamptz,
  add column if not exists pdf_version integer not null default 1;

alter table public.order_financial_documents
  add constraint order_financial_documents_pdf_version_check
    check (pdf_version >= 1),
  add constraint order_financial_documents_pdf_cache_check
    check (
      (pdf_storage_path is null and pdf_generated_at is null)
      or
      (
        pdf_storage_path is not null
        and pdf_generated_at is not null
        and char_length(pdf_storage_path) between 1 and 500
      )
    );