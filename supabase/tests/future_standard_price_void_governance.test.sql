begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

select extensions.has_table(
  'public','sellertray_commercial_price_version_voids',
  'future standard price void evidence is first-class'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.sellertray_commercial_price_version_voids'::regclass
      and c.contype='u'
      and pg_get_constraintdef(c.oid) like '%price_version_id%'
  ),
  'each commercial price version can carry at most one immutable void fact'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.sellertray_commercial_price_version_voids'::regclass
      and not t.tgisinternal
      and lower(pg_get_triggerdef(t.oid)) like '%before%'
      and lower(pg_get_triggerdef(t.oid)) like '%update%'
      and lower(pg_get_triggerdef(t.oid)) like '%delete%'
  ),
  'price void evidence is immutable after insertion'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.resolve_sellertray_commercial_price_version(text,text,text,text,timestamp with time zone)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('sellertray_commercial_price_version_voids' in body)>0
  and position('v.price_version_id=p.id' in body)>0,
  'global price resolution excludes voided price versions'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamp with time zone)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('sellertray_commercial_price_version_voids' in body)>0
  and position('v.price_version_id=p.id' in body)>0,
  'Business-aware price resolution also excludes voided price versions'
)
from definition;

select extensions.has_function(
  'public','void_sellertray_future_standard_subscription_price_pair_admin',
  array['uuid','text','uuid','uuid'],
  'governed future standard subscription pair void command exists'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.void_sellertray_future_standard_subscription_price_pair_admin(uuid,text,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('admin.pricing.manage' in body)>0
  and position('v_monthly.effective_from<=now()' in body)>0
  and position('sellertray_commercial_order_price_snapshots' in body)>0
  and position('source_standard_price_version_id' in body)>0
  and position('v_yearly.gross_amount-(v_monthly.gross_amount*10)' in body)>0,
  'void command is capability-gated, future-only, unused-only and preserves the 10-for-12 pair contract'
)
from definition;

select extensions.ok(
  not has_function_privilege('authenticated',
    'public.void_sellertray_future_standard_subscription_price_pair_admin(uuid,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon',
    'public.void_sellertray_future_standard_subscription_price_pair_admin(uuid,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role',
    'public.void_sellertray_future_standard_subscription_price_pair_admin(uuid,text,uuid,uuid)','EXECUTE'),
  'future price void command is available only through the privileged server boundary'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.get_sellertray_commercial_onboarding_admin(uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('''voided'',v.idisnotnull' in body)>0
  and position('''voidedat'',v.voided_at' in body)>0
  and position('''voidreason'',v.reason' in body)>0,
  'Admin pricing read model exposes append-only void evidence without rewriting price history'
)
from definition;

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_commercial_price_version_voids','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_commercial_price_version_voids','INSERT')
  and not has_table_privilege('anon','public.sellertray_commercial_price_version_voids','SELECT'),
  'merchant and anonymous database roles cannot read or write platform price-void evidence directly'
);

select extensions.ok(
  has_table_privilege('service_role','public.sellertray_commercial_price_version_voids','SELECT')
  and has_table_privilege('service_role','public.sellertray_commercial_price_version_voids','INSERT')
  and not has_table_privilege('service_role','public.sellertray_commercial_price_version_voids','UPDATE')
  and not has_table_privilege('service_role','public.sellertray_commercial_price_version_voids','DELETE'),
  'service boundary may append/read void evidence but cannot mutate or delete it'
);

select * from extensions.finish();
rollback;
