alter table public.ai_parser_attempts
  drop constraint if exists ai_parser_attempts_cached_within_input_check,
  add constraint ai_parser_attempts_cached_within_input_check
    check (
      cached_input_tokens is null
      or input_tokens is null
      or cached_input_tokens <= input_tokens
    ),
  drop constraint if exists ai_parser_attempts_reasoning_within_output_check,
  add constraint ai_parser_attempts_reasoning_within_output_check
    check (
      reasoning_tokens is null
      or output_tokens is null
      or reasoning_tokens <= output_tokens
    );
