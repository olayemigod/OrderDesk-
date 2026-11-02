-- Restore the repository-tracked baseline for the hosted OA5C production-test Business verifier.
--
-- This migration version/name already exists in the production migration ledger. It is
-- restored here so clean-schema environments reproduce the hosted history before the
-- newer forward verifier correction is applied.

create or replace function public.platform_admin_verify_oa5c_production_test_business_proof(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_core jsonb;
  v_current_master_id uuid;
  v_current_master_hash text;

  v_order_form_count integer := 0;
  v_order_form public.sellertray_commercial_order_forms%rowtype;
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_expected_family text;
  v_order_form_template_authorized boolean := false;
  v_package_count integer := 0;
  v_package public.sellertray_agreement_packages%rowtype;
  v_confirmation_count integer := 0;
  v_confirmation public.sellertray_order_form_confirmations%rowtype;

  v_manifest_fingerprint text;
  v_order_form_ok boolean := false;
  v_manifest_ok boolean := false;
  v_confirmation_ok boolean := false;
  v_package_immutable_contracts_ok boolean := false;
  v_agreement_package_ok boolean := false;
  v_automated_evidence_passed boolean := false;
  v_gates jsonb;
begin
  v_core := public.platform_admin_verify_oa5c_real_merchant_proof(
    p_actor_user_id,
    p_tenant_id,
    p_commercial_order_id
  );

  v_current_master_id := public.resolve_sellertray_master_agreement_version_id(now());
  if v_current_master_id is not null then
    select m.content_sha256
      into v_current_master_hash
    from public.sellertray_master_agreement_versions m
    where m.id=v_current_master_id;
  end if;

  select count(*)::integer
    into v_order_form_count
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id
    and f.commercial_order_id=p_commercial_order_id
    and not exists (
      select 1
      from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=f.tenant_id
        and replacement.supersedes_order_form_id=f.id
    );

  select f.*
    into v_order_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id
    and f.commercial_order_id=p_commercial_order_id
    and not exists (
      select 1
      from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=f.tenant_id
        and replacement.supersedes_order_form_id=f.id
    )
  order by f.issued_at desc,f.id desc
  limit 1;

  v_order_form_ok := v_order_form_count=1
    and v_order_form.id is not null
    and v_order_form.tenant_id=p_tenant_id
    and v_order_form.commercial_order_id=p_commercial_order_id
    and nullif(btrim(v_order_form.order_form_reference),'') is not null
    and nullif(btrim(v_order_form.rendered_content),'') is not null
    and v_order_form.commercial_snapshot<>'{}'::jsonb
    and v_order_form.template_content_sha256 ~ '^[0-9a-f]{64}$'
    and v_order_form.commercial_snapshot_sha256 ~ '^[0-9a-f]{64}$'
    and v_order_form.content_sha256 ~ '^[0-9a-f]{64}$';

  if v_order_form.id is not null then
    v_expected_family:=case when v_order_form.installment_obligation_id is null
      then 'subscription_order' else 'installment_agreement' end;

    select t.* into v_template
    from public.sellertray_commercial_agreement_template_versions t
    where t.id=v_order_form.order_form_template_version_id;

    v_order_form_template_authorized := found
      and v_template.agreement_family=v_expected_family
      and v_template.publication_scope='production'
      and v_template.production_authorized_at is not null
      and v_template.production_authorized_by_user_id is not null
      and nullif(btrim(v_template.production_authorization_reason),'') is not null
      and v_template.effective_from<=v_order_form.issued_at
      and v_template.production_authorized_at<=v_order_form.issued_at
      and v_template.version_code=v_order_form.template_version_code
      and v_template.content_sha256=v_order_form.template_content_sha256;
  end if;

  if v_order_form_ok and v_order_form_template_authorized and v_current_master_id is not null then
    select count(*)::integer
      into v_package_count
    from public.sellertray_agreement_packages p
    where p.tenant_id=p_tenant_id
      and p.commercial_order_id=p_commercial_order_id
      and p.master_agreement_version_id=v_current_master_id
      and p.order_form_id=v_order_form.id;

    select p.*
      into v_package
    from public.sellertray_agreement_packages p
    where p.tenant_id=p_tenant_id
      and p.commercial_order_id=p_commercial_order_id
      and p.master_agreement_version_id=v_current_master_id
      and p.order_form_id=v_order_form.id
    order by p.created_at desc,p.id desc
    limit 1;

    if v_package.id is not null then
      v_manifest_fingerprint := encode(
        extensions.digest(convert_to(v_package.manifest::text,'UTF8'),'sha256'),
        'hex'
      );

      v_manifest_ok := v_package_count=1
        and v_package.master_content_sha256=v_current_master_hash
        and v_package.order_form_content_sha256=v_order_form.content_sha256
        and v_package.order_form_commercial_snapshot_sha256=v_order_form.commercial_snapshot_sha256
        and v_package.manifest_schema_version=1
        and v_package.package_fingerprint=v_manifest_fingerprint
        and v_package.manifest#>>'{schemaVersion}'='1'
        and v_package.manifest#>>'{tenantId}'=p_tenant_id::text
        and v_package.manifest#>>'{commercialOrderId}'=p_commercial_order_id::text
        and v_package.manifest#>>'{masterAgreement,versionId}'=v_current_master_id::text
        and v_package.manifest#>>'{masterAgreement,contentSha256}'=v_current_master_hash
        and v_package.manifest#>>'{orderForm,id}'=v_order_form.id::text
        and v_package.manifest#>>'{orderForm,reference}'=v_order_form.order_form_reference
        and v_package.manifest#>>'{orderForm,contentSha256}'=v_order_form.content_sha256
        and v_package.manifest#>>'{orderForm,commercialSnapshotSha256}'=v_order_form.commercial_snapshot_sha256;

      select count(*)::integer
        into v_confirmation_count
      from public.sellertray_order_form_confirmations c
      where c.tenant_id=p_tenant_id
        and c.order_form_id=v_order_form.id
        and c.agreement_package_id=v_package.id;

      select c.*
        into v_confirmation
      from public.sellertray_order_form_confirmations c
      where c.tenant_id=p_tenant_id
        and c.order_form_id=v_order_form.id
        and c.agreement_package_id=v_package.id
      order by c.confirmed_at desc,c.id desc
      limit 1;

      v_confirmation_ok := v_confirmation_count=1
        and v_confirmation.id is not null
        and v_confirmation.confirmed_by_user_id is not null
        and v_confirmation.confirmed_role in ('owner','manager')
        and nullif(btrim(v_confirmation.confirmed_legal_name),'') is not null
        and v_confirmation.confirmation_method='merchant_web_authenticated'
        and v_confirmation.request_evidence<>'{}'::jsonb
        and coalesce(v_confirmation.request_evidence->>'authority_confirmed','')='true'
        and v_confirmation.command_id is not null
        and v_confirmation.order_form_content_sha256=v_order_form.content_sha256
        and v_confirmation.package_fingerprint=v_package.package_fingerprint
        and v_confirmation.request_evidence->>'acceptance_component'='order_form_confirmation'
        and v_confirmation.request_evidence->>'master_agreement_version_id'=v_current_master_id::text
        and v_confirmation.request_evidence->>'agreement_package_id'=v_package.id::text
        and v_confirmation.request_evidence->>'package_fingerprint'=v_package.package_fingerprint;
    end if;
  end if;

  select count(*)=3
    into v_package_immutable_contracts_ok
  from (
    values
      ('sellertray_commercial_order_forms'::text),
      ('sellertray_agreement_packages'),
      ('sellertray_order_form_confirmations')
  ) expected(table_name)
  where exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname=expected.table_name
      and not t.tgisinternal
      and lower(pg_catalog.pg_get_triggerdef(t.oid)) like '%before%'
      and lower(pg_catalog.pg_get_triggerdef(t.oid)) like '%delete%'
      and lower(pg_catalog.pg_get_triggerdef(t.oid)) like '%update%'
  );

  v_agreement_package_ok := coalesce(
    v_order_form_ok
    and v_order_form_template_authorized
    and v_manifest_ok
    and v_confirmation_ok
    and v_package_immutable_contracts_ok,
    false
  );

  v_automated_evidence_passed := coalesce(
    (v_core->>'automatedEvidencePassed')::boolean
    and v_agreement_package_ok,
    false
  );

  v_gates := coalesce(v_core->'gates','{}'::jsonb)
    || jsonb_build_object(
      'agreementPackage',jsonb_build_object(
        'pass',v_agreement_package_ok,
        'currentMasterAgreementVersionId',v_current_master_id,
        'orderFormCount',v_order_form_count,
        'orderFormId',v_order_form.id,
        'orderFormReference',v_order_form.order_form_reference,
        'orderFormIntegrityValid',v_order_form_ok,
        'orderFormTemplateVersionId',v_order_form.order_form_template_version_id,
        'orderFormTemplatePublicationScope',v_template.publication_scope,
        'orderFormTemplateProductionAuthorizedAt',v_template.production_authorized_at,
        'orderFormTemplateProductionAuthorizedByUserId',v_template.production_authorized_by_user_id,
        'orderFormTemplateProductionAuthorized',v_order_form_template_authorized,
        'agreementPackageCount',v_package_count,
        'agreementPackageId',v_package.id,
        'packageFingerprint',v_package.package_fingerprint,
        'manifestIntegrityValid',v_manifest_ok,
        'orderFormConfirmationCount',v_confirmation_count,
        'orderFormConfirmationId',v_confirmation.id,
        'confirmationMethod',v_confirmation.confirmation_method,
        'confirmationIntegrityValid',v_confirmation_ok,
        'immutableHistoryContractsValid',v_package_immutable_contracts_ok
      )
    );

  return (
    v_core
      - 'proofVersion'
      - 'generatedAt'
      - 'automatedEvidencePassed'
      - 'acceptancePolicy'
      - 'gates'
      - 'remainingAcceptanceProof'
  ) || jsonb_build_object(
    'proofVersion','oa5c-v3',
    'generatedAt',now(),
    'automatedEvidencePassed',v_automated_evidence_passed,
    'oa5cAccepted',false,
    'proofSubject',jsonb_build_object(
      'kind','disposable_production_test_business',
      'productionPathRequired',true,
      'businessMayBeDisposedAfterProof',true,
      'lifecycleEvidenceMustRemainGoverned',true
    ),
    'acceptancePolicy',jsonb_build_object(
      'disposableProductionTestBusinessRequired',true,
      'singleBranchDefault',true,
      'productionPathRequired',true,
      'authenticatedMerchantAgreementActionRequired',true,
      'productionAuthorizedOrderFormTemplateRequired',true,
      'supportedPaymentFlowRequired',true,
      'directDatabasePaymentInsertionForbidden',true,
      'fabricatedLifecycleEvidenceForbidden',true,
      'manualSurfaceObservationRequired',true,
      'note','The controlled Business may be disposable, but OA5C must traverse the real governed production path. Merchant Agreement/Order Form actions, supported payment confirmation, setup/readiness, entitlement and audit evidence must not be manufactured by code.'
    ),
    'gates',v_gates,
    'remainingAcceptanceProof',case
      when v_automated_evidence_passed then jsonb_build_array(
        'Confirm the subject is the designated disposable production-test Business used for this controlled production-path proof.',
        'Confirm the Master Agreement acceptance and exact Order Form confirmation were performed by an authorised merchant representative through the authenticated Merchant Web surface.',
        'Independently confirm settlement came through the supported payment flow as a genuine controlled/test payment and was not inserted directly into the database.',
        'Observe the same active commercial, agreement, setup and entitlement outcome in Merchant Web.',
        'Observe the same active runtime and governed lifecycle notifications in Mobile.',
        'Record the controlled OA5C acceptance decision before C2 starts.'
      )
      else jsonb_build_array(
        'Resolve every failed automated gate before performing the controlled merchant-side and cross-surface acceptance run.'
      )
    end
  );
end;
$function$;

revoke all on function public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid) from public;
revoke all on function public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid) from anon;
revoke all on function public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid) from authenticated;
grant execute on function public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid) to service_role;
