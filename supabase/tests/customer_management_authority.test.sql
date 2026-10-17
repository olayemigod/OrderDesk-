begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

select extensions.ok((select relrowsecurity from pg_class where oid='public.customers'::regclass),'customers keeps RLS enabled');
select extensions.ok(not has_table_privilege('authenticated','public.customers','INSERT'),'authenticated clients cannot insert customer identity rows directly');
select extensions.ok(not has_table_privilege('authenticated','public.customers','UPDATE'),'authenticated clients cannot update customer identity rows directly');
select extensions.ok(has_function_privilege('authenticated','public.create_sellertray_customer(uuid,text,text,text)','EXECUTE'),'authenticated merchant management uses governed customer creation');
select extensions.ok(has_function_privilege('authenticated','public.update_sellertray_customer_profile(uuid,uuid,text,text)','EXECUTE'),'authenticated merchant management uses governed customer profile editing');

select * from extensions.finish();
rollback;
