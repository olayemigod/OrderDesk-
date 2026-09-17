begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='platform_merchant_campaigns'
      and column_name='request_id'
      and udt_name='uuid'
  ),
  'platform merchant campaigns persist an idempotency request UUID'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='platform_merchant_campaigns'
      and indexname='platform_merchant_campaigns_actor_request_uidx'
      and indexdef like '%UNIQUE%'
      and indexdef like '%created_by%request_id%'
  ),
  'campaign request UUID is unique per ProcessEdge administrator'
);

select extensions.ok(
  to_regprocedure('public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)') is not null,
  'platform merchant publish RPC accepts an optional request UUID'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'idempotent platform publish RPC remains service-role-only'
);

select extensions.ok(
  position('idempotentReplay' in pg_get_functiondef(
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)'::regprocedure
  )) > 0
  and position('request_id=p_request_id' in replace(pg_get_functiondef(
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)'::regprocedure
  ), ' ', '')) > 0,
  'RPC returns the existing campaign for the same actor/request UUID'
);

select extensions.ok(
  position('already used for a different merchant message' in pg_get_functiondef(
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)'::regprocedure
  )) > 0,
  'reusing a request UUID with a different broadcast payload is rejected'
);

select extensions.ok(
  position('Action label and action URL must be supplied together' in pg_get_functiondef(
    'public.platform_admin_publish_merchant_message(uuid,text,text,text,text,uuid[],text[],text,text,timestamptz,uuid)'::regprocedure
  )) > 0,
  'CTA label and link pairing is enforced server-side'
);

select * from extensions.finish();
rollback;
