begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

select extensions.ok(
  has_table_privilege('authenticated','public.customers','SELECT'),
  'authenticated customer reads remain available'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.customers','INSERT')
  and not has_table_privilege('authenticated','public.customers','UPDATE')
  and not has_table_privilege('authenticated','public.customers','DELETE'),
  'authenticated users cannot write customer rows directly'
);
select extensions.is(
  (select count(*)::int from pg_catalog.pg_policies p
   where p.schemaname='public' and p.tablename='customers'
     and p.cmd in ('ALL','INSERT','UPDATE','DELETE')),
  0,
  'customer mutation RLS policies are removed because writes are command-only'
);

select extensions.ok(
  has_function_privilege('service_role','public.resolve_sellertray_pos_customer(uuid,uuid,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.resolve_sellertray_pos_customer(uuid,uuid,text,text)','EXECUTE'),
  'POS customer identity resolution remains server-only'
);
select extensions.ok(
  lower(pg_get_functiondef('public.resolve_sellertray_pos_customer(uuid,uuid,text,text)'::regprocedure)) like '%pg_advisory_xact_lock%'
  and lower(pg_get_functiondef('public.resolve_sellertray_pos_customer(uuid,uuid,text,text)'::regprocedure)) like '%v_phone_digits%',
  'POS customer identity resolution serializes on normalized phone identity'
);

select extensions.ok(
  (select p.prosecdef from pg_proc p where p.oid='public.update_sellertray_customer_profile(uuid,uuid,text,text)'::regprocedure),
  'customer profile update is a self-authorizing security-definer command'
);
select extensions.ok(
  has_function_privilege('authenticated','public.update_sellertray_customer_profile(uuid,uuid,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.update_sellertray_customer_profile(uuid,uuid,text,text)','EXECUTE'),
  'authenticated users can invoke customer profile command while anonymous users cannot'
);
select extensions.ok(
  lower(pg_get_functiondef('public.update_sellertray_customer_profile(uuid,uuid,text,text)'::regprocedure)) like '%orderdesk_subscription_can_write%'
  and lower(pg_get_functiondef('public.update_sellertray_customer_profile(uuid,uuid,text,text)'::regprocedure)) like '%tenant_members%',
  'customer profile command enforces writable subscription and tenant management authority'
);

select extensions.has_function(
  'public','create_sellertray_pos_order_atomic',
  array['uuid','uuid','uuid','uuid','text','text','text','jsonb'],
  'actor-aware POS atomic command exists'
);
select extensions.has_function(
  'public','create_sellertray_pos_order_idempotent',
  array['uuid','uuid','uuid','uuid','text','text','text','jsonb','uuid'],
  'actor-aware idempotent POS command exists'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'actor-aware POS atomic command remains service-only'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'actor-aware idempotent POS command remains service-only'
);
select extensions.ok(
  lower(pg_get_functiondef('public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure)) like '%orderdesk_subscription_can_write%'
  and lower(pg_get_functiondef('public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure)) like '%sellertray_user_can_operate_branch%',
  'POS atomic command enforces subscription and actor Branch authority in the database'
);
select extensions.ok(
  lower(pg_get_functiondef('public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) like '%orderdesk_subscription_can_write%'
  and lower(pg_get_functiondef('public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure)) like '%sellertray_user_can_operate_branch%',
  'idempotent POS command enforces subscription and actor Branch authority in the database'
);
select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.create_sellertray_pos_order_atomic(uuid,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.create_sellertray_pos_order_atomic(uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'actor-less POS atomic helpers are no longer directly callable by the service role'
);
select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.create_sellertray_pos_order_idempotent(uuid,uuid,uuid,text,text,text,jsonb,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.create_sellertray_pos_order_idempotent(uuid,uuid,text,text,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'actor-less idempotent POS helpers are no longer directly callable by the service role'
);

select * from extensions.finish();
rollback;
