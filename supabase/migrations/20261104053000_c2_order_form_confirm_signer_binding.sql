begin;

-- Forward-only C2-7 confirmation boundary hardening: authenticated callers
-- cannot impersonate an owner by submitting their UUID. Server-side
-- orchestration with a service-role token continues using its verified actor.
create or replace function public.confirm_sellertray_agreement_package(
  p_tenant_id uuid,
  p_order_form_id uuid,
  p_confirmed_legal_name text,
  p_request_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_role text;
  v_name text:=btrim(coalesce(p_confirmed_legal_name,''));
  v_evidence jsonb:=coalesce(p_request_evidence,'{}'::jsonb);
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_master public.sellertray_master_agreement_versions%rowtype;
  v_package public.sellertray_agreement_packages%rowtype;
  v_master_acceptance public.sellertray_master_agreement_acceptances%rowtype;
  v_confirmation public.sellertray_order_form_confirmations%rowtype;
  v_command_confirmation public.sellertray_order_form_confirmations%rowtype;
  v_master_id uuid;
  v_branch_subscriptions jsonb:='[]'::jsonb;
begin
  if p_tenant_id is null or p_order_form_id is null or p_actor_user_id is null or p_command_id is null then
    raise exception 'Business, Order Form, representative and command are required' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 200 or jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Valid representative name and confirmation evidence are required' using errcode='22023';
  end if;
  if coalesce((v_evidence->>'authority_confirmed')::boolean,false) is not true then
    raise exception 'Confirm your authority before continuing' using errcode='22023';
  end if;

  -- The authentication identity, not a request-body actor ID, governs signing.
  -- Trusted service-role orchestration still supplies the verified user ID.
  if coalesce(
       nullif(pg_catalog.current_setting('request.jwt.claim.role',true),''),
       nullif(auth.jwt()->>'role',''),
       ''
     ) <> 'service_role'
     and auth.uid() is distinct from p_actor_user_id then
    raise exception 'Authenticated signer must match the current user'
      using errcode='42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sellertray-package-command:'||p_tenant_id::text||':'||p_command_id::text,0)
  );

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role='owner' then
    null;
  elsif v_role='manager'
        and public.sellertray_user_has_capability(
          p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
        ) then
    null;
  else
    raise exception 'You are not authorised to confirm SellerTray purchases' using errcode='42501';
  end if;

  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.id=p_order_form_id
  for share;

  if exists(
    select 1
    from public.sellertray_commercial_order_forms replacement
    where replacement.tenant_id=p_tenant_id
      and replacement.supersedes_order_form_id=v_form.id
  ) then
    raise exception 'This Order Form has been replaced and cannot be confirmed' using errcode='23514';
  end if;

  v_master_id:=coalesce(
    v_form.required_master_agreement_version_id,
    public.resolve_sellertray_master_agreement_version_id(now())
  );
  if v_master_id is null then
    raise exception 'SellerTray Master Agreement is not yet published' using errcode='23514';
  end if;

  select m.* into strict v_master
  from public.sellertray_master_agreement_versions m
  where m.id=v_master_id;

  select a.* into v_master_acceptance
  from public.sellertray_master_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.agreement_version_id=v_master.id;
  if not found then
    raise exception 'Accept the required SellerTray Master Agreement separately before confirming this Order Form'
      using errcode='23514';
  end if;

  perform public.create_sellertray_agreement_package(
    p_tenant_id,v_form.id,v_master.id
  );

  select p.* into strict v_package
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id
    and p.master_agreement_version_id=v_master.id
    and p.order_form_id=v_form.id;

  select c.* into v_command_confirmation
  from public.sellertray_order_form_confirmations c
  where c.tenant_id=p_tenant_id and c.command_id=p_command_id;
  if found and v_command_confirmation.order_form_id<>v_form.id then
    raise exception 'Purchase confirmation command is already used for a different Order Form'
      using errcode='23505';
  end if;

  select c.* into v_confirmation
  from public.sellertray_order_form_confirmations c
  where c.tenant_id=p_tenant_id and c.order_form_id=v_form.id;

  if not found then
    insert into public.sellertray_order_form_confirmations(
      tenant_id,order_form_id,agreement_package_id,order_form_content_sha256,
      package_fingerprint,confirmed_by_user_id,confirmed_legal_name,confirmed_role,
      confirmation_method,request_evidence,command_id
    ) values(
      p_tenant_id,v_form.id,v_package.id,v_form.content_sha256,
      v_package.package_fingerprint,p_actor_user_id,v_name,v_role,
      'merchant_web_authenticated',
      v_evidence||jsonb_build_object(
        'confirmation_component','order_form_confirmation',
        'master_agreement_version_id',v_master.id,
        'master_acceptance_id',v_master_acceptance.id,
        'agreement_package_id',v_package.id,
        'package_fingerprint',v_package.package_fingerprint,
        'master_version_pinned_at_order_form_issue',v_form.required_master_agreement_version_id is not null
      ),
      p_command_id
    ) returning * into v_confirmation;
  elsif v_command_confirmation.id is not null and (
    v_confirmation.id<>v_command_confirmation.id
    or v_confirmation.confirmed_by_user_id<>p_actor_user_id
    or v_confirmation.confirmed_legal_name<>v_name
    or v_confirmation.confirmed_role<>v_role
  ) then
    raise exception 'Purchase confirmation command is already used for different facts'
      using errcode='23505';
  end if;

  if v_form.required_master_agreement_version_id is not null then
    v_branch_subscriptions:=public.register_sellertray_c2_confirmed_branch_commitments(
      p_tenant_id,v_form.id
    );
  end if;

  return jsonb_build_object(
    'masterAcceptanceId',v_master_acceptance.id,
    'masterAcceptanceCreated',false,
    'orderFormConfirmationId',v_confirmation.id,
    'orderFormConfirmationCreated',v_confirmation.command_id=p_command_id,
    'agreementPackageId',v_package.id,
    'packageFingerprint',v_package.package_fingerprint,
    'masterAgreementVersionId',v_master.id,
    'orderFormId',v_form.id,
    'branchSubscriptions',v_branch_subscriptions
  );
end;
$function$;

revoke all on function public.confirm_sellertray_agreement_package(uuid,uuid,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_agreement_package(uuid,uuid,text,jsonb,uuid,uuid)
  to authenticated,service_role;

commit;
