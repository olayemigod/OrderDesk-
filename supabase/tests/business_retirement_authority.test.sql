begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.has_column('public','tenants','retired_at','Business retirement marker exists');
select extensions.has_column('public','tenants','retirement_reason','Business retirement reason is retained');
select extensions.has_column('public','tenants','retirement_command_id','Business retirement is command-idempotent');
select extensions.has_function('public','retire_sellertray_tenant_admin',array['uuid','uuid','text','uuid'],'governed Platform Admin retirement command exists');
select extensions.ok(has_function_privilege('service_role','public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid)','EXECUTE'),'service boundary can execute retirement');
select extensions.ok(not has_function_privilege('authenticated','public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid)','EXECUTE'),'merchant clients cannot execute Business retirement');
select extensions.ok(position('retired_at is null' in pg_get_functiondef('public.sellertray_list_businesses_for_current_user()'::regprocedure))>0,'merchant Business selector excludes retired Businesses');
select extensions.ok(position('retired_at is not null' in pg_get_functiondef('public.orderdesk_subscription_can_write(uuid)'::regprocedure))>0,'retired Businesses fail the compatibility write gate');
select extensions.ok(position('retired_at is null' in pg_get_functiondef('public.platform_admin_merchant_portfolio(uuid,text,text,text,uuid,integer)'::regprocedure))>0,'Admin merchant portfolio excludes retired Businesses');
select extensions.ok(position('retired_at is null' in pg_get_functiondef('public.platform_admin_business_summary_pre_oa5b(uuid,integer)'::regprocedure))>0,'Business/Revenue summary excludes retired Businesses');
select extensions.ok(position('retired_at is null' in pg_get_functiondef('public.platform_admin_onboarding_commercial_report(uuid,integer)'::regprocedure))>0,'Onboarding report excludes retired Businesses');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.tenants'::regclass and tgname='guard_sellertray_tenant_retirement' and not tgisinternal),'retirement evidence is guarded against mutation');

select * from extensions.finish();
rollback;
