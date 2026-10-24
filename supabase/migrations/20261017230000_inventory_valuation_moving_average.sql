begin;

-- SellerTray valuation is a derived/rebuildable layer over the immutable quantity ledger.
-- Historical stock without governed cost evidence remains explicitly unvalued.
alter table public.sellertray_purchase_receipt_items
  add column if not exists unit_cost numeric(18,2),
  add column if not exists stock_unit_cost numeric(24,8),
  add column if not exists currency text;

update public.sellertray_purchase_receipt_items ri
set unit_cost = poi.unit_cost,
    stock_unit_cost = round((poi.unit_cost / nullif(ri.conversion_factor,0))::numeric,8),
    currency = upper(po.currency)
from public.sellertray_purchase_order_items poi
join public.sellertray_purchase_orders po
  on po.tenant_id=poi.tenant_id and po.id=poi.purchase_order_id
where poi.tenant_id=ri.tenant_id
  and poi.id=ri.purchase_order_item_id
  and (ri.unit_cost is null or ri.stock_unit_cost is null or ri.currency is null);

alter table public.sellertray_purchase_receipt_items
  alter column unit_cost set not null,
  alter column stock_unit_cost set not null,
  alter column currency set not null;

alter table public.sellertray_purchase_receipt_items
  drop constraint if exists sellertray_purchase_receipt_items_unit_cost_check,
  add constraint sellertray_purchase_receipt_items_unit_cost_check check (unit_cost >= 0),
  drop constraint if exists sellertray_purchase_receipt_items_stock_unit_cost_check,
  add constraint sellertray_purchase_receipt_items_stock_unit_cost_check check (stock_unit_cost >= 0),
  drop constraint if exists sellertray_purchase_receipt_items_currency_check,
  add constraint sellertray_purchase_receipt_items_currency_check check (currency ~ '^[A-Z]{3}$');

create table public.sellertray_inventory_valuation_entries (
  movement_id uuid primary key references public.inventory_movements(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  stock_location_id uuid not null,
  catalog_item_id uuid not null,
  movement_type text not null,
  business_at timestamptz not null,
  movement_created_at timestamptz not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  quantity_delta numeric(18,6) not null,
  valued_quantity_delta numeric(18,6) not null,
  unvalued_quantity_delta numeric(18,6) not null,
  value_delta numeric(24,6) not null,
  known_unit_cost numeric(24,8),
  cogs_amount numeric(24,6),
  cogs_complete boolean,
  valuation_status text not null check (valuation_status in ('valued','partial','unvalued')),
  valuation_source text not null,
  quantity_balance numeric(18,6) not null,
  valued_quantity_balance numeric(18,6) not null,
  unvalued_quantity_balance numeric(18,6) not null,
  known_value_balance numeric(24,6) not null,
  average_unit_cost_after numeric(24,8),
  balance_status text not null check (balance_status in ('empty','valued','partial','unvalued')),
  recalculated_at timestamptz not null default now(),
  constraint sellertray_inventory_valuation_entry_position_fk
    foreign key (tenant_id,branch_id,stock_location_id)
    references public.stock_locations(tenant_id,branch_id,id) on delete restrict,
  constraint sellertray_inventory_valuation_entry_item_fk
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id) on delete restrict
);

create index sellertray_inventory_valuation_entries_replay_idx
  on public.sellertray_inventory_valuation_entries(
    tenant_id,catalog_item_id,business_at,movement_created_at,movement_id
  );
create index sellertray_inventory_valuation_entries_branch_idx
  on public.sellertray_inventory_valuation_entries(
    tenant_id,branch_id,catalog_item_id,business_at,movement_created_at,movement_id
  );

create table public.sellertray_inventory_valuation_state (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  stock_location_id uuid not null,
  catalog_item_id uuid not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  quantity_on_hand numeric(18,6) not null,
  valued_quantity_on_hand numeric(18,6) not null,
  unvalued_quantity_on_hand numeric(18,6) not null,
  known_inventory_value numeric(24,6) not null,
  average_unit_cost numeric(24,8),
  valuation_status text not null check (valuation_status in ('empty','valued','partial','unvalued')),
  last_business_at timestamptz,
  last_movement_id uuid references public.inventory_movements(id) on delete restrict,
  recalculated_at timestamptz not null default now(),
  primary key (tenant_id,branch_id,stock_location_id,catalog_item_id),
  constraint sellertray_inventory_valuation_state_position_fk
    foreign key (tenant_id,branch_id,stock_location_id)
    references public.stock_locations(tenant_id,branch_id,id) on delete restrict,
  constraint sellertray_inventory_valuation_state_item_fk
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id) on delete restrict
);

