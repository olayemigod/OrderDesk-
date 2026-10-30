-- Historical Build 43 production convergence checkpoint.
-- The immediately following 20261030114114 migration corrects the JSON-null
-- interpretation discovered by the transactional lifecycle regression.
create or replace function public.get_sellertray_onboarding_state_core(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_state jsonb;
  v_legacy jsonb;
  v_master jsonb;
  v_next_code text;
  v_published boolean;
  v_accepted boolean;
begin
  v_state := public.get_sellertray_onboarding_state_core_master_agreement_v1(p_tenant_id);

  if v_state->'commercialOrder' is null then
    v_legacy := public.get_sellertray_onboarding_state_core_legacy_order_agreement(p_tenant_id);
    v_master := public.get_sellertray_master_agreement_state(p_tenant_id, now());
    v_next_code := v_legacy->'nextAction'->>'code';
    v_published := coalesce((v_master->>'published')::boolean, false);
    v_accepted := coalesce((v_master->>'accepted')::boolean, false);

    if v_next_code = 'prepare_branch' then
      return v_legacy || jsonb_build_object('readModelVersion','master-agreement-v3','agreement',jsonb_build_object('required',true,'published',v_published,'accepted',v_accepted,'acceptedAt',v_master->'acceptance'->>'acceptedAt','currentVersion',v_master->'currentVersion','requiredForNewServiceDelivery',true));
    end if;

    if not v_published then
      return v_legacy || jsonb_build_object('readModelVersion','master-agreement-v3','currentStage','agreement','blockers',jsonb_build_array(jsonb_build_object('code','master_agreement_not_published','message','The SellerTray Master Agreement must be published before a new commercial purchase can begin.','surface','admin_web')),'nextAction',jsonb_build_object('code','await_master_agreement_publication','label','Await Master Agreement publication','surface','admin_web'),'agreement',jsonb_build_object('required',true,'published',false,'accepted',false,'acceptedAt',null,'currentVersion',v_master->'currentVersion','requiredForNewServiceDelivery',true));
    end if;

    if not v_accepted then
      return v_legacy || jsonb_build_object('readModelVersion','master-agreement-v3','currentStage','agreement','blockers',jsonb_build_array(jsonb_build_object('code','master_agreement_acceptance_required','message','Accept the current SellerTray Master Agreement before choosing a plan and creating the first commercial purchase.','surface','merchant_web')),'nextAction',jsonb_build_object('code','review_master_agreement','label','Review and accept Master Agreement','surface','merchant_web'),'agreement',jsonb_build_object('required',true,'published',true,'accepted',false,'acceptedAt',null,'currentVersion',v_master->'currentVersion','requiredForNewServiceDelivery',true));
    end if;

    return v_legacy || jsonb_build_object('readModelVersion','master-agreement-v3','agreement',jsonb_build_object('required',true,'published',true,'accepted',true,'acceptedAt',v_master->'acceptance'->>'acceptedAt','currentVersion',v_master->'currentVersion','requiredForNewServiceDelivery',true));
  end if;

  return v_state || jsonb_build_object('readModelVersion','master-agreement-v3');
end;
$function$;
