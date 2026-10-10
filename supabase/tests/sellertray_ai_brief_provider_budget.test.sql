begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

select extensions.ok(
  to_regclass('public.sellertray_ai_brief_provider_reservations') is not null,
  'AI Brief provider reservation table exists'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_ai_brief_provider_reservations','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_ai_brief_provider_reservations','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_ai_brief_provider_reservations','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_ai_brief_provider_reservations','DELETE'),
  'browser/mobile sessions cannot read or mutate provider reservations'
);

select extensions.ok(
  has_function_privilege('service_role','public.reserve_sellertray_ai_brief_provider_call(uuid,uuid,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.reserve_sellertray_ai_brief_provider_call(uuid,uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.reserve_sellertray_ai_brief_provider_call(uuid,uuid,integer)','EXECUTE'),
  'only the service boundary can reserve an AI provider call'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='reserve_sellertray_ai_brief_provider_call'
      and lower(pg_get_functiondef(p.oid)) like '%pg_advisory_xact_lock%'
      and lower(pg_get_functiondef(p.oid)) like '%request_already_reserved%'
      and lower(pg_get_functiondef(p.oid)) like '%daily_budget_reached%'
  ),
  'reservation command serializes tenant-day budget checks and handles replay/cap outcomes'
);

insert into public.tenants(id,name,slug,merchant_code)
values('a1000000-0000-4000-8000-000000000001','AI Budget Test','ai-budget-test','AIB');

create temporary table ai_budget_results(
  step text primary key,
  payload jsonb not null
) on commit drop;

insert into ai_budget_results(step,payload)
values(
  'first',
  public.reserve_sellertray_ai_brief_provider_call(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    2
  )
);

insert into ai_budget_results(step,payload)
values(
  'replay',
  public.reserve_sellertray_ai_brief_provider_call(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    2
  )
);

insert into ai_budget_results(step,payload)
values(
  'second',
  public.reserve_sellertray_ai_brief_provider_call(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000002',
    2
  )
);

insert into ai_budget_results(step,payload)
values(
  'over_budget',
  public.reserve_sellertray_ai_brief_provider_call(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000003',
    2
  )
);

select extensions.ok(
  ((select payload from ai_budget_results where step='first')->>'allowed')::boolean
  and not ((select payload from ai_budget_results where step='replay')->>'allowed')::boolean,
  'first request reserves capacity and an exact replay cannot reserve it twice'
);

select extensions.is(
  (select payload->>'reason' from ai_budget_results where step='replay'),
  'request_already_reserved',
  'exact request replay is identified explicitly'
);

select extensions.ok(
  ((select payload from ai_budget_results where step='second')->>'allowed')::boolean,
  'second distinct request can reserve the remaining daily capacity'
);

select extensions.is(
  (select payload->>'reason' from ai_budget_results where step='over_budget'),
  'daily_budget_reached',
  'daily provider cap rejects the next distinct request'
);

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_ai_brief_provider_reservations r
    where r.tenant_id='a1000000-0000-4000-8000-000000000001'
  ),
  2,
  'replays and rejected over-budget requests do not create extra reservations'
);

select extensions.throws_ok(
  $$
    update public.sellertray_ai_brief_provider_reservations
    set reserved_on=reserved_on
    where tenant_id='a1000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'SellerTray AI provider reservations are immutable',
  'provider reservation history cannot be updated directly'
);

select extensions.throws_ok(
  $$
    delete from public.sellertray_ai_brief_provider_reservations
    where tenant_id='a1000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'SellerTray AI provider reservations are immutable',
  'provider reservation history cannot be deleted directly'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='sellertray_ai_brief_provider_reservations'
      and con.contype='f'
      and con.confdeltype='c'
      and pg_get_constraintdef(con.oid) like '%tenant_id%tenants%'
  ),
  'provider reservations follow governed Tenant deletion lifecycle'
);

delete from public.tenants
where id='a1000000-0000-4000-8000-000000000001';

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_ai_brief_provider_reservations r
    where r.tenant_id='a1000000-0000-4000-8000-000000000001'
  ),
  0,
  'governed Tenant deletion removes provider reservation history without weakening ordinary immutability'
);

select * from extensions.finish();
rollback;
