begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(not has_function_privilege('anon','public.platform_admin_bootstrap(uuid)','EXECUTE'),'anonymous callers cannot read Admin bootstrap');
select extensions.ok(not has_function_privilege('authenticated','public.platform_admin_bootstrap(uuid)','EXECUTE'),'merchant JWT cannot choose an Admin bootstrap actor');
select extensions.ok(not has_function_privilege('anon','public.platform_admin_operations_summary(uuid)','EXECUTE'),'anonymous callers cannot read operations summary');
select extensions.ok(not has_function_privilege('authenticated','public.platform_admin_operations_summary(uuid)','EXECUTE'),'merchant JWT cannot choose an operations actor');
select extensions.ok(has_function_privilege('service_role','public.platform_admin_bootstrap(uuid)','EXECUTE'),'service boundary may execute Admin bootstrap');
select extensions.ok(has_function_privilege('service_role','public.platform_admin_operations_summary(uuid)','EXECUTE'),'service boundary may execute operations summary');
select extensions.throws_ok($$select public.platform_admin_bootstrap('00000000-0000-4000-8000-000000000000')$$,'42501','Platform administrator access required','unknown bootstrap actor denied');
select extensions.throws_ok($$select public.platform_admin_operations_summary('00000000-0000-4000-8000-000000000000')$$,'42501','Platform administrator access required','unknown operations actor denied');

create temp table bounded_admin_actor(id uuid);
insert into bounded_admin_actor values(gen_random_uuid());
insert into auth.users(id,email,aud,role) select id,'bounded-admin-'||id||'@example.com','authenticated','authenticated' from bounded_admin_actor;
insert into public.platform_admins(user_id,role) select id,'support' from bounded_admin_actor;
insert into public.tenants(id,name,slug,merchant_code,subscription_status,whatsapp_connection_status)
values(gen_random_uuid(),'Bounded Admin Merchant','bounded-admin-'||left(gen_random_uuid()::text,8),'BA1','trial','connected');

select extensions.lives_ok(format('select public.platform_admin_bootstrap(%L)',id),'Support may read compact bootstrap') from bounded_admin_actor;
select extensions.lives_ok(format('select public.platform_admin_operations_summary(%L)',id),'Support may read aggregate operations') from bounded_admin_actor;
select extensions.is((public.platform_admin_bootstrap(id)->>'merchantCount')::integer,(select count(*)::integer from public.tenants),'bootstrap count matches governed tenant truth') from bounded_admin_actor;
select extensions.ok(
  jsonb_typeof(public.platform_admin_operations_summary(id)->'whatsapp')='object'
  and jsonb_typeof(public.platform_admin_operations_summary(id)->'ai')='object',
  'operations response exposes aggregate WhatsApp and AI objects'
) from bounded_admin_actor;

select * from extensions.finish();
rollback;
