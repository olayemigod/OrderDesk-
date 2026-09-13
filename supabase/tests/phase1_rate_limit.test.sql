begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

create temp table phase1_rate_fixture(rate_key text not null) on commit drop;
insert into phase1_rate_fixture values ('pgtap-'||gen_random_uuid()::text);

select extensions.ok(
  public.consume_sellertray_rate_limit('phase1_ci',(select rate_key from phase1_rate_fixture),2,60),
  'first request is allowed'
);
select extensions.ok(
  public.consume_sellertray_rate_limit('phase1_ci',(select rate_key from phase1_rate_fixture),2,60),
  'second request inside the limit is allowed'
);
select extensions.ok(
  not public.consume_sellertray_rate_limit('phase1_ci',(select rate_key from phase1_rate_fixture),2,60),
  'request above the fixed-window limit is denied'
);
select extensions.ok(
  not public.consume_sellertray_rate_limit('phase1_ci',(select rate_key from phase1_rate_fixture),2,60),
  'additional requests stay denied for the current window'
);

select * from extensions.finish();
rollback;
