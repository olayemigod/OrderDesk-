-- Harden the retained amount-only commercial-adjustment compatibility path.
--
-- The typed discount authority introduced immediately before this migration
-- already prevents a discount from reducing the commercial net below
-- confirmed payment facts. During a rolling Admin deployment, however, an
-- older bundle may still call the amount-only adjustment RPC. Preserve that
-- compatibility contract while enforcing the same monetary invariant.

create or replace function public.record_sellertray_commercial_adjustment_internal(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_command_id uuid,
  p_amount numeric,
  p_reason text,
  p_evidence jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_row public.sellertray_commercial_adjustments%rowtype;
  v_amount numeric(18,2);
  v_adjustments numeric(18,2) := 0;
  v_gateway numeric(18,2) := 0;
  v_direct numeric(18,2) := 0;
  v_confirmed_payments numeric(18,2) := 0;
begin
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);

  if p_amount is null or p_amount <= 0 then
    raise exception 'Commercial adjustment amount must be positive' using errcode='22023';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'Commercial adjustment reason is required' using errcode='22023';
  end if;

  v_amount := round(p_amount::numeric,2);

  select a.* into v_row
  from public.sellertray_commercial_adjustments a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  -- Preserve payload-sensitive idempotency before evaluating present-day
  -- settlement facts. An already-recorded command must remain replayable even
  -- if confirmed payments were added after that command originally succeeded.
  if found then
    if v_row.commercial_order_id<>p_commercial_order_id
       or abs(v_row.amount-v_amount)>=0.005
       or v_row.actor_user_id is distinct from p_actor_user_id
       or v_row.reason is distinct from btrim(p_reason)
       or v_row.evidence is distinct from coalesce(p_evidence,'{}'::jsonb) then
      raise exception 'Commercial adjustment command id was already used with different input' using errcode='23505';
    end if;
  else
    select o.* into strict v_order
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

    select coalesce(sum(a.amount),0)::numeric(18,2) into v_adjustments
    from public.sellertray_commercial_adjustments a
    where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id;

    select coalesce(sum(p.amount),0)::numeric(18,2) into v_gateway
    from public.sellertray_commercial_installment_payment_confirmations p
    where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

    select coalesce(sum(p.amount),0)::numeric(18,2) into v_direct
    from public.sellertray_commercial_direct_payment_confirmations p
    where p.tenant_id=p_tenant_id and p.commercial_order_id=p_commercial_order_id;

    v_confirmed_payments := (v_gateway+v_direct)::numeric(18,2);

    if v_adjustments+v_amount > v_order.total_gross_amount + 0.004 then
      raise exception 'Approved discounts cannot exceed immutable order gross' using errcode='23514';
    end if;
    if v_order.total_gross_amount-(v_adjustments+v_amount) < v_confirmed_payments - 0.004 then
      raise exception 'Discount cannot reduce the net amount below confirmed payments' using errcode='23514';
    end if;

    insert into public.sellertray_commercial_adjustments(
      tenant_id,commercial_order_id,command_id,amount,currency,reason,evidence,actor_user_id
    ) values (
      p_tenant_id,p_commercial_order_id,p_command_id,v_amount,v_order.currency,
      btrim(p_reason),coalesce(p_evidence,'{}'::jsonb),p_actor_user_id
    )
    returning * into strict v_row;
  end if;

  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,p_commercial_order_id);
  return public.get_sellertray_commercial_settlement_state(p_tenant_id,p_commercial_order_id);
end;
$$;

revoke all on function public.record_sellertray_commercial_adjustment_internal(uuid,uuid,uuid,numeric,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.record_sellertray_commercial_adjustment_internal(uuid,uuid,uuid,numeric,text,jsonb,uuid)
  to service_role;
