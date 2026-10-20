begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

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

select * from extensions.finish();
rollback;
