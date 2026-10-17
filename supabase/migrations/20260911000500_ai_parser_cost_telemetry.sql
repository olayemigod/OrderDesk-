create table if not exists public.ai_parser_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_message_id uuid not null,
  provider text not null default 'openai',
  model text,
  outcome text not null,
  provider_http_status integer,
  input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  total_tokens integer,
  created_at timestamptz not null default now(),
  constraint ai_parser_attempts_provider_check check (provider = 'openai'),
  constraint ai_parser_attempts_outcome_check check (
    outcome in ('success', 'provider_error', 'invalid_output', 'network_error')
  ),
  constraint ai_parser_attempts_http_status_check check (
    provider_http_status is null or (provider_http_status between 100 and 599)
  ),
  constraint ai_parser_attempts_input_tokens_check check (input_tokens is null or input_tokens >= 0),
  constraint ai_parser_attempts_output_tokens_check check (output_tokens is null or output_tokens >= 0),
  constraint ai_parser_attempts_reasoning_tokens_check check (reasoning_tokens is null or reasoning_tokens >= 0),
  constraint ai_parser_attempts_total_tokens_check check (total_tokens is null or total_tokens >= 0),
  constraint ai_parser_attempts_tenant_source_message_fkey
    foreign key (tenant_id, source_message_id)
    references public.inbound_messages(tenant_id, id)
    on delete cascade,
  unique (source_message_id, provider)
);

create index if not exists ai_parser_attempts_tenant_created_idx
  on public.ai_parser_attempts (tenant_id, created_at desc);

alter table public.ai_parser_attempts enable row level security;
revoke all on table public.ai_parser_attempts from public, anon, authenticated;
grant all on table public.ai_parser_attempts to service_role;

drop policy if exists ai_parser_attempts_deny_clients on public.ai_parser_attempts;
create policy ai_parser_attempts_deny_clients
on public.ai_parser_attempts
for all
to anon, authenticated
using (false)
with check (false);
