begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

select extensions.ok(not has_function_privilege('anon','public.platform_admin_merchant_portfolio(uuid,text,text,text,uuid,integer)','EXECUTE'),'anonymous callers cannot list merchants');
select extensions.ok(not has_function_privilege('authenticated','public.platform_admin_merchant_portfolio(uuid,text,text,text,uuid,integer)','EXECUTE'),'merchant JWT cannot choose an administrator actor');
select extensions.ok(not has_function_privilege('authenticated','public.platform_admin_merchant_detail(uuid,uuid)','EXECUTE'),'merchant JWT cannot read Merchant 360');
select extensions.throws_ok($$select public.platform_admin_merchant_portfolio('00000000-0000-4000-8000-000000000000')$$,'42501','Platform administrator access required','unknown actor denied');
select extensions.throws_ok($$select public.platform_admin_merchant_detail(null,'00000000-0000-4000-8000-000000000000')$$,'42501','Platform administrator access required','null actor denied');

create temp table merchant_portfolio_actor(id uuid);
insert into merchant_portfolio_actor values(gen_random_uuid());
insert into auth.users(id,email,aud,role) select id,'merchant-portfolio-'||id||'@example.com','authenticated','authenticated' from merchant_portfolio_actor;
insert into public.platform_admins(user_id,role) select id,'support' from merchant_portfolio_actor;
create temp table merchant_portfolio_tenant(id uuid);
insert into merchant_portfolio_tenant values(gen_random_uuid());
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select id,'Portfolio Test Merchant','portfolio-test-'||left(id::text,8),'PM1','active' from merchant_portfolio_tenant;

select extensions.lives_ok(format('select public.platform_admin_merchant_portfolio(%L)',id),'Support may read merchant portfolio') from merchant_portfolio_actor;
select extensions.throws_ok(format('select public.platform_admin_merchant_portfolio(%L,null,%L)',id,'unsupported'),'22023','Unsupported merchant filter','unknown filter rejected') from merchant_portfolio_actor;
select extensions.throws_ok(format('select public.platform_admin_merchant_portfolio(%L,null,%L,%L,null)',id,'all','Cursor'),'22023','Merchant cursor is incomplete','incomplete cursor rejected') from merchant_portfolio_actor;
select extensions.ok(jsonb_array_length(public.platform_admin_merchant_portfolio(id,null,'all',null,null,50)->'items')<=50,'portfolio page is bounded') from merchant_portfolio_actor;
select extensions.is((public.platform_admin_merchant_portfolio(id,null,'all',null,null,25)->>'pageSize')::integer,25,'portfolio reports the applied page size') from merchant_portfolio_actor;
select extensions.ok(jsonb_typeof(public.platform_admin_merchant_portfolio(id,null,'attention')->'items')='array','attention filter returns a governed array') from merchant_portfolio_actor;
select extensions.lives_ok(format('select public.platform_admin_merchant_detail(%L,%L)',a.id,t.id),'Support may read Merchant 360') from merchant_portfolio_actor a cross join merchant_portfolio_tenant t;
select extensions.throws_ok(format('select public.platform_admin_merchant_detail(%L,%L)',id,'00000000-0000-4000-8000-000000000000'),'P0002','Merchant not found','missing merchant rejected') from merchant_portfolio_actor;

select * from extensions.finish();
rollback;
