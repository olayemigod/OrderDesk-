begin;

-- Historical cost evidence resolves legitimate valuation gaps without mutating
-- SellerTray's immutable quantity ledger. Evidence is append-only; corrections
-- supersede prior evidence and deterministically replay later valuation/COGS.
create table public.sellertray_inventory_cost_basis_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  stock_location_id uuid not null,
  catalog_item_id uuid not null,
  inventory_movement_id uuid not null,
  stock_unit_cost numeric(24,8) not null check (stock_unit_cost >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reference text not null check (char_length(btrim(reference)) between 1 and 160),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  command_id uuid not null,
  supersedes_evidence_id uuid,
  actor_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint sellertray_inventory_cost_basis_evidence_tenant_id_id_key unique (tenant_id,id),
  constraint sellertray_inventory_cost_basis_evidence_command_key unique (tenant_id,command_id),
  constraint sellertray_inventory_cost_basis_evidence_supersedes_once unique (supersedes_evidence_id),
  constraint sellertray_inventory_cost_basis_evidence_position_fk
    foreign key (tenant_id,branch_id,stock_location_id)
    references public.stock_locations(tenant_id,branch_id,id) on delete restrict,
  constraint sellertray_inventory_cost_basis_evidence_item_fk
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id) on delete restrict,
  constraint sellertray_inventory_cost_basis_evidence_movement_fk
    foreign key (tenant_id,inventory_movement_id)
    references public.inventory_movements(tenant_id,id) on delete cascade,
  constraint sellertray_inventory_cost_basis_evidence_supersedes_fk
    foreign key (tenant_id,supersedes_evidence_id)
    references public.sellertray_inventory_cost_basis_evidence(tenant_id,id) on delete cascade
);

create index sellertray_inventory_cost_basis_evidence_position_idx
  on public.sellertray_inventory_cost_basis_evidence(tenant_id,branch_id,stock_location_id);
create index sellertray_inventory_cost_basis_evidence_item_idx
  on public.sellertray_inventory_cost_basis_evidence(tenant_id,catalog_item_id);
create index sellertray_inventory_cost_basis_evidence_movement_idx
  on public.sellertray_inventory_cost_basis_evidence(tenant_id,inventory_movement_id,created_at,id);
create index sellertray_inventory_cost_basis_evidence_supersedes_idx
  on public.sellertray_inventory_cost_basis_evidence(tenant_id,supersedes_evidence_id)
  where supersedes_evidence_id is not null;

alter table public.sellertray_inventory_cost_basis_evidence enable row level security;
revoke all on public.sellertray_inventory_cost_basis_evidence from public,anon,authenticated;
grant select on public.sellertray_inventory_cost_basis_evidence to service_role;

create or replace function public.prevent_sellertray_inventory_cost_basis_evidence_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    -- Preserve normal immutability while allowing whole-business lifecycle deletion.
    if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
      return old;
    end if;
    raise exception 'Inventory cost-basis evidence is immutable; append a correcting evidence record instead' using errcode='55000';
  end if;
  raise exception 'Inventory cost-basis evidence is immutable; append a correcting evidence record instead' using errcode='55000';
end;
$$;
revoke all on function public.prevent_sellertray_inventory_cost_basis_evidence_mutation() from public,anon,authenticated;

create trigger prevent_sellertray_inventory_cost_basis_evidence_mutation
before update or delete on public.sellertray_inventory_cost_basis_evidence
for each row execute function public.prevent_sellertray_inventory_cost_basis_evidence_mutation();

