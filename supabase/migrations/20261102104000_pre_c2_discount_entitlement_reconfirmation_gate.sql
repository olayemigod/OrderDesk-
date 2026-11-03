-- Extend the current Master Agreement gate at the single governed C1B
-- entitlement-reconciliation entrypoint. A discount may supersede the
-- confirmed purchase Order Form without changing the already-earned
-- provisional entitlement. Never append additional provisional/full
-- entitlement events or extend tenant_subscriptions until the exact
-- current replacement Order Form has been confirmed by the Merchant.
--
-- Legacy C1 purchases without a governed Order Form preserve their
-- existing compatibility behavior until the separate C2 cutover.

create or replace function public.reconcile_sellertray_installment_entitlement(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_commercial_order_id uuid;
  v_requires_reconfirmation boolean := false;
begin
  select io.commercial_order_id into strict v_commercial_order_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id
    and io.id=p_installment_obligation_id;

  -- Serialize on the same commercial order lock as adjustments,
  -- payment confirmations and the agreement-replacement trigger.
  perform public.lock_sellertray_commercial_order(
    p_tenant_id,v_commercial_order_id
  );

  if public.sellertray_master_agreement_accepted_at(p_tenant_id,now()) is null then
    return public.get_sellertray_installment_billing_state(
      p_tenant_id,p_installment_obligation_id
    );
  end if;

  -- Check *all* current Order Forms on this commercial order, including
  -- the subscription-order form (null installment_obligation_id).
  -- Checking only the installment-specific form would silently treat
  -- its absence as legacy acceptance and release full entitlement.
  select exists(
    select 1
    from public.sellertray_commercial_order_forms f
    where f.tenant_id=p_tenant_id
      and f.commercial_order_id=v_commercial_order_id
      and not exists(
        select 1
        from public.sellertray_commercial_order_forms replacement
        where replacement.tenant_id=f.tenant_id
          and replacement.supersedes_order_form_id=f.id
      )
      and not exists(
        select 1
        from public.sellertray_order_form_confirmations c
        where c.tenant_id=f.tenant_id
          and c.order_form_id=f.id
      )
  ) into v_requires_reconfirmation;

  if v_requires_reconfirmation then
    -- Read only: preserve already-earned provisional/full events,
    -- subscription dates, historical confirmed payments and setup facts.
    return public.get_sellertray_installment_billing_state(
      p_tenant_id,p_installment_obligation_id
    );
  end if;

  return public.reconcile_sellertray_installment_entitlement_package_core(
    p_tenant_id,p_installment_obligation_id
  );
end;
$$;

revoke all on function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_sellertray_installment_entitlement(uuid,uuid)
  to service_role;