alter table public.sellertray_inventory_valuation_entries enable row level security;
alter table public.sellertray_inventory_valuation_state enable row level security;
revoke all on public.sellertray_inventory_valuation_entries from public,anon,authenticated;
revoke all on public.sellertray_inventory_valuation_state from public,anon,authenticated;
grant select on public.sellertray_inventory_valuation_entries to service_role;
grant select on public.sellertray_inventory_valuation_state to service_role;

create index if not exists inventory_movements_valuation_replay_idx
  on public.inventory_movements(tenant_id,catalog_item_id,business_at,created_at,id);

create or replace function public.snapshot_sellertray_purchase_receipt_cost()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_unit_cost numeric(18,2);
  v_po_conversion numeric(18,6);
  v_po_currency text;
  v_tenant_currency text;
begin
  select poi.unit_cost,poi.conversion_factor,upper(po.currency),upper(t.currency)
  into v_unit_cost,v_po_conversion,v_po_currency,v_tenant_currency
  from public.sellertray_purchase_order_items poi
  join public.sellertray_purchase_orders po
    on po.tenant_id=poi.tenant_id and po.id=poi.purchase_order_id
  join public.tenants t on t.id=poi.tenant_id
  where poi.tenant_id=new.tenant_id and poi.id=new.purchase_order_item_id;

  if not found or v_unit_cost is null or v_po_conversion is null or v_po_conversion<=0 then
    raise exception 'Purchase receipt cost evidence is unavailable' using errcode='23514';
  end if;
  if new.conversion_factor is null or abs(new.conversion_factor-v_po_conversion)>0.000001 then
    raise exception 'Purchase receipt conversion no longer matches the Purchase Order snapshot' using errcode='23514';
  end if;
  if v_po_currency is null or v_tenant_currency is null or v_po_currency<>v_tenant_currency then
    raise exception 'Purchase receipt valuation requires the business currency; FX valuation is not configured' using errcode='23514';
  end if;

  new.unit_cost := v_unit_cost;
  new.stock_unit_cost := round((v_unit_cost/new.conversion_factor)::numeric,8);
  new.currency := v_po_currency;
  return new;
end;
$$;

revoke all on function public.snapshot_sellertray_purchase_receipt_cost() from public,anon,authenticated;

