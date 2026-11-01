begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

select extensions.ok(
  not has_function_privilege('anon','public.platform_admin_audit_explorer(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,boolean)','EXECUTE'),
  'anon denied'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.platform_admin_audit_explorer(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,boolean)','EXECUTE'),
  'merchant JWT denied'
);
select extensions.ok(
  has_function_privilege('service_role','public.platform_admin_audit_explorer(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,boolean)','EXECUTE'),
  'service role permitted'
);
select extensions.throws_ok(
  $$select public.platform_admin_audit_explorer(null,p_business=>null)$$,
  '42501','Platform administrator access required','null actor denied'
);

create temp table audit_fixture(actor uuid, active_tenant uuid, retired_tenant uuid);
insert into audit_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email,aud,role)
select actor,'audit-convergence-'||actor||'@example.com','authenticated','authenticated' from audit_fixture;
insert into public.platform_admins(user_id,role) select actor,'support' from audit_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select active_tenant,'Audit Active Fixture','audit-active-'||active_tenant,'AA1','active' from audit_fixture
union all
select retired_tenant,'Audit Retired Fixture','audit-retired-'||retired_tenant,'AR1','active' from audit_fixture;
update public.tenants
set retired_at='2026-10-31T12:00:00Z',
    retirement_reason='Audit explorer retained-history fixture',
    retirement_command_id=gen_random_uuid()
where id=(select retired_tenant from audit_fixture);

insert into public.platform_admin_audit(id,actor_user_id,tenant_id,action,detail,created_at)
select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
       actor,active_tenant,'audit_fixture','{"needle":"literal%_"}',
       '2026-10-01T12:00:00.123456Z'::timestamptz
from audit_fixture cross join generate_series(1,1005) i;
insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail,created_at)
select actor,retired_tenant,'retired_fixture','{"reason":"retained historical evidence"}',
       '2026-10-31T12:00:00Z'::timestamptz
from audit_fixture;

create temp table audit_pages as
select
  public.platform_admin_audit_explorer(actor,p_business=>'Audit Active Fixture') first_page,
  public.platform_admin_audit_explorer(actor,p_business=>'Audit Active Fixture',p_limit=>9999) max_page,
  public.platform_admin_audit_explorer(actor,p_business=>'Audit Active Fixture',p_export=>true,p_limit=>100) export_page
from audit_fixture;

select extensions.is(jsonb_array_length(first_page->'items'),50,'default 50') from audit_pages;
select extensions.is(jsonb_array_length(max_page->'items'),100,'server max 100') from audit_pages;
select extensions.is(jsonb_array_length(export_page->'items'),1000,'server export max 1000') from audit_pages;
select extensions.is(export_page->>'hasMore','true','export truncation disclosed') from audit_pages;
select extensions.is(first_page->'items'->0->>'id','00000000-0000-4000-8000-000000001005','ties ordered by descending id') from audit_pages;

create temp table audit_second as
select public.platform_admin_audit_explorer(
  actor,
  p_business=>'Audit Active Fixture',
  p_after_created_at=>(first_page->'nextCursor'->>'afterCreatedAt')::timestamptz,
  p_after_id=>(first_page->'nextCursor'->>'afterId')::uuid
) page
from audit_fixture cross join audit_pages;
select extensions.is(page->'items'->0->>'id','00000000-0000-4000-8000-000000000955','next page has no tie duplicates or gaps') from audit_second;

select extensions.is(
  jsonb_array_length(public.platform_admin_audit_explorer(actor,p_business=>'Audit Active Fixture')->'items'),50,
  'Business name filter finds active Business'
) from audit_fixture;
select extensions.is(
  jsonb_array_length(public.platform_admin_audit_explorer(actor,p_business=>'Audit Retired Fixture')->'items'),1,
  'Business name filter retains retired Business history'
) from audit_fixture;
select extensions.is(
  jsonb_array_length(public.platform_admin_audit_explorer(actor,p_business=>retired_tenant::text)->'items'),1,
  'Business ID filter retains retired Business history'
) from audit_fixture;
select extensions.is(
  jsonb_array_length(public.platform_admin_audit_explorer(actor,p_business=>'Audit Active Fixture',p_event=>'retired_fixture')->'items'),0,
  'exact event filter'
) from audit_fixture;
select extensions.is(
  jsonb_array_length(public.platform_admin_audit_explorer(actor,p_actor=>'missing@example.com')->'items'),0,
  'actor filter'
) from audit_fixture;
select extensions.is(
  jsonb_array_length(public.platform_admin_audit_explorer(actor,p_business=>'Audit Active Fixture',p_search=>'literal%_')->'items'),50,
  'search treats wildcard characters literally'
) from audit_fixture;
select extensions.is(
  jsonb_array_length(public.platform_admin_audit_explorer(actor,p_business=>'Audit Active Fixture',p_from=>'2026-10-01T12:00:00.123456Z')->'items'),50,
  'From inclusive with microseconds'
) from audit_fixture;
select extensions.is(
  jsonb_array_length(public.platform_admin_audit_explorer(actor,p_business=>'Audit Active Fixture',p_to=>'2026-10-01T12:00:00.123456Z')->'items'),0,
  'To exclusive'
) from audit_fixture;
select extensions.throws_ok(
  format('select public.platform_admin_audit_explorer(%L,p_business=>null,p_after_id=>%L)',actor,active_tenant),
  '22023','Invalid audit filters or cursor','partial cursor denied'
) from audit_fixture;
select extensions.is(
  jsonb_array_length(public.platform_admin_audit_explorer(actor,p_business=>null,p_search=>'no-match')->'items'),0,
  'empty result'
) from audit_fixture;
select extensions.is(
  (select count(*)::integer from public.platform_admin_audit where action='audit_fixture'),1005,
  'reads preserve audit records'
);
select extensions.is(
  (select count(*)::integer from public.platform_admin_audit where action='retired_fixture'),1,
  'retired Business audit evidence remains stored'
);
update public.platform_admins set role='admin' where user_id=(select actor from audit_fixture);
select extensions.lives_ok(
  format('select public.platform_admin_audit_explorer(%L,p_business=>null)',actor),
  'Admin read permitted'
) from audit_fixture;

select * from extensions.finish();
rollback;
