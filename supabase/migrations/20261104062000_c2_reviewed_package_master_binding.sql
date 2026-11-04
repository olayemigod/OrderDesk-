begin;

-- C2 Order Forms freeze the Master version at issue. Exactly that version's
-- package must be reviewed and confirmed even if a newer Master is published
-- meanwhile. Legacy C1 Order Forms continue using the current Master.
create or replace function public.confirm_sellertray_agreement_package_reviewed(
  p_tenant_id uuid,
  p_order_form_id uuid,
  p_expected_package_id uuid,
  p_expected_package_fingerprint text,
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
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_expected public.sellertray_agreement_packages%rowtype;
  v_required_master_id uuid;
  v_confirmed jsonb;
begin
  if p_expected_package_id is null
     or coalesce(p_expected_package_fingerprint,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'Review the current Order Form PDF before confirming the purchase'
      using errcode='22023';
  end if;

  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.id=p_order_form_id
  for share;

  select p.* into strict v_expected
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id and p.id=p_expected_package_id
  for share;

  if v_expected.order_form_id<>v_form.id
     or v_expected.commercial_order_id<>v_form.commercial_order_id
     or v_expected.package_fingerprint<>p_expected_package_fingerprint
     or v_expected.order_form_content_sha256<>v_form.content_sha256
     or v_expected.order_form_commercial_snapshot_sha256<>v_form.commercial_snapshot_sha256 then
    raise exception 'The reviewed Order Form package does not match this purchase'
      using errcode='23514';
  end if;

  v_required_master_id:=coalesce(
    v_form.required_master_agreement_version_id,
    public.resolve_sellertray_master_agreement_version_id(now())
  );
  if v_required_master_id is null then
    raise exception 'SellerTray Master Agreement is not yet published'
      using errcode='23514';
  end if;
  if v_expected.master_agreement_version_id<>v_required_master_id then
    raise exception 'The reviewed Master Agreement differs from the version required by this Order Form. Review the correct Order Form PDF before confirming'
      using errcode='23514';
  end if;

  v_confirmed:=public.confirm_sellertray_agreement_package(
    p_tenant_id,p_order_form_id,p_confirmed_legal_name,
    coalesce(p_request_evidence,'{}'::jsonb)||jsonb_build_object(
      'reviewed_agreement_package_id',v_expected.id,
      'reviewed_package_fingerprint',v_expected.package_fingerprint
    ),
    p_command_id,p_actor_user_id
  );

  -- The inner confirmation is C1/C2 shared; pinning the returned package here
  -- prevents any future drift in its own resolver from swapping legal evidence.
  if (v_confirmed->>'agreementPackageId')::uuid is distinct from v_expected.id
     or v_confirmed->>'packageFingerprint' is distinct from v_expected.package_fingerprint
     or (v_confirmed->>'masterAgreementVersionId')::uuid is distinct from v_required_master_id then
    raise exception 'Purchase confirmation does not match the exact reviewed Agreement Package'
      using errcode='23514';
  end if;

  return v_confirmed;
end;
$function$;

revoke all on function public.confirm_sellertray_agreement_package_reviewed(uuid,uuid,uuid,text,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_agreement_package_reviewed(uuid,uuid,uuid,text,text,jsonb,uuid,uuid)
  to service_role;

comment on function public.confirm_sellertray_agreement_package_reviewed(uuid,uuid,uuid,text,text,jsonb,uuid,uuid) is
  'Confirms only the exact reviewed package and fingerprint. C2 uses the Master Agreement version pinned into its immutable Order Form; C1 requires the current Master.';

commit;