create or replace function public.rebuild_sellertray_inventory_valuation(
  p_tenant_id uuid,
  p_catalog_item_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_currency text;
  v_m record;
  v_source record;
  v_qty numeric(18,6);
  v_valued_qty numeric(18,6);
  v_unvalued_qty numeric(18,6);
  v_known_value numeric(24,6);
  v_valued_delta numeric(18,6);
  v_unvalued_delta numeric(18,6);
  v_value_delta numeric(24,6);
  v_known_unit_cost numeric(24,8);
  v_cogs numeric(24,6);
  v_cogs_complete boolean;
  v_entry_status text;
  v_balance_status text;
  v_source_name text;
  v_stock_unit_cost numeric(24,8);
  v_cost_currency text;
  v_out_qty numeric(18,6);
  v_available_qty numeric(18,6);
  v_ratio numeric;
  v_epsilon numeric := 0.000001;
begin
  if p_tenant_id is null or p_catalog_item_id is null then
    raise exception 'Business and product are required for inventory valuation rebuild' using errcode='22023';
  end if;

  select upper(t.currency) into v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Business currency is unavailable for inventory valuation' using errcode='23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    hashtextextended('sellertray-valuation:'||p_tenant_id::text||':'||p_catalog_item_id::text,0)
  );

  delete from public.sellertray_inventory_valuation_entries
  where tenant_id=p_tenant_id and catalog_item_id=p_catalog_item_id;
  delete from public.sellertray_inventory_valuation_state
  where tenant_id=p_tenant_id and catalog_item_id=p_catalog_item_id;

  for v_m in
    select im.*
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id and im.catalog_item_id=p_catalog_item_id
    order by im.business_at,im.created_at,im.id
  loop
    select s.quantity_on_hand,s.valued_quantity_on_hand,s.unvalued_quantity_on_hand,s.known_inventory_value
    into v_qty,v_valued_qty,v_unvalued_qty,v_known_value
    from public.sellertray_inventory_valuation_state s
    where s.tenant_id=v_m.tenant_id
      and s.branch_id=v_m.branch_id
      and s.stock_location_id=v_m.stock_location_id
      and s.catalog_item_id=v_m.catalog_item_id;

    if not found then
      v_qty:=0; v_valued_qty:=0; v_unvalued_qty:=0; v_known_value:=0;
    end if;

    v_valued_delta:=0;
    v_unvalued_delta:=0;
    v_value_delta:=0;
    v_known_unit_cost:=null;
    v_cogs:=null;
    v_cogs_complete:=null;
    v_source_name:='unvalued';

    if v_m.movement_type='reversal' then
      select ve.valued_quantity_delta,ve.unvalued_quantity_delta,ve.value_delta,
             ve.cogs_amount,ve.cogs_complete,ve.known_unit_cost
      into v_source
      from public.sellertray_inventory_valuation_entries ve
      where ve.movement_id=v_m.reversal_of_movement_id;
      if not found then
        raise exception 'Inventory valuation cannot replay reversal % before its source movement',v_m.id using errcode='23514';
      end if;
      v_valued_delta := -v_source.valued_quantity_delta;
      v_unvalued_delta := -v_source.unvalued_quantity_delta;
      v_value_delta := -v_source.value_delta;
      v_known_unit_cost := v_source.known_unit_cost;
      v_cogs := case when v_source.cogs_amount is null then null else -v_source.cogs_amount end;
      v_cogs_complete := v_source.cogs_complete;
      v_source_name := 'reversal';

    elsif v_m.quantity_delta>0 and v_m.movement_type='purchase_receipt' then
      select ri.stock_unit_cost,upper(ri.currency)
      into v_stock_unit_cost,v_cost_currency
      from public.sellertray_purchase_receipt_items ri
      where ri.tenant_id=v_m.tenant_id and ri.inventory_movement_id=v_m.id
      limit 1;
      if found then
        if v_cost_currency<>v_currency then
          raise exception 'Purchase receipt valuation currency differs from business currency' using errcode='23514';
        end if;
        v_valued_delta:=v_m.quantity_delta;
        v_value_delta:=round((v_m.quantity_delta*v_stock_unit_cost)::numeric,6);
        v_known_unit_cost:=v_stock_unit_cost;
        v_source_name:='purchase_receipt_cost';
      else
        v_unvalued_delta:=v_m.quantity_delta;
        v_source_name:='purchase_receipt_without_cost';
      end if;

    elsif v_m.quantity_delta>0 and v_m.movement_type='transfer_in' then
      select ve.valued_quantity_delta,ve.unvalued_quantity_delta,ve.value_delta,im.quantity_delta
      into v_source
      from public.sellertray_inventory_valuation_entries ve
      join public.inventory_movements im on im.id=ve.movement_id
      where im.tenant_id=v_m.tenant_id
        and im.catalog_item_id=v_m.catalog_item_id
        and im.movement_type='transfer_out'
        and im.reference_type=v_m.reference_type
        and im.reference_id=v_m.reference_id
      order by im.business_at desc,im.created_at desc,im.id desc
      limit 1;
      if found and abs(v_source.quantity_delta)>v_epsilon then
        v_ratio:=v_m.quantity_delta/abs(v_source.quantity_delta);
        v_valued_delta:=round((-v_source.valued_quantity_delta*v_ratio)::numeric,6);
        v_unvalued_delta:=round((-v_source.unvalued_quantity_delta*v_ratio)::numeric,6);
        v_value_delta:=round((-v_source.value_delta*v_ratio)::numeric,6);
        v_known_unit_cost:=case when abs(v_valued_delta)>v_epsilon then round((v_value_delta/v_valued_delta)::numeric,8) else null end;
        v_source_name:='transfer_preserved';
      else
        v_unvalued_delta:=v_m.quantity_delta;
        v_source_name:='transfer_without_source_value';
      end if;

    elsif v_m.quantity_delta>0 and v_m.movement_type='sale_return' then
      select ve.valued_quantity_delta,ve.unvalued_quantity_delta,ve.value_delta,
             ve.cogs_complete,im.quantity_delta
      into v_source
      from public.sellertray_inventory_valuation_entries ve
      join public.inventory_movements im on im.id=ve.movement_id
      where im.tenant_id=v_m.tenant_id
        and im.catalog_item_id=v_m.catalog_item_id
        and im.movement_type='sale'
        and im.metadata->>'order_item_id'=v_m.metadata->>'order_item_id'
      order by im.business_at,im.created_at,im.id
      limit 1;
      if found and abs(v_source.quantity_delta)>v_epsilon then
        v_ratio:=v_m.quantity_delta/abs(v_source.quantity_delta);
        v_valued_delta:=round((abs(v_source.valued_quantity_delta)*v_ratio)::numeric,6);
        v_unvalued_delta:=round((abs(v_source.unvalued_quantity_delta)*v_ratio)::numeric,6);
        v_value_delta:=round((abs(v_source.value_delta)*v_ratio)::numeric,6);
        v_known_unit_cost:=case when v_valued_delta>v_epsilon then round((v_value_delta/v_valued_delta)::numeric,8) else null end;
        v_cogs:=-v_value_delta;
        v_cogs_complete:=v_source.cogs_complete;
        v_source_name:='sale_return_history';
      else
        v_unvalued_delta:=v_m.quantity_delta;
        v_cogs:=0;
        v_cogs_complete:=false;
        v_source_name:='sale_return_without_sale_value';
      end if;

    elsif v_m.quantity_delta>0 then
      v_unvalued_delta:=v_m.quantity_delta;
      v_source_name:='unvalued_inbound';

    else
      v_out_qty:=abs(v_m.quantity_delta);
      if v_qty>v_epsilon then
        v_available_qty:=least(v_out_qty,v_qty);
        v_valued_delta:=-round((v_available_qty*v_valued_qty/v_qty)::numeric,6);
        v_unvalued_delta:=-round((v_available_qty*v_unvalued_qty/v_qty)::numeric,6);
        if v_out_qty>v_available_qty then
          v_unvalued_delta:=v_unvalued_delta-(v_out_qty-v_available_qty);
        end if;
        v_value_delta:=-round((v_known_value*v_available_qty/v_qty)::numeric,6);
      else
        v_unvalued_delta:=-v_out_qty;
        v_value_delta:=0;
      end if;
      v_known_unit_cost:=case when abs(v_valued_delta)>v_epsilon then round((abs(v_value_delta)/abs(v_valued_delta))::numeric,8) else null end;
      if abs(v_unvalued_delta)<=v_epsilon then
        v_source_name:='moving_weighted_average';
      elsif abs(v_valued_delta)<=v_epsilon then
        v_source_name:='unvalued_outbound';
      else
        v_source_name:='partial_moving_weighted_average';
      end if;
      if v_m.movement_type='sale' then
        v_cogs:=-v_value_delta;
        v_cogs_complete:=abs(v_unvalued_delta)<=v_epsilon and v_out_qty<=greatest(v_qty,0)+v_epsilon;
      end if;
    end if;

    if abs(v_unvalued_delta)<=v_epsilon then
      v_entry_status:='valued';
    elsif abs(v_valued_delta)<=v_epsilon then
      v_entry_status:='unvalued';
    else
      v_entry_status:='partial';
    end if;

    v_qty:=round((v_qty+v_m.quantity_delta)::numeric,6);
    v_valued_qty:=round((v_valued_qty+v_valued_delta)::numeric,6);
    v_unvalued_qty:=round((v_unvalued_qty+v_unvalued_delta)::numeric,6);
    v_known_value:=round((v_known_value+v_value_delta)::numeric,6);

    if abs(v_qty)<=v_epsilon then v_qty:=0; end if;
    if abs(v_valued_qty)<=v_epsilon then v_valued_qty:=0; end if;
    if abs(v_unvalued_qty)<=v_epsilon then v_unvalued_qty:=0; end if;
    if abs(v_known_value)<=v_epsilon then v_known_value:=0; end if;

    if v_qty=0 then
      v_balance_status:='empty';
    elsif v_qty<0 then
      v_balance_status:='unvalued';
    elsif v_unvalued_qty=0 and v_valued_qty>0 then
      v_balance_status:='valued';
    elsif v_valued_qty<=0 then
      v_balance_status:='unvalued';
    else
      v_balance_status:='partial';
    end if;

    insert into public.sellertray_inventory_valuation_entries(
      movement_id,tenant_id,branch_id,stock_location_id,catalog_item_id,movement_type,
      business_at,movement_created_at,currency,quantity_delta,valued_quantity_delta,
      unvalued_quantity_delta,value_delta,known_unit_cost,cogs_amount,cogs_complete,
      valuation_status,valuation_source,quantity_balance,valued_quantity_balance,
      unvalued_quantity_balance,known_value_balance,average_unit_cost_after,balance_status,recalculated_at
    ) values(
      v_m.id,v_m.tenant_id,v_m.branch_id,v_m.stock_location_id,v_m.catalog_item_id,v_m.movement_type,
      v_m.business_at,v_m.created_at,v_currency,v_m.quantity_delta,v_valued_delta,
      v_unvalued_delta,v_value_delta,v_known_unit_cost,v_cogs,v_cogs_complete,
      v_entry_status,v_source_name,v_qty,v_valued_qty,v_unvalued_qty,v_known_value,
      case when v_balance_status='valued' and v_qty>0 then round((v_known_value/v_qty)::numeric,8) else null end,
      v_balance_status,now()
    );

    insert into public.sellertray_inventory_valuation_state(
      tenant_id,branch_id,stock_location_id,catalog_item_id,currency,quantity_on_hand,
      valued_quantity_on_hand,unvalued_quantity_on_hand,known_inventory_value,average_unit_cost,
      valuation_status,last_business_at,last_movement_id,recalculated_at
    ) values(
      v_m.tenant_id,v_m.branch_id,v_m.stock_location_id,v_m.catalog_item_id,v_currency,v_qty,
      v_valued_qty,v_unvalued_qty,v_known_value,
      case when v_balance_status='valued' and v_qty>0 then round((v_known_value/v_qty)::numeric,8) else null end,
      v_balance_status,v_m.business_at,v_m.id,now()
    ) on conflict (tenant_id,branch_id,stock_location_id,catalog_item_id) do update
      set currency=excluded.currency,
          quantity_on_hand=excluded.quantity_on_hand,
          valued_quantity_on_hand=excluded.valued_quantity_on_hand,
          unvalued_quantity_on_hand=excluded.unvalued_quantity_on_hand,
          known_inventory_value=excluded.known_inventory_value,
          average_unit_cost=excluded.average_unit_cost,
          valuation_status=excluded.valuation_status,
          last_business_at=excluded.last_business_at,
          last_movement_id=excluded.last_movement_id,
          recalculated_at=excluded.recalculated_at;
  end loop;
