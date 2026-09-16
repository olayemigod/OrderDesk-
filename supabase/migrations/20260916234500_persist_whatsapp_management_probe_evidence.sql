create table if not exists public.whatsapp_management_probe_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null,
  succeeded boolean not null,
  evidence text not null,
  error_message text,
  phone_count integer,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_management_probe_events enable row level security;
revoke all on table public.whatsapp_management_probe_events from public, anon, authenticated;
grant all on table public.whatsapp_management_probe_events to service_role;

create index if not exists whatsapp_management_probe_events_tenant_created_idx
  on public.whatsapp_management_probe_events(tenant_id,created_at desc);
