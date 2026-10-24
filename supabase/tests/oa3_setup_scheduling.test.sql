begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(25);

select extensions.ok((select relrowsecurity from pg_class where oid='public.sellertray_commercial_setup_appointments'::regclass),'setup appointments are RLS protected');
select extensions.ok((select relrowsecurity from pg_class where oid='public.sellertray_commercial_setup_appointment_events'::regclass),'setup appointment events are RLS protected');
select extensions.ok((select relrowsecurity from pg_class where oid='public.sellertray_setup_workers'::regclass),'setup workers are RLS protected');
select extensions.ok((select relrowsecurity from pg_class where oid='public.sellertray_setup_service_areas'::regclass),'setup service areas are RLS protected');
select extensions.ok((select relrowsecurity from pg_class where oid='public.sellertray_setup_reschedule_requests'::regclass),'merchant reschedule requests are RLS protected');

select extensions.ok(not has_table_privilege('authenticated','public.sellertray_commercial_setup_appointments','SELECT'),'authenticated clients cannot bypass appointment read authority');
select extensions.ok(not has_table_privilege('authenticated','public.sellertray_commercial_setup_appointment_events','SELECT'),'authenticated clients cannot read internal setup history directly');
select extensions.ok(not has_table_privilege('authenticated','public.sellertray_setup_workers','SELECT'),'merchant clients cannot read ProcessEdge workforce directly');

select extensions.ok(has_function_privilege('service_role','public.platform_admin_setup_scheduling_center(uuid,uuid)','EXECUTE'),'service role can load AAL2-mediated Admin scheduling center');
select extensions.ok(not has_function_privilege('authenticated','public.platform_admin_setup_scheduling_center(uuid,uuid)','EXECUTE'),'authenticated clients cannot call Admin scheduling center directly');
select extensions.ok(has_function_privilege('authenticated','public.get_sellertray_setup_schedule(uuid)','EXECUTE'),'merchant Owner/Manager scheduling projection is callable by authenticated users');
select extensions.ok(has_function_privilege('authenticated','public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid)','EXECUTE'),'merchant Owner/Manager can submit governed setup change requests');

select extensions.ok(position('admin.branch_setup.manage' in lower(pg_get_functiondef('public.platform_admin_schedule_branch_setup(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,text)'::regprocedure)))>0,'scheduling requires named Branch setup capability');
select extensions.ok(position('for update' in lower(pg_get_functiondef('public.assert_sellertray_setup_capacity(uuid,uuid,timestamptz,timestamptz,uuid)'::regprocedure)))>0 and position('max_concurrent_setups' in lower(pg_get_functiondef('public.assert_sellertray_setup_capacity(uuid,uuid,timestamptz,timestamptz,uuid)'::regprocedure)))>0,'capacity checks serialize on the worker and enforce configured concurrency');
select extensions.ok(position('travel_buffer_minutes' in lower(pg_get_functiondef('public.assert_sellertray_setup_capacity(uuid,uuid,timestamptz,timestamptz,uuid)'::regprocedure)))>0,'capacity overlap includes governed travel buffers');
select extensions.ok(position('mark_sellertray_commercial_branch_setup_ready' in lower(pg_get_functiondef('public.platform_admin_transition_branch_setup(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure)))>0 and position('reconcile_sellertray_installment_entitlement' in lower(pg_get_functiondef('public.platform_admin_transition_branch_setup(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure)))>0,'completion feeds existing readiness then entitlement reconciliation');
select extensions.ok(position('admin.branch_setup.manage' in lower(pg_get_functiondef('public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)'::regprocedure)))>0,'readiness mutation converges on named Branch setup capability');
select extensions.ok(position('sellertray_commercial_setup_appointment_events' in lower(pg_get_functiondef('public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)'::regprocedure)))>0 and position('completed' in lower(pg_get_functiondef('public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)'::regprocedure)))>0,'new readiness facts require the matching immutable completed setup event');
select extensions.ok(position('is_active' in lower(pg_get_functiondef('public.assert_sellertray_setup_subject(uuid,uuid,uuid)'::regprocedure)))=0,'purchased Branch setup remains a valid readiness subject before Branch activation');
select extensions.ok(position('internal_note' in lower(pg_get_functiondef('public.get_sellertray_setup_schedule(uuid)'::regprocedure)))=0 and position('worker_id' in lower(pg_get_functiondef('public.get_sellertray_setup_schedule(uuid)'::regprocedure)))=0,'merchant scheduling projection excludes ProcessEdge internal note and workforce identity');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_commercial_setup_appointment_events'::regclass and tgname='sellertray_setup_events_immutable' and not tgisinternal),'appointment lifecycle history has an immutable update/delete trigger');
select extensions.ok(position('owner' in lower(pg_get_functiondef('public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid)'::regprocedure)))>0 and position('manager' in lower(pg_get_functiondef('public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid)'::regprocedure)))>0,'merchant change requests enforce Owner/Manager authority');
select extensions.ok(position('null::uuid' in lower(pg_get_functiondef('public.platform_admin_upsert_setup_service_area(uuid,uuid,uuid,text,text,boolean,text)'::regprocedure)))>0 and position('null::uuid' in lower(pg_get_functiondef('public.platform_admin_upsert_setup_worker(uuid,uuid,uuid,text,text,boolean,integer,integer,uuid[],text)'::regprocedure)))>0,'ProcessEdge-global service-area and workforce master mutations require platform-scoped capability resolution');
select extensions.ok(position('cannot start in the past' in lower(pg_get_functiondef('public.request_sellertray_setup_reschedule(uuid,uuid,timestamptz,timestamptz,text,uuid)'::regprocedure)))>0,'merchant preferred setup windows reject past starts');
select extensions.ok(position('canmanageplatformmasters' in lower(pg_get_functiondef('public.platform_admin_setup_scheduling_center(uuid,uuid)'::regprocedure)))>0 and position('null::uuid' in lower(pg_get_functiondef('public.platform_admin_setup_scheduling_center(uuid,uuid)'::regprocedure)))>0,'Admin scheduling projection exposes platform-master authority separately from tenant scheduling authority');

select * from extensions.finish();
rollback;
