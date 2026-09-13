create index if not exists ai_parser_attempts_tenant_source_message_idx
  on public.ai_parser_attempts (tenant_id, source_message_id);
