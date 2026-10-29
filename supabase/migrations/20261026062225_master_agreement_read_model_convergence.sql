alter function public.get_sellertray_installment_billing_state(uuid,uuid)
  rename to get_sellertray_installment_billing_state_legacy_order_agreement;

create or replace function public.get_sellertray_installment_billing_state(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_state jsonb;
  v_accepted_at timestamptz;
  v_entitlement_state text;
  v_setup_required integer;
  v_setup_ready integer;
  v_qualifying_settled boolean;
begin
  v_state := public.get_sellertray_installment_billing_state_legacy_order_agreement(
    p_tenant_id,
    p_installment_obligation_id
  );
  v_accepted_at := public.sellertray_master_agreement_accepted_at(p_tenant_id,now());
  v_entitlement_state := coalesce(v_state->>'entitlementState','pending');

  if v_entitlement_state not in ('provisional','full') then
    v_setup_required := coalesce((v_state->>'setupRequiredCount')::integer,0);
    v_setup_ready := coalesce((v_state->>'setupReadyCount')::integer,0);
    v_qualifying_settled := coalesce((v_state->>'qualifyingSettlementSatisfied')::boolean,false);

    if v_accepted_at is null then
      v_entitlement_state := 'pending_agreement';
    elsif v_setup_required=0 or v_setup_ready<v_setup_required then
      v_entitlement_state := 'pending_setup';
    elsif not v_qualifying_settled then
      v_entitlement_state := 'awaiting_qualifying_settlement';
    else
      v_entitlement_state := 'ready_for_activation';
    end if;
  end if;

  return v_state || jsonb_build_object(
    'agreementAccepted',v_accepted_at is not null,
    'agreementAcceptedAt',v_accepted_at,
    'masterAgreementVersionId',public.resolve_sellertray_master_agreement_version_id(now()),
    'entitlementState',v_entitlement_state
  );
end;
$$;
revoke all on function public.get_sellertray_installment_billing_state(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_billing_state(uuid,uuid) to service_role;

alter function public.get_sellertray_onboarding_state_core(uuid)
  rename to get_sellertray_onboarding_state_core_master_agreement_v1;

create or replace function public.get_sellertray_onboarding_state_core(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_state jsonb;
  v_legacy jsonb;
  v_master jsonb;
begin
  v_state := public.get_sellertray_onboarding_state_core_master_agreement_v1(p_tenant_id);

  if v_state->>'commercialOrder' is null then
    v_legacy := public.get_sellertray_onboarding_state_core_legacy_order_agreement(p_tenant_id);
    v_master := public.get_sellertray_master_agreement_state(p_tenant_id,now());
    return v_legacy || jsonb_build_object(
      'readModelVersion','master-agreement-v2',
      'agreement',jsonb_build_object(
        'required',false,
        'published',coalesce((v_master->>'published')::boolean,false),
        'accepted',coalesce((v_master->>'accepted')::boolean,false),
        'acceptedAt',v_master->'acceptance'->>'acceptedAt',
        'currentVersion',v_master->'currentVersion',
        'requiredForNewServiceDelivery',true
      )
    );
  end if;

  return v_state || jsonb_build_object('readModelVersion','master-agreement-v2');
end;
$$;
revoke all on function public.get_sellertray_onboarding_state_core(uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_onboarding_state_core(uuid) to service_role;
