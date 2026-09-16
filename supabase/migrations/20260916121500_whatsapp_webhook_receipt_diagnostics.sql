create table if not exists public.whatsapp_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  signature_valid boolean not null,
  phone_number_ids text[] not null default '{}',
  entry_count integer not null default 0,
  change_count integer not null default 0,
  message_count integer not null default 0,
  status_count integer not null default 0,
  routed_tenant_ids uuid[] not null default '{}',
  processing_result text not null default 'received',
  error_code text null,
  constraint whatsapp_webhook_receipts_result_check
    check (processing_result in ('received','accepted','ignored','failed'))
);

alter table public.whatsapp_webhook_receipts enable row level security;
revoke all on public.whatsapp_webhook_receipts from anon, authenticated;

comment on table public.whatsapp_webhook_receipts is
  'Server-only WhatsApp webhook delivery diagnostics. Stores routing/count metadata only; never message content.';