end;
$$;

revoke all on function public.rebuild_sellertray_inventory_valuation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rebuild_sellertray_inventory_valuation(uuid,uuid) to service_role;

create or replace function public.rebuild_sellertray_inventory_valuation_from_movement()
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
revoke all on function public.rebuild_sellertray_inventory_valuation_from_movement() from public,anon,authenticated;

create or replace function public.rebuild_sellertray_inventory_valuation_from_receipt_item()
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
revoke all on function public.rebuild_sellertray_inventory_valuation_from_receipt_item() from public,anon,authenticated;

create trigger snapshot_sellertray_purchase_receipt_cost
before insert on public.sellertray_purchase_receipt_items
for each row execute function public.snapshot_sellertray_purchase_receipt_cost();

create trigger rebuild_sellertray_inventory_valuation_after_movement
after insert on public.inventory_movements
for each row execute function public.rebuild_sellertray_inventory_valuation_from_movement();

create trigger rebuild_sellertray_inventory_valuation_after_receipt_item
after insert on public.sellertray_purchase_receipt_items
for each row execute function public.rebuild_sellertray_inventory_valuation_from_receipt_item();

create or replace function public.prevent_sellertray_purchase_receipt_cost_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.unit_cost is distinct from old.unit_cost
     or new.stock_unit_cost is distinct from old.stock_unit_cost
     or new.currency is distinct from old.currency then
    raise exception 'Purchase receipt cost snapshot is immutable' using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_sellertray_purchase_receipt_cost_mutation() from public,anon,authenticated;