create or replace function public.sellertray_current_inventory_cost_basis(
  p_tenant_id uuid,
  p_inventory_movement_id uuid
)
returns table(
  evidence_id uuid,
  stock_unit_cost numeric,
  currency text,
  reference text,
  reason text,
  actor_user_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select e.id,e.stock_unit_cost,e.currency,e.reference,e.reason,e.actor_user_id,e.created_at
  from public.sellertray_inventory_cost_basis_evidence e
  where e.tenant_id=p_tenant_id
    and e.inventory_movement_id=p_inventory_movement_id
    and not exists(
      select 1
      from public.sellertray_inventory_cost_basis_evidence n
      where n.tenant_id=e.tenant_id and n.supersedes_evidence_id=e.id
    )
  order by e.created_at desc,e.id desc
  limit 1;
$$;
revoke all on function public.sellertray_current_inventory_cost_basis(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellertray_current_inventory_cost_basis(uuid,uuid) to service_role;

-- Extend the existing deterministic valuation replay at its one explicit
-- unvalued-positive-inbound boundary. Fail closed if the expected implementation
-- anchor has drifted rather than silently creating a second valuation model.
do $$
declare
  v_definition text;
  v_anchor text := E'    elsif v_m.quantity_delta>0 then\n      v_unvalued_delta:=v_m.quantity_delta;\n      v_source_name:=''unvalued_inbound'';\n\n    else';
  v_replacement text := E'    elsif v_m.quantity_delta>0 then\n      select cb.stock_unit_cost,upper(cb.currency)\n      into v_stock_unit_cost,v_cost_currency\n      from public.sellertray_current_inventory_cost_basis(v_m.tenant_id,v_m.id) cb;\n      if found then\n        if v_cost_currency<>v_currency then\n          raise exception ''Historical inventory cost evidence currency differs from business currency'' using errcode=''23514'';\n        end if;\n        v_valued_delta:=v_m.quantity_delta;\n        v_value_delta:=round((v_m.quantity_delta*v_stock_unit_cost)::numeric,6);\n        v_known_unit_cost:=v_stock_unit_cost;\n        v_source_name:=''historical_cost_basis'';\n      else\n        v_unvalued_delta:=v_m.quantity_delta;\n        v_source_name:=''unvalued_inbound'';\n      end if;\n\n    else';
begin
  select pg_get_functiondef('public.rebuild_sellertray_inventory_valuation(uuid,uuid)'::regprocedure)
  into v_definition;
  if v_definition is null
     or (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1 then
    raise exception 'SellerTray valuation replay implementation has drifted; cost-basis convergence requires review' using errcode='55000';
  end if;
  execute replace(v_definition,v_anchor,v_replacement);
end;
$$;

create or replace function public.rebuild_sellertray_inventory_valuation_from_cost_basis()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.rebuild_sellertray_inventory_valuation(new.tenant_id,new.catalog_item_id);
  return new;
end;
$$;
revoke all on function public.rebuild_sellertray_inventory_valuation_from_cost_basis() from public,anon,authenticated;

create trigger rebuild_sellertray_inventory_valuation_after_cost_basis
  after insert on public.sellertray_inventory_cost_basis_evidence
  for each row execute function public.rebuild_sellertray_inventory_valuation_from_cost_basis();

create or replace function public.get_sellertray_inventory_valuation_authority(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(can_manage_historical_cost boolean)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  return query
  select
    public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id)
    and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_adjust_stock')
    and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_purchasing');
end;
$$;
revoke all on function public.get_sellertray_inventory_valuation_authority(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_inventory_valuation_authority(uuid,uuid) to authenticated,service_role;

create or replace function public.get_sellertray_inventory_cost_basis_candidates(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_limit integer default 100
)
returns table(
  movement_id uuid,
  catalog_item_id uuid,
  item_name text,
  sku text,
  movement_type text,
  quantity_delta numeric,
  stock_uom text,
  business_at timestamptz,
  reference_type text,
  reference_id text,
  valuation_source text,
  current_evidence_id uuid,
  current_stock_unit_cost numeric,
  currency text,
  evidence_reference text,
  evidence_reason text,
  evidence_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_can_manage boolean := false;
  v_can_report boolean := false;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to this Branch' using errcode='42501';
  end if;
  v_can_manage := public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_adjust_stock')
    and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_manage_purchasing');
  v_can_report := public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports');
  if not (v_can_manage or v_can_report) then
    raise exception 'You do not have permission to review inventory cost evidence' using errcode='42501';
  end if;

  return query
  select
    im.id,im.catalog_item_id,ci.name,ci.sku,im.movement_type,im.quantity_delta,im.stock_uom,
    im.business_at,im.reference_type,im.reference_id,ve.valuation_source,
    cb.evidence_id,cb.stock_unit_cost,coalesce(cb.currency,upper(t.currency)),
    cb.reference,cb.reason,cb.created_at
  from public.inventory_movements im
  join public.catalog_items ci on ci.tenant_id=im.tenant_id and ci.id=im.catalog_item_id
  join public.tenants t on t.id=im.tenant_id
  left join public.sellertray_inventory_valuation_entries ve on ve.movement_id=im.id
  left join lateral public.sellertray_current_inventory_cost_basis(im.tenant_id,im.id) cb on true
  where im.tenant_id=p_tenant_id
    and im.branch_id=p_branch_id
    and im.quantity_delta>0
    and im.movement_type in ('opening','adjustment','count_reconciliation','purchase_receipt')
    and (
      cb.evidence_id is not null
      or ve.valuation_source in ('unvalued_inbound','purchase_receipt_without_cost')
    )
    and not exists(
      select 1 from public.sellertray_purchase_receipt_items ri
      where ri.tenant_id=im.tenant_id and ri.inventory_movement_id=im.id
    )
  order by im.business_at desc,im.created_at desc,im.id desc
  limit greatest(1,least(coalesce(p_limit,100),500));
end;
$$;
revoke all on function public.get_sellertray_inventory_cost_basis_candidates(uuid,uuid,integer) from public,anon;
grant execute on function public.get_sellertray_inventory_cost_basis_candidates(uuid,uuid,integer) to authenticated,service_role;

create or replace function public.record_sellertray_inventory_cost_basis(
  p_tenant_id uuid,
  p_inventory_movement_id uuid,
  p_stock_unit_cost numeric,
  p_reference text,
  p_reason text,
  p_command_id uuid,
  p_supersedes_evidence_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
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
$$;
revoke all on function public.record_sellertray_inventory_cost_basis(uuid,uuid,numeric,text,text,uuid,uuid) from public,anon;
grant execute on function public.record_sellertray_inventory_cost_basis(uuid,uuid,numeric,text,text,uuid,uuid) to authenticated,service_role;

commit;
