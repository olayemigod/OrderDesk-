-- Preserve the exact-PDF review gate while keeping Master acceptance separate.

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
set search_path to ''
as $function$
declare
  v_expected public.sellertray_agreement_packages%rowtype;
  v_current_master_id uuid;
begin
  if p_expected_package_id is null
     or coalesce(p_expected_package_fingerprint,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'Review the current Order Form PDF before confirming the purchase' using errcode='22023';
  end if;

  select p.* into strict v_expected
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id and p.id=p_expected_package_id
  for share;

  if v_expected.order_form_id<>p_order_form_id
     or v_expected.package_fingerprint<>p_expected_package_fingerprint then
    raise exception 'The reviewed Order Form package does not match this purchase' using errcode='23514';
  end if;

  v_current_master_id:=public.resolve_sellertray_master_agreement_version_id(now());
  if v_current_master_id is null then
    raise exception 'SellerTray Master Agreement is not yet published' using errcode='23514';
  end if;
  if v_expected.master_agreement_version_id<>v_current_master_id then
    raise exception 'The SellerTray Master Agreement changed after review. Review the current Order Form PDF again before confirming the purchase'
      using errcode='23514';
  end if;

  return public.confirm_sellertray_agreement_package(
    p_tenant_id,
    p_order_form_id,
    p_confirmed_legal_name,
    coalesce(p_request_evidence,'{}'::jsonb)||jsonb_build_object(
      'reviewed_agreement_package_id',v_expected.id,
      'reviewed_package_fingerprint',v_expected.package_fingerprint
    ),
    p_command_id,
    p_actor_user_id
  );
end;
$function$;

revoke all on function public.confirm_sellertray_agreement_package_reviewed(uuid,uuid,uuid,text,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_agreement_package_reviewed(uuid,uuid,uuid,text,text,jsonb,uuid,uuid)
  to service_role;

comment on function public.confirm_sellertray_agreement_package_reviewed(uuid,uuid,uuid,text,text,jsonb,uuid,uuid) is
  'Confirms the exact reviewed purchase-specific Order Form package. Requires the current Master Agreement to have been accepted separately.';
