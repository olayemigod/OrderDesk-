begin;
select plan(8);

select ok(
  to_regprocedure('public.sellertray_ai_insight_context(uuid,integer)') is not null,
  'governed AI context reader exists'
);
select ok(
  not has_function_privilege('anon', 'public.sellertray_ai_insight_context(uuid,integer)', 'EXECUTE'),
  'anonymous clients cannot read merchant AI context'
);
select ok(
  has_function_privilege('authenticated', 'public.sellertray_ai_insight_context(uuid,integer)', 'EXECUTE'),
  'authenticated callers can reach the governed AI context boundary'
);
select ok(
  to_regclass('public.sellertray_ai_insight_attempts') is not null,
  'AI telemetry table exists'
);
select ok(
  not has_table_privilege('anon', 'public.sellertray_ai_insight_attempts', 'SELECT'),
  'anonymous clients cannot read AI telemetry'
);
select ok(
  not has_table_privilege('authenticated', 'public.sellertray_ai_insight_attempts', 'SELECT'),
  'merchant clients cannot read server AI telemetry directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_sellertray_ai_insight_attempt(uuid,uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)', 'EXECUTE'),
  'authenticated clients cannot forge AI telemetry'
);
select ok(
  has_function_privilege('service_role', 'public.record_sellertray_ai_insight_attempt(uuid,uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer)', 'EXECUTE'),
  'server runtime can record governed AI telemetry'
);

select * from finish();
rollback;
