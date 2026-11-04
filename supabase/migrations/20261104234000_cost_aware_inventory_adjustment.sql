-- Cost-aware stock adjustments, part of approved Build 47 OA5 integration.
-- Preserve immutable quantities, Stock UOM conversion, moving average replay,
-- append-only historical evidence, and the old 10-argument adjustment RPC.
-- A single SQL call atomically posts a movement and its verified cost, or neither.
begin;

-- Shared evidence authority. Authenticated historical corrections and the
-- service-only atomic adjustment both call the SAME governed evidence function.
CREATE OR REPLACE FUNCTION public.record_sellertray_inventory_cost_basis_for_actor(p_tenant_id uuid, p_inventory_movement_id uuid, p_stock_unit_cost numeric, p_reference text, p_reason text, p_command_id uuid, p_supersedes_evidence_id uuid, p_actor_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := p_actor_user_id;
  v_m public.inventory_movements%rowtype;
  v_currency text;
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_cost numeric(24,8);
  v_existing public.sellertray_inventory_cost_basis_evidence%rowtype;
  v_head_id uuid;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_inventory_movement_id is null or p_command_id is null
     or p_stock_unit_cost is null or p_stock_unit_cost<0
     or v_reference is null or v_reason is null then
    raise exception 'Business, stock movement, Stock-UOM unit cost, evidence reference, reason and command are required' using errcode='22023';
  end if;
  if char_length(v_reference)>160 or char_length(v_reason)>500 then
    raise exception 'Inventory cost evidence reference or reason is too long' using errcode='22023';
  end if;
  v_cost:=round(p_stock_unit_cost::numeric,8);

  perform pg_catalog.pg_advisory_xact_lock(
    hashtextextended('sellertray-cost-basis:'||p_tenant_id::text||':'||p_inventory_movement_id::text,0)
  );

  select * into v_m
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id and im.id=p_inventory_movement_id;
  if not found then
    raise exception 'Inventory movement not found' using errcode='22023';
  end if;
  if v_m.quantity_delta<=0
     or v_m.movement_type not in ('opening','adjustment','count_reconciliation','purchase_receipt') then
    raise exception 'Historical cost evidence is allowed only for eligible positive inbound stock movements' using errcode='23514';
  end if;
  if v_m.movement_type='purchase_receipt' and exists(
    select 1 from public.sellertray_purchase_receipt_items ri
    where ri.tenant_id=p_tenant_id and ri.inventory_movement_id=v_m.id
  ) then
    raise exception 'Governed Purchase Receiving already owns this receipt cost basis' using errcode='23514';
  end if;
  if not public.sellertray_user_can_read_branch(p_tenant_id,v_m.branch_id,v_user_id)
     or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_adjust_stock')
     or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_purchasing') then
    raise exception 'You do not have permission to manage historical inventory cost for this Branch' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select upper(t.currency) into v_currency from public.tenants t where t.id=p_tenant_id;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Business currency is unavailable for inventory valuation' using errcode='23514';
  end if;

  select * into v_existing
  from public.sellertray_inventory_cost_basis_evidence e
  where e.tenant_id=p_tenant_id and e.command_id=p_command_id;
  if found then
    if v_existing.inventory_movement_id=v_m.id
       and v_existing.stock_unit_cost=v_cost
       and v_existing.reference=v_reference
       and v_existing.reason=v_reason
       and v_existing.supersedes_evidence_id is not distinct from p_supersedes_evidence_id then
      return v_existing.id;
    end if;
    raise exception 'Inventory cost-basis command was already used for different facts' using errcode='23505';
  end if;

  select cb.evidence_id into v_head_id
  from public.sellertray_current_inventory_cost_basis(p_tenant_id,v_m.id) cb;
  if v_head_id is null and p_supersedes_evidence_id is not null then
    raise exception 'There is no existing cost-basis evidence to correct' using errcode='23514';
  end if;
  if v_head_id is not null and p_supersedes_evidence_id is distinct from v_head_id then
    raise exception 'Cost-basis correction must supersede the current evidence record' using errcode='23514';
  end if;

  insert into public.sellertray_inventory_cost_basis_evidence(
    tenant_id,branch_id,stock_location_id,catalog_item_id,inventory_movement_id,
    stock_unit_cost,currency,reference,reason,command_id,supersedes_evidence_id,actor_user_id
  ) values(
    p_tenant_id,v_m.branch_id,v_m.stock_location_id,v_m.catalog_item_id,v_m.id,
    v_cost,v_currency,v_reference,v_reason,p_command_id,p_supersedes_evidence_id,v_user_id
  ) returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.record_sellertray_inventory_cost_basis_for_actor(uuid,uuid,numeric,text,text,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.record_sellertray_inventory_cost_basis_for_actor(uuid,uuid,numeric,text,text,uuid,uuid,uuid)
  to service_role;

-- Preserve the existing public authenticated RPC signature and privilege,
-- obtaining identity only from the signed-in session (not caller-supplied).
create or replace function public.record_sellertray_inventory_cost_basis(
  p_tenant_id uuid,p_inventory_movement_id uuid,p_stock_unit_cost numeric,
  p_reference text,p_reason text,p_command_id uuid,
  p_supersedes_evidence_id uuid default null
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  return public.record_sellertray_inventory_cost_basis_for_actor(
    p_tenant_id,p_inventory_movement_id,p_stock_unit_cost,
    p_reference,p_reason,p_command_id,p_supersedes_evidence_id,v_actor
  );
end;
$$;

revoke all on function public.record_sellertray_inventory_cost_basis(uuid,uuid,numeric,text,text,uuid,uuid)
  from public,anon;
grant execute on function public.record_sellertray_inventory_cost_basis(uuid,uuid,numeric,text,text,uuid,uuid)
  to authenticated,service_role;

-- The mobile/web edge already verifies the bearer JWT and forwards the
-- authenticated actor to service_role. Cost permission is checked BEFORE
-- stock posting. If evidence write/replay fails, the whole movement rolls back.
create or replace function public.apply_sellertray_stock_adjustment_with_cost(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_catalog_item_id uuid,
  p_uom_id uuid,
  p_quantity numeric,
  p_adjustment_direction text,
  p_reference text,
  p_reason text,
  p_command_id text,
  p_actor_user_id uuid,
  p_stock_unit_cost numeric default null,
  p_cost_reference text default null,
  p_cost_reason text default null
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_has_cost boolean := p_stock_unit_cost is not null;
  v_direction text := lower(btrim(coalesce(p_adjustment_direction,'')));
  v_result jsonb;
  v_movement_id uuid;
  v_evidence_id uuid;
  v_cost_command_id uuid;
begin
  if v_direction <> 'increase' and
    (v_has_cost or p_cost_reference is not null or p_cost_reason is not null) then
    raise exception 'Stock reductions use existing inventory cost, not an entered cost basis'
      using errcode='23514';
  end if;
  if v_has_cost then
    if p_stock_unit_cost < 0 or p_stock_unit_cost > 999999999999999
       or nullif(btrim(coalesce(p_cost_reference,'')),'') is null
       or nullif(btrim(coalesce(p_cost_reason,'')),'') is null then
      raise exception 'Positive adjustments with verified cost require a non-negative Stock-UOM unit cost, evidence reference and cost rationale'
        using errcode='22023';
    end if;
    if not public.sellertray_user_has_capability(
      p_tenant_id,p_actor_user_id,'can_manage_purchasing'
    ) then
      raise exception 'You do not have permission to record inventory cost evidence'
        using errcode='42501';
    end if;
  elsif p_cost_reference is not null or p_cost_reason is not null then
    raise exception 'An evidence reference and rationale require a verified unit cost'
      using errcode='22023';
  end if;

  v_result := public.apply_sellertray_stock_adjustment(
    p_tenant_id,p_branch_id,p_catalog_item_id,p_uom_id,p_quantity,
    p_adjustment_direction,p_reference,p_reason,p_command_id,p_actor_user_id
  );
  v_movement_id := (v_result->>'movementId')::uuid;

  -- This cost command is a stable extension of the immutable stock command.
  -- Once the stock command has posted, neither adding previously absent
  -- evidence nor dropping previously supplied evidence is a legal retry.
  -- Older no-cost stock commands have no matching cost evidence identity and
  -- continue to replay without cost. For later cost resolution, use the
  -- separate governed historical-evidence command instead.
  v_cost_command_id := pg_catalog.md5(
    'sellertray:adjustment-cost:'||p_tenant_id::text||':'||p_command_id
  )::uuid;

  if coalesce((v_result->>'idempotentReplay')::boolean,false)
     and (
       exists(
         select 1 from public.sellertray_inventory_cost_basis_evidence e
         where e.tenant_id=p_tenant_id
           and e.inventory_movement_id=v_movement_id
           and e.command_id=v_cost_command_id
       )
     ) is distinct from v_has_cost then
    raise exception 'Stock action retry cannot change the original cost evidence choice; use historical cost evidence to resolve missing cost'
      using errcode='23505';
  end if;

  if v_has_cost then
    v_evidence_id := public.record_sellertray_inventory_cost_basis_for_actor(
      p_tenant_id,v_movement_id,p_stock_unit_cost,
      p_cost_reference,p_cost_reason,v_cost_command_id,null,p_actor_user_id
    );
  else
    select cb.evidence_id into v_evidence_id
    from public.sellertray_current_inventory_cost_basis(p_tenant_id,v_movement_id) cb;
  end if;

  return v_result || jsonb_build_object(
    'costEvidenceStatus',case
      when v_direction='decrease' then 'not_required'
      when v_evidence_id is not null then 'valued'
      else 'needs_evidence' end,
    'costEvidenceId',v_evidence_id
  );
end;
$$;

revoke all on function public.apply_sellertray_stock_adjustment_with_cost(
  uuid,uuid,uuid,uuid,numeric,text,text,text,text,uuid,numeric,text,text
) from public,anon,authenticated;
grant execute on function public.apply_sellertray_stock_adjustment_with_cost(
  uuid,uuid,uuid,uuid,numeric,text,text,text,text,uuid,numeric,text,text
) to service_role;

commit;
