begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

select extensions.ok(
  (select count(*)=3 from information_schema.columns
   where table_schema='public'
     and table_name='sellertray_commercial_price_versions'
     and column_name in ('tenant_id','price_scope','source_standard_price_version_id')),
  'commercial price versions expose Business scope and exact standard-source provenance'
);

select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='sellertray_commercial_price_versions'
      and column_name='price_scope'
      and is_nullable='NO'
      and column_default like '%standard%'
  ),
  'existing and ordinary price versions default safely to standard scope'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.sellertray_commercial_price_versions'::regclass
      and c.conname='sellertray_commercial_price_versions_scope_subject_check'
      and lower(pg_get_constraintdef(c.oid)) like '%price_scope%standard%tenant_id is null%'
      and lower(pg_get_constraintdef(c.oid)) like '%price_scope%merchant_override%tenant_id is not null%source_standard_price_version_id is not null%'
  ),
  'schema requires standard prices to remain global and merchant overrides to carry Business plus standard-source authority'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.resolve_sellertray_commercial_price_version(text,text,text,text,timestamp with time zone)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('p.price_scope=''standard''' in body)>0
  and position('p.tenant_idisnull' in body)>0,
  'legacy/global price resolver is explicitly restricted to standard platform pricing'
)
from definition;

select extensions.has_function(
  'public',
  'resolve_sellertray_commercial_price_version_for_tenant',
  array['uuid','text','text','text','text','timestamp with time zone'],
  'Business-aware commercial price resolver exists'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamp with time zone)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('p.price_scope=''merchant_override''andp.tenant_id=p_tenant_id' in body)>0
  and position('p.price_scope=''standard''andp.tenant_idisnull' in body)>0
  and position('casewhenp.price_scope=''merchant_override''then1else0enddesc' in body)>0,
  'Business resolver deterministically prefers an effective merchant override and otherwise falls back to standard pricing'
)
from definition;

select extensions.has_function(
  'public',
  'publish_sellertray_merchant_subscription_price_override_admin',
  array['uuid','text','text','numeric','timestamp with time zone','timestamp with time zone','text','uuid'],
  'governed Business subscription override publisher exists'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamp with time zone,timestamp with time zone,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('admin.pricing.manage' in body)>0
  and position('v_yearly_gross:=v_monthly_gross*10' in body)>0
  and position('source_standard_price_version_id' in body)>0
  and position('v_standard_monthly.tax_rate_percent' in body)>0,
  'subscription override requires pricing capability, preserves standard-source tax authority and derives annual as exactly 10x monthly'
)
from definition;

select extensions.has_function(
  'public',
  'publish_sellertray_merchant_branch_setup_price_override_admin',
  array['uuid','text','numeric','timestamp with time zone','timestamp with time zone','text','uuid'],
  'governed Business Branch setup override publisher exists'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamp with time zone,timestamp with time zone,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('admin.pricing.manage' in body)>0
  and position('source_standard_price_version_id' in body)>0
  and position('v_standard.tax_rate_percent' in body)>0,
  'Branch setup override requires pricing capability and inherits standard-source tax authority'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.snapshot_sellertray_commercial_order_price()'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('resolve_sellertray_commercial_price_version_for_tenant' in body)>0
  and position('v_price.price_scope=''merchant_override''andv_price.tenant_id<>new.tenant_id' in body)>0,
  'order snapshot resolves the exact Business-effective price and rejects another Business override'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.create_sellertray_initial_installment_purchase_admin_impl(uuid,text,text,uuid[],text,text,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('resolve_sellertray_commercial_price_version_for_tenant(p_tenant_id,''subscription'',v_plan_code,''yearly''' in body)>0
  and position('resolve_sellertray_commercial_price_version_for_tenant(p_tenant_id,''branch_setup'',null,null' in body)>0
  and position('subscriptionpricescope' in body)>0
  and position('setuppricescope' in body)>0,
  'initial purchase resolves Business-effective subscription/setup price versions and audits their scopes'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.get_sellertray_commercial_onboarding_admin_impl(uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('(p.price_scope=''standard''orp.tenant_id=p_tenant_id)' in body)>0
  and position('''pricescope'',p.price_scope' in body)>0
  and position('''sourcestandardpriceversionid'',p.source_standard_price_version_id' in body)>0,
  'Admin onboarding exposes standard plus selected-Business overrides without leaking another Business override'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.publish_sellertray_subscription_price_pair_admin_impl(text,text,numeric,numeric,timestamp with time zone,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('''standard''' in body)>0
  and position('price_scope=''standard''' in body)>0,
  'standard subscription publisher remains explicitly global after scoped pricing is introduced'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.publish_sellertray_branch_setup_price_admin_impl(text,numeric,numeric,timestamp with time zone,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('''standard''' in body)>0
  and position('price_scope=''standard''' in body)>0,
  'standard Branch setup publisher remains explicitly global after scoped pricing is introduced'
)
from definition;

select extensions.ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='sellertray_commercial_price_versions'
      and not t.tgisinternal
      and lower(pg_get_triggerdef(t.oid)) like '%before%'
      and lower(pg_get_triggerdef(t.oid)) like '%update%'
      and lower(pg_get_triggerdef(t.oid)) like '%delete%'
  ),
  'standard and Business-scoped price versions remain immutable historical evidence'
);

select extensions.ok(
  not has_function_privilege('authenticated',
    'public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamp with time zone,timestamp with time zone,text,uuid)',
    'EXECUTE')
  and not has_function_privilege('anon',
    'public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamp with time zone,timestamp with time zone,text,uuid)',
    'EXECUTE'),
  'merchant-scoped subscription override command is not directly executable by merchant/anonymous database roles'
);

select extensions.ok(
  has_function_privilege('service_role',
    'public.publish_sellertray_merchant_subscription_price_override_admin(uuid,text,text,numeric,timestamp with time zone,timestamp with time zone,text,uuid)',
    'EXECUTE')
  and has_function_privilege('service_role',
    'public.publish_sellertray_merchant_branch_setup_price_override_admin(uuid,text,numeric,timestamp with time zone,timestamp with time zone,text,uuid)',
    'EXECUTE'),
  'merchant-scoped pricing commands are available only through the privileged server boundary'
);

select * from extensions.finish();
rollback;
