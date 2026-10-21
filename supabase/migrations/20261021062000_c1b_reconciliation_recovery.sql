begin;

-- C1B prerequisites are independent immutable facts. A reconciliation conflict
-- on one historical/commercial obligation must not prevent later obligations
-- for the same Business from reconciling. Return structured per-obligation
-- outcomes so service callers can log/retry failures without rolling back the
-- prerequisite that triggered reconciliation.
create or replace function public.reconcile_sellertray_installment_entitlements_for_tenant(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_obligation record;
  v_results jsonb := '[]'::jsonb;
  v_state jsonb;
  v_sqlstate text;
  v_message text;
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode='22023';
  end if;

  for v_obligation in
    select o.id
    from public.sellertray_commercial_installment_obligations o
    where o.tenant_id=p_tenant_id
    order by o.created_at,o.id
  loop
    begin
      v_state := public.reconcile_sellertray_installment_entitlement(
        p_tenant_id,v_obligation.id
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'installmentObligationId',v_obligation.id,
        'ok',true,
        'billingState',v_state
      ));
    exception when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'installmentObligationId',v_obligation.id,
        'ok',false,
        'errorCode',v_sqlstate,
        'error',left(coalesce(v_message,'Installment reconciliation failed'),300)
      ));
    end;
  end loop;

  return v_results;
end;
$$;

revoke all on function public.reconcile_sellertray_installment_entitlements_for_tenant(uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_sellertray_installment_entitlements_for_tenant(uuid)
  to service_role;

commit;
