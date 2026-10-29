begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

select extensions.ok(
  to_regprocedure('public.get_sellertray_master_agreement_center(uuid,uuid)') is not null
  and to_regprocedure('public.get_sellertray_master_agreement_admin(uuid,uuid)') is not null,
  'Master Agreement Merchant and Admin read models exist'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_master_agreement_center(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_sellertray_master_agreement_admin(uuid,uuid)','EXECUTE'),
  'Master Agreement read models are not directly executable by authenticated clients'
);

select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_master_agreement_center(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.get_sellertray_master_agreement_admin(uuid,uuid)','EXECUTE'),
  'service authority may project Master Agreement state'
);

select extensions.ok(
  position('tenant_members' in pg_get_functiondef('public.get_sellertray_master_agreement_center(uuid,uuid)'::regprocedure))>0
  and position('sellertray_user_has_capability' in pg_get_functiondef('public.get_sellertray_master_agreement_center(uuid,uuid)'::regprocedure))>0
  and position('can_accept_commercial_agreements' in pg_get_functiondef('public.get_sellertray_master_agreement_center(uuid,uuid)'::regprocedure))>0,
  'Merchant Master Agreement center derives role and signing authority from governed Team permissions'
);

select extensions.ok(
  position('platform_admins' in pg_get_functiondef('public.get_sellertray_master_agreement_admin(uuid,uuid)'::regprocedure))>0
  and position('sellertray_master_agreement_versions' in pg_get_functiondef('public.get_sellertray_master_agreement_admin(uuid,uuid)'::regprocedure))>0,
  'Admin Master Agreement read model consumes platform admin identity and universal version authority'
);

select extensions.ok(
  position('command_id=p_command_id' in regexp_replace(pg_get_functiondef('public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure),'\s+','','g'))>0
  and position('different acceptance facts' in lower(pg_get_functiondef('public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure)))>0,
  'Master Agreement acceptance preserves strict command-idempotent replay identity'
);

select extensions.ok(
  position('tenant_id,agreement_version_id' in regexp_replace(pg_get_functiondef('public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure),'\s+','','g'))>0
  and position('commercial_order_id' in lower(pg_get_functiondef('public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure)))=0,
  'Master Agreement acceptance is Business/version scoped and has no commercial-order identity'
);

select extensions.ok(
  position('admin.agreements.publish' in pg_get_functiondef('public.publish_sellertray_master_agreement_admin(text,text,text,timestamptz,text,uuid)'::regprocedure))>0
  and position('platform_admin_audit' in pg_get_functiondef('public.publish_sellertray_master_agreement_admin(text,text,text,timestamptz,text,uuid)'::regprocedure))>0,
  'Master Agreement publication is capability-gated and audited'
);

select extensions.ok(
  position('legacy order-bound agreement acceptance is retired' in lower(pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure)))>0,
  'legacy order-bound acceptance is retained only as an explicit retired compatibility endpoint'
);

select extensions.ok(
  position('legacy merchant/order-specific agreement issuance is retired' in lower(pg_get_functiondef('public.issue_sellertray_commercial_agreement(uuid,uuid,uuid,uuid,text,text,uuid,uuid)'::regprocedure)))>0
  and position('legacy merchant/order-specific agreement issuance is retired' in lower(pg_get_functiondef('public.issue_sellertray_commercial_agreement_admin(uuid,uuid,uuid,uuid,text,text,uuid,text,uuid)'::regprocedure)))>0,
  'legacy merchant-specific agreement issuance is retired for Merchant and Admin paths'
);

select extensions.ok(
  to_regclass('public.sellertray_commercial_agreements') is not null
  and to_regclass('public.sellertray_commercial_agreement_acceptances') is not null
  and to_regprocedure('public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)') is not null,
  'legacy C1A tables and snapshot helpers remain available as immutable historical evidence'
);

select * from extensions.finish();
rollback;
