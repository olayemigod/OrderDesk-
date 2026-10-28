begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

select extensions.has_table(
  'public','sellertray_commercial_price_version_controls',
  'commercial price lifecycle controls are first-class append-only evidence'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.sellertray_commercial_price_version_controls'::regclass
      and c.conname='sellertray_commercial_price_version_controls_action_check'
      and lower(pg_get_constraintdef(c.oid)) like '%pause%resume%deactivate%void%'
  ),
  'price lifecycle actions are restricted to pause, resume, deactivate and void'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.sellertray_commercial_price_version_controls'::regclass
      and not t.tgisinternal
      and lower(pg_get_triggerdef(t.oid)) like '%before%'
      and lower(pg_get_triggerdef(t.oid)) like '%update%'
      and lower(pg_get_triggerdef(t.oid)) like '%delete%'
  ),
  'price lifecycle control evidence is immutable after insertion'
);

select extensions.has_function(
  'public','sellertray_commercial_price_version_state',
  array['uuid','timestamp with time zone'],
  'price lifecycle state resolver exists'
);

select extensions.ok(
  (select p.prosecdef
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.oid='public.sellertray_commercial_price_version_state(uuid,timestamp with time zone)'::regprocedure)
  and has_function_privilege('authenticated','public.sellertray_commercial_price_version_state(uuid,timestamp with time zone)','EXECUTE')
  and has_function_privilege('anon','public.sellertray_commercial_price_version_state(uuid,timestamp with time zone)','EXECUTE')
  and not has_table_privilege('authenticated','public.sellertray_commercial_price_version_controls','SELECT')
  and not has_table_privilege('anon','public.sellertray_commercial_price_version_controls','SELECT'),
  'narrow SECURITY DEFINER state helper preserves existing resolver-role compatibility without exposing the control ledger'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.sellertray_commercial_price_version_state(uuid,timestamp with time zone)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('when''pause''then''paused''' in body)>0
  and position('when''deactivate''then''deactivated''' in body)>0
  and position('when''void''then''voided''' in body)>0,
  'state resolver derives active, paused, deactivated and voided from append-only control history'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.resolve_sellertray_commercial_price_version(text,text,text,text,timestamp with time zone)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('sellertray_commercial_price_version_state(p.id,p_as_of)=''active''' in body)>0,
  'global price resolution excludes paused, deactivated and voided versions'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamp with time zone)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('sellertray_commercial_price_version_state(p.id,p_as_of)=''active''' in body)>0
  and position('casewhenp.price_scope=''merchant_override''then1else0enddesc' in body)>0,
  'Business-aware price resolution excludes controlled-off versions while retaining override precedence'
)
from definition;

select extensions.has_function(
  'public','control_sellertray_commercial_price_version_admin',
  array['uuid','text','text','uuid','uuid'],
  'governed commercial price lifecycle command exists'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.control_sellertray_commercial_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('admin.pricing.manage' in body)>0
  and position('v_actionnotin(''pause'',''resume'',''deactivate'',''void'')' in body)>0
  and position('v_yearly.gross_amount-(v_monthly.gross_amount*10)' in body)>0,
  'lifecycle command is pricing-capability controlled, action-bounded and preserves subscription pair coherence'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.control_sellertray_commercial_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_identity,0))' in body)>0
  and position('v_control_at:=clock_timestamp()' in body)>0
  and position('sellertray_commercial_price_version_state(x,v_control_at)' in body)>0,
  'lifecycle transitions serialize per exact price/pair before state inspection and establish their control timestamp after locking'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.control_sellertray_commercial_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('voidisonlyallowedbeforeapriceversionbecomeseffective' in body)>0
  and position('sellertray_commercial_order_price_snapshots' in body)>0
  and position('source_standard_price_version_id=any(v_target_ids)' in body)>0,
  'Void is future-only and rejects price versions already consumed by an order or Business override'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.control_sellertray_commercial_price_version_admin(uuid,text,text,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('onlyanactivepriceversioncanbepaused' in body)>0
  and position('onlyapausedpriceversioncanberesumed' in body)>0
  and position('adeactivatedorvoidedpriceversionisterminal' in body)>0,
  'Pause/Resume transitions are constrained and Deactivate/Void are terminal'
)
from definition;

select extensions.ok(
  not has_function_privilege('authenticated',
    'public.control_sellertray_commercial_price_version_admin(uuid,text,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon',
    'public.control_sellertray_commercial_price_version_admin(uuid,text,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role',
    'public.control_sellertray_commercial_price_version_admin(uuid,text,text,uuid,uuid)','EXECUTE'),
  'price lifecycle mutation is available only through a privileged server boundary'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.get_sellertray_commercial_onboarding_admin(uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('''lifecyclestate'',public.sellertray_commercial_price_version_state' in body)>0
  and position('''latestcontrolaction'',c.control_action' in body)>0
  and position('''latestcontrolreason'',c.reason' in body)>0,
  'Admin pricing read model exposes current lifecycle state and latest control evidence'
)
from definition;

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_commercial_price_version_controls','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_commercial_price_version_controls','INSERT')
  and has_table_privilege('service_role','public.sellertray_commercial_price_version_controls','SELECT')
  and has_table_privilege('service_role','public.sellertray_commercial_price_version_controls','INSERT')
  and not has_table_privilege('service_role','public.sellertray_commercial_price_version_controls','UPDATE')
  and not has_table_privilege('service_role','public.sellertray_commercial_price_version_controls','DELETE'),
  'control ledger is append/read-only to the privileged server boundary'
);

select * from extensions.finish();
rollback;