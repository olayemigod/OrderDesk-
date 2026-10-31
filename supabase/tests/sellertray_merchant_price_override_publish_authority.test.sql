begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.has_function(
  'public','publish_sellertray_merchant_subscription_price_override_admin',
  array['uuid','text','text','numeric','timestamp with time zone','timestamp with time zone','text','uuid'],
  'Business subscription override publisher exists on clean schema'
);

select extensions.has_function(
  'public','publish_sellertray_merchant_branch_setup_price_override_admin',
  array['uuid','text','numeric','timestamp with time zone','timestamp with time zone','text','uuid'],
  'Business Branch setup override publisher exists on clean schema'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamptz,timestamptz,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute Business subscription override publisher'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamptz,timestamptz,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute Business subscription override publisher directly'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute Business Branch setup override publisher'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute Business Branch setup override publisher directly'
);

select extensions.ok(
  position('admin.pricing.manage' in pg_get_functiondef(
    'public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamptz,timestamptz,text,uuid)'::regprocedure
  )) > 0
  and position('sellertray_publish_merchant_subscription_price_override' in pg_get_functiondef(
    'public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamptz,timestamptz,text,uuid)'::regprocedure
  )) > 0,
  'subscription override publisher enforces pricing capability and immutable Admin audit'
);

select extensions.ok(
  position('admin.pricing.manage' in pg_get_functiondef(
    'public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid)'::regprocedure
  )) > 0
  and position('sellertray_publish_merchant_branch_setup_price_override' in pg_get_functiondef(
    'public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamptz,timestamptz,text,uuid)'::regprocedure
  )) > 0,
  'Branch setup override publisher enforces pricing capability and immutable Admin audit'
);

select * from extensions.finish();
rollback;
