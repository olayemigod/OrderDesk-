begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='sellertray_commercial_agreement_template_versions'
      and column_name='publication_scope'
      and is_nullable='NO'
      and column_default like '%qa%'
  ),
  'commercial agreement templates expose immutable publication scope with QA as the safe default'
);

select extensions.ok(
  (select count(*)=3
   from information_schema.columns
   where table_schema='public'
     and table_name='sellertray_commercial_agreement_template_versions'
     and column_name in (
       'production_authorized_at',
       'production_authorized_by_user_id',
       'production_authorization_reason'
     )),
  'production template authority records actor, timestamp and reason'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid='public.sellertray_commercial_agreement_template_versions'::regclass
      and c.conname='sellertray_commercial_agreement_template_production_authority_check'
      and lower(pg_get_constraintdef(c.oid)) like '%publication_scope%qa%'
      and lower(pg_get_constraintdef(c.oid)) like '%publication_scope%production%'
      and lower(pg_get_constraintdef(c.oid)) like '%production_authorization_reason%'
  ),
  'schema fails closed unless production scope carries complete immutable authorization evidence'
);

select extensions.ok(
  not exists (
    select 1
    from public.sellertray_commercial_agreement_template_versions t
    where t.publication_scope='qa'
      and (
        t.production_authorized_at is not null
        or t.production_authorized_by_user_id is not null
        or t.production_authorization_reason is not null
      )
  ),
  'historical QA templates remain QA evidence and are not silently promoted'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.publish_sellertray_commercial_agreement_template_version(text,text,text,text,timestamp with time zone,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('publication_scope' in body)=0,
  'generic template publisher remains QA-scoped through the table default rather than minting production authority'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.publish_sellertray_order_form_template_admin(text,text,text,text,timestamp with time zone,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('''production'',now(),p_actor_user_id,v_reason' in body)>0
  and position('existingorderformtemplateversionisnotproduction-authorized' in body)>0
  and position('publish_sellertray_commercial_agreement_template_version' in body)=0,
  'governed Admin publication creates production authority directly and cannot promote an existing QA version'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,uuid,text,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_template.publication_scope<>''production''' in body)>0
  and position('v_template.agreement_family<>v_expected_family' in body)>0
  and position('v_template.production_authorized_at>now()' in body)>0,
  'manual Admin Order Form issuance rejects non-production, wrong-family or not-yet-authorized templates'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('t.publication_scope=''production''' in body)>0
  and position('order_form_template_not_production_authorized' in body)>0
  and position('production_order_form_template_missing' in body)>0,
  'zero-touch orchestration resolves only production-authorized templates and fails closed on a legacy QA current form'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.create_sellertray_agreement_package(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_template.publication_scope<>''production''' in body)>0
  and position('v_template.version_code<>v_form.template_version_code' in body)>0
  and position('v_template.content_sha256<>v_form.template_content_sha256' in body)>0,
  'Agreement Package creation independently verifies exact production template provenance'
)
from definition;

select extensions.ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='sellertray_commercial_agreement_template_versions'
      and not t.tgisinternal
      and lower(pg_get_triggerdef(t.oid)) like '%before%'
      and lower(pg_get_triggerdef(t.oid)) like '%update%'
      and lower(pg_get_triggerdef(t.oid)) like '%delete%'
  ),
  'template versions retain immutable update/delete history protection after provenance columns are added'
);

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('v_order_form_template_authorized' in body)>0
  and position('orderformtemplateproductionauthorized' in body)>0
  and position('v_order_form_okandv_order_form_template_authorizedandv_manifest_ok' in body)>0,
  'OA5C v3 makes production Order Form template provenance a mandatory automated-evidence gate'
)
from definition;

with definition as (
  select lower(regexp_replace(pg_get_functiondef(
    'public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid)'::regprocedure
  ),'\s+','','g')) as body
)
select extensions.ok(
  position('coalesce(v_confirmation.request_evidence->>''authority_confirmed'','''')=''true''' in body)>0
  and position('(v_confirmation.request_evidence->>''authority_confirmed'')::boolean' in body)=0,
  'malformed merchant authority evidence fails closed instead of raising a boolean-cast error'
)
from definition;

select * from extensions.finish();
rollback;