create trigger prevent_sellertray_purchase_receipt_cost_mutation
before update on public.sellertray_purchase_receipt_items
for each row execute function public.prevent_sellertray_purchase_receipt_cost_mutation();

create or replace function public.get_sellertray_branch_stock_as_of(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_as_of timestamptz
)
returns table(
  catalog_item_id uuid,item_name text,sku text,category text,stock_uom text,
  quantity_on_hand numeric,last_movement_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if p_tenant_id is null or p_branch_id is null or p_as_of is null then
    raise exception 'Business, Branch and as-of time are required' using errcode='22023';
  end if;
  if current_user<>'postgres' and coalesce((select auth.role()),'')<>'service_role'
     and not public.sellertray_current_user_can_read_branch(p_tenant_id,p_branch_id) then
    raise exception 'You do not have access to this Branch' using errcode='42501';
  end if;

  return query
  select ci.id,ci.name,ci.sku,ci.category,ci.stock_uom,
         coalesce(sum(im.quantity_delta),0)::numeric,
         max(im.business_at)
  from public.catalog_items ci
  left join public.inventory_movements im
    on im.tenant_id=ci.tenant_id and im.catalog_item_id=ci.id
   and im.branch_id=p_branch_id and im.business_at<=p_as_of
  where ci.tenant_id=p_tenant_id
    and (ci.is_active or im.id is not null)
  group by ci.id,ci.name,ci.sku,ci.category,ci.stock_uom
  order by ci.name,ci.id;
end;
$$;
revoke all on function public.get_sellertray_branch_stock_as_of(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.get_sellertray_branch_stock_as_of(uuid,uuid,timestamptz) to authenticated,service_role;

create or replace function public.get_sellertray_branch_stock_valuation(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_as_of timestamptz default now()
)
returns table(
  catalog_item_id uuid,item_name text,sku text,category text,stock_uom text,currency text,
  quantity_on_hand numeric,valued_quantity_on_hand numeric,unvalued_quantity_on_hand numeric,
  known_inventory_value numeric,average_unit_cost numeric,valuation_status text,last_movement_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_tenant_id is null or p_branch_id is null or p_as_of is null then
    raise exception 'Business, Branch and as-of time are required' using errcode='22023';
  end if;
  if current_user<>'postgres' and coalesce((select auth.role()),'')<>'service_role' then
    if v_user_id is null
       or not public.sellertray_current_user_can_read_branch(p_tenant_id,p_branch_id)
       or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
      raise exception 'You do not have permission to view inventory valuation for this Branch' using errcode='42501';
    end if;
  end if;

  return query
  with latest_position as (
    select distinct on (ve.stock_location_id,ve.catalog_item_id)
      ve.stock_location_id,ve.catalog_item_id,ve.currency,
      ve.quantity_balance,ve.valued_quantity_balance,ve.unvalued_quantity_balance,
      ve.known_value_balance,ve.business_at,ve.movement_created_at,ve.movement_id
    from public.sellertray_inventory_valuation_entries ve
    where ve.tenant_id=p_tenant_id and ve.branch_id=p_branch_id and ve.business_at<=p_as_of
    order by ve.stock_location_id,ve.catalog_item_id,ve.business_at desc,ve.movement_created_at desc,ve.movement_id desc
  ), aggregated as (
    select lp.catalog_item_id,max(lp.currency) currency,
           sum(lp.quantity_balance)::numeric quantity_on_hand,
           sum(lp.valued_quantity_balance)::numeric valued_quantity_on_hand,
           sum(lp.unvalued_quantity_balance)::numeric unvalued_quantity_on_hand,
           sum(lp.known_value_balance)::numeric known_inventory_value,
           max(lp.business_at) last_movement_at
    from latest_position lp
    group by lp.catalog_item_id
  )
  select ci.id,ci.name,ci.sku,ci.category,ci.stock_uom,a.currency,
         a.quantity_on_hand,a.valued_quantity_on_hand,a.unvalued_quantity_on_hand,
         a.known_inventory_value,
         case when a.quantity_on_hand>0 and abs(a.unvalued_quantity_on_hand)<=0.000001
              then round((a.known_inventory_value/a.quantity_on_hand)::numeric,8) else null end,
         case when abs(a.quantity_on_hand)<=0.000001 then 'empty'
              when a.quantity_on_hand<0 then 'unvalued'
              when abs(a.unvalued_quantity_on_hand)<=0.000001 then 'valued'
              when a.valued_quantity_on_hand<=0.000001 then 'unvalued'
              else 'partial' end,
         a.last_movement_at
  from aggregated a
  join public.catalog_items ci on ci.tenant_id=p_tenant_id and ci.id=a.catalog_item_id
  order by ci.name,ci.id;
end;
$$;
revoke all on function public.get_sellertray_branch_stock_valuation(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.get_sellertray_branch_stock_valuation(uuid,uuid,timestamptz) to authenticated,service_role;

create or replace function public.get_sellertray_order_profitability(
  p_tenant_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_cogs numeric(24,6) := 0;
  v_entry_count integer := 0;
  v_incomplete integer := 0;
  v_sale_count integer := 0;
  v_net_revenue numeric(24,6);
  v_complete boolean;
  v_profit numeric(24,6);
  v_margin numeric(18,6);
begin
  select * into v_order from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if not found or v_order.branch_id is null then
    raise exception 'Sale not found' using errcode='22023';
  end if;
  if current_user<>'postgres' and coalesce((select auth.role()),'')<>'service_role' then
    if v_user_id is null
       or not public.sellertray_current_user_can_read_branch(p_tenant_id,v_order.branch_id)
       or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
      raise exception 'You do not have permission to view profitability for this sale' using errcode='42501';
    end if;
  end if;

  select count(*)::integer,
         coalesce(sum(ve.cogs_amount),0)::numeric(24,6),
         count(*) filter (where ve.cogs_complete is false)::integer
  into v_entry_count,v_cogs,v_incomplete
  from public.sellertray_inventory_valuation_entries ve
  join public.inventory_movements im on im.id=ve.movement_id
  where im.tenant_id=p_tenant_id
    and ve.cogs_amount is not null
    and (
      (im.movement_type='sale' and im.reference_type='order' and im.reference_id=p_order_id::text)
      or (im.movement_type in ('sale_return','reversal') and im.metadata->>'order_id'=p_order_id::text)
    );

  select count(*)::integer into v_sale_count
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id and im.movement_type='sale'
    and im.reference_type='order' and im.reference_id=p_order_id::text;

  v_net_revenue := (coalesce(v_order.total_amount,0)-coalesce(v_order.returned_amount,0))::numeric(24,6);
  v_complete := v_sale_count>0 and v_entry_count>=v_sale_count and v_incomplete=0;
  if v_complete then
    v_profit:=v_net_revenue-v_cogs;
    v_margin:=case when v_net_revenue<>0 then round((v_profit*100/v_net_revenue)::numeric,6) else null end;
  end if;

  return jsonb_build_object(
    'orderId',v_order.id,
    'publicOrderId',v_order.public_order_id,
    'branchId',v_order.branch_id,
    'currency',v_order.currency,
    'netRevenue',v_net_revenue,
    'knownCogs',v_cogs,
    'cogsComplete',v_complete,
    'grossProfit',v_profit,
    'grossMarginPercent',v_margin
  );
end;
$$;
revoke all on function public.get_sellertray_order_profitability(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_order_profitability(uuid,uuid) to authenticated,service_role;

create or replace function public.get_sellertray_stock_movements(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_catalog_item_id uuid default null,
  p_limit integer default 100
)
returns table(
  id uuid,catalog_item_id uuid,item_name text,movement_type text,quantity_delta numeric,
  stock_uom text,source_uom text,source_quantity numeric,conversion_factor numeric,
  reference_type text,reference_id text,business_at timestamptz,reason text,created_at timestamptz
)
language sql
stable
set search_path=''
as $$
  with branch_access as (
    select 1
    where current_user='postgres'
       or (select auth.role())='service_role'
       or public.sellertray_current_user_can_read_branch(p_tenant_id,p_branch_id)
  )
  select im.id,im.catalog_item_id,ci.name,im.movement_type,im.quantity_delta,
         im.stock_uom,im.source_uom,im.source_quantity,im.conversion_factor,
         im.reference_type,im.reference_id,im.business_at,im.reason,im.created_at
  from branch_access access
  cross join public.inventory_movements im
  join public.catalog_items ci on ci.tenant_id=im.tenant_id and ci.id=im.catalog_item_id
  where im.tenant_id=p_tenant_id and im.branch_id=p_branch_id
    and (p_catalog_item_id is null or im.catalog_item_id=p_catalog_item_id)
  order by im.business_at desc,im.created_at desc,im.id desc
  limit greatest(1,least(coalesce(p_limit,100),500));
$$;

-- Deterministic backfill of all existing products. Historical rows without governed cost evidence remain unvalued.
do $$
declare v record;
begin
  for v in select distinct im.tenant_id,im.catalog_item_id from public.inventory_movements im
  loop
    perform public.rebuild_sellertray_inventory_valuation(v.tenant_id,v.catalog_item_id);
  end loop;
end
$$;

commit;
