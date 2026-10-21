begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

select extensions.ok(
  to_regprocedure('public.get_sellertray_commercial_agreement_center(uuid,uuid)') is not null
  and to_regprocedure('public.get_sellertray_commercial_agreement_admin(uuid,uuid)') is not null,
  'C1A Merchant and Admin agreement read models exist'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated','public.get_sellertray_commercial_agreement_center(uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.get_sellertray_commercial_agreement_admin(uuid,uuid)','EXECUTE'
  ),
  'C1A agreement read models are not directly executable by authenticated clients'
);

select extensions.ok(
  has_function_privilege(
    'service_role','public.get_sellertray_commercial_agreement_center(uuid,uuid)','EXECUTE'
  )
  and has_function_privilege(
    'service_role','public.get_sellertray_commercial_agreement_admin(uuid,uuid)','EXECUTE'
  ),
  'C1A agreement read models remain available to service authority'
);

select extensions.ok(
  position('tenant_members' in pg_get_functiondef('public.get_sellertray_commercial_agreement_center(uuid,uuid)'::regprocedure))>0
  and position('sellertray_user_has_capability' in pg_get_functiondef('public.get_sellertray_commercial_agreement_center(uuid,uuid)'::regprocedure))>0
  and position('can_accept_commercial_agreements' in pg_get_functiondef('public.get_sellertray_commercial_agreement_center(uuid,uuid)'::regprocedure))>0,
  'Merchant agreement center derives role and signing authority from governed Team permissions'
);

select extensions.ok(
  position('platform_admins' in pg_get_functiondef('public.get_sellertray_commercial_agreement_admin(uuid,uuid)'::regprocedure))>0
  and position('sellertray_commercial_orders' in pg_get_functiondef('public.get_sellertray_commercial_agreement_admin(uuid,uuid)'::regprocedure))>0
  and position('sellertray_commercial_installment_obligations' in pg_get_functiondef('public.get_sellertray_commercial_agreement_admin(uuid,uuid)'::regprocedure))>0
  and position('sellertray_commercial_agreements' in pg_get_functiondef('public.get_sellertray_commercial_agreement_admin(uuid,uuid)'::regprocedure))>0,
  'Admin agreement projection consumes the governed platform and C1/C1A authorities'
);

select extensions.ok(
  position('on conflict do nothing' in lower(pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure)))>0
  and position('command_id=p_command_id' in replace(pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure),' ',''))>0,
  'C1A acceptance keeps strict command-idempotent replay handling'
);

select extensions.ok(
  position('agreement_id=v_agreement.id' in replace(pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure),' ',''))>0
  and position('already accepted with different acceptance facts' in pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure))>0,
  'C1A acceptance can recover a committed acceptance after client reload only when signer facts match'
);

select extensions.ok(
  position(
    'command_id=p_command_id'
    in regexp_replace(pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure),'\s+','','g')
  ) < position(
    'selecttm.roleintov_role'
    in lower(regexp_replace(pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure),'\s+','','g'))
  ),
  'exact committed acceptance replay is resolved before later current-role authority is re-evaluated'
);

select extensions.ok(
  position('authority_confirmed' in pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure))>0
  and position('request_evidence is distinct from v_evidence' in pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure))=0,
  'C1A retry identity compares stable acceptance claims rather than mutable transport evidence'
);

select extensions.ok(
  to_regprocedure('public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)') is not null
  and position('public.tenants' in pg_get_functiondef('public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)'::regprocedure))>0
  and position('merchant_code' in pg_get_functiondef('public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)'::regprocedure))>0
  and position('business_name' in pg_get_functiondef('public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)'::regprocedure))>0
  and position('business_email' in pg_get_functiondef('public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)'::regprocedure))>0
  and position('business_phone' in pg_get_functiondef('public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)'::regprocedure))>0
  and position('business_type' in pg_get_functiondef('public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)'::regprocedure))>0,
  'C1A commercial snapshots derive governed merchant identity from the Business authority'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated','public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)','EXECUTE'
  )
  and has_function_privilege(
    'service_role','public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)','EXECUTE'
  ),
  'C1A merchant identity snapshot builder remains service-authority only'
);

select * from extensions.finish();
rollback;