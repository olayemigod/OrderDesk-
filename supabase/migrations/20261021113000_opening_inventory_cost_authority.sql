begin;

-- Opening inventory is a governed composition of the existing immutable stock
-- movement authority and the existing historical cost-basis ledger. Product
-- creation remains stock-neutral; this command is intentionally service-only so
-- browser/mobile clients cannot bypass Branch, capability or valuation rules.
create or replace function public.apply_sellertray_opening_inventory(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_catalog_item_id uuid,
  p_quantity numeric,
  p_stock_unit_cost numeric,
  p_reference text,
  p_command_id text,
  p_cost_command_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_stock_uom text;
  v_uom_id uuid;
  v_result jsonb;
  v_m public.inventory_movements%rowtype;
  v_cost numeric(24,8);
  v_currency text;
  v_reason constant text := 'Opening inventory cost basis';
  v_existing public.sellertray_inventory_cost_basis_evidence%rowtype;
  v_current_evidence_id uuid;
  v_evidence_id uuid;
begin
  if p_tenant_id is null or p_branch_id is null or p_catalog_item_id is null
     or p_actor_user_id is null or p_cost_command_id is null
     or p_quantity is null or p_quantity<=0
     or p_stock_unit_cost is null or p_stock_unit_cost<0
     or v_reference is null or nullif(btrim(coalesce(p_command_id,'')),'') is null then
    raise exception 'Business, Branch, product, positive opening quantity, Stock-UOM unit cost, reference, command and actor are required' using errcode='22023';
  end if;
  if char_length(v_reference)>160 then
    raise exception 'Opening inventory reference is too long' using errcode='22023';
  end if;

  -- Historical cost evidence is a management authority even though the stock
  -- receipt itself also enforces can_receive_stock and operational Branch access.
  if not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,p_actor_user_id)
     or not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_adjust_stock')
     or not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_manage_purchasing') then
    raise exception 'You do not have permission to establish opening inventory cost for this Branch' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  -- Resolve Stock UOM on the server. Opening cost is always cost per Stock UOM;
  -- an alternate-UOM conversion supplied by a client is never trusted here.
  select ci.stock_uom,u.id
    into v_stock_uom,v_uom_id
  from public.catalog_items ci
  join public.catalog_item_uoms u
    on u.tenant_id=ci.tenant_id
   and u.catalog_item_id=ci.id
   and lower(btrim(u.uom_name))=lower(btrim(ci.stock_uom))
   and u.conversion_factor=1
  where ci.tenant_id=p_tenant_id
    and ci.id=p_catalog_item_id
    and ci.is_active=true
  order by u.created_at,u.id
  limit 1;

  if v_uom_id is null then
    raise exception 'Product Stock UOM is unavailable for opening inventory' using errcode='23514';
  end if;

  -- The existing receive authority classifies reason=Opening stock as the
  -- native opening movement, protects first-movement semantics and owns command
  -- idempotency/business_at decoding.
  v_result := public.apply_sellertray_inventory_operation(
    p_tenant_id,p_branch_id,p_catalog_item_id,v_uom_id,
    'receive',p_quantity,null,v_reference,'Opening stock',p_command_id,p_actor_user_id
  );

  if coalesce(v_result->>'movementId','')='' or coalesce(v_result->>'operation','')<>'receive' then
    raise exception 'SellerTray could not establish the opening stock movement' using errcode='23514';
  end if;

  select * into v_m
  from public.inventory_movements m
  where m.id=(v_result->>'movementId')::uuid
    and m.tenant_id=p_tenant_id
    and m.branch_id=p_branch_id
    and m.catalog_item_id=p_catalog_item_id
  for update;

  if not found or v_m.movement_type<>'opening' or v_m.quantity_delta<=0
     or lower(btrim(v_m.stock_uom))<>lower(btrim(v_stock_uom))
     or v_m.conversion_factor<>1 then
    raise exception 'Opening inventory movement did not satisfy governed Stock-UOM rules' using errcode='23514';
  end if;

  v_cost := round(p_stock_unit_cost::numeric,8);
  select upper(t.currency) into v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Business currency is unavailable for inventory valuation' using errcode='23514';
  end if;

  -- Cost evidence command identity is independent from quantity command identity
  -- so both sides can prove exact replay without creating a parallel ledger.
  select * into v_existing
  from public.sellertray_inventory_cost_basis_evidence e
  where e.tenant_id=p_tenant_id and e.command_id=p_cost_command_id;
  if found then
    if v_existing.inventory_movement_id=v_m.id
       and v_existing.stock_unit_cost=v_cost
       and v_existing.reference=v_reference
       and v_existing.reason=v_reason
       and v_existing.supersedes_evidence_id is null then
      v_evidence_id := v_existing.id;
    else
      raise exception 'Opening inventory cost command was already used for different facts' using errcode='23505';
    end if;
  else
    select cb.evidence_id into v_current_evidence_id
    from public.sellertray_current_inventory_cost_basis(p_tenant_id,v_m.id) cb;
    if v_current_evidence_id is not null then
      raise exception 'Opening inventory already has governed cost-basis evidence' using errcode='23514';
    end if;

    insert into public.sellertray_inventory_cost_basis_evidence(
      tenant_id,branch_id,stock_location_id,catalog_item_id,inventory_movement_id,
      stock_unit_cost,currency,reference,reason,command_id,supersedes_evidence_id,actor_user_id
    ) values(
      p_tenant_id,v_m.branch_id,v_m.stock_location_id,v_m.catalog_item_id,v_m.id,
      v_cost,v_currency,v_reference,v_reason,p_cost_command_id,null,p_actor_user_id
    ) returning id into v_evidence_id;
    -- The existing after-insert trigger deterministically rebuilds valuation from
    -- the opening movement's business_at, repairing all later COGS if backdated.
  end if;

  return v_result || jsonb_build_object(
    'costEvidenceId',v_evidence_id,
    'stockUnitCost',v_cost,
    'currency',v_currency,
    'valuationSource','historical_cost_basis'
  );
end;
$$;

revoke all on function public.apply_sellertray_opening_inventory(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.apply_sellertray_opening_inventory(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid)
  to service_role;

commit;
