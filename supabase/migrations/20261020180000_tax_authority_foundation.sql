begin;

-- SellerTray Tax Authority Foundation
-- Tax is Business settings-governed shared commerce truth. Draft clients may
-- preview tax through a governed read, but posting/finalisation is server-side
-- and snapshots immutable historical facts for payments, returns and reports.

create table public.sellertray_tax_configurations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  revision bigint not null,
  is_active boolean not null default false,
  rate_percent numeric(9,6) not null default 0,
  display_tax_breakdown boolean not null default true,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,revision),
  constraint sellertray_tax_configurations_revision_check check (revision > 0),
  constraint sellertray_tax_configurations_rate_check check (
    rate_percent >= 0 and rate_percent <= 100
    and (not is_active or rate_percent > 0)
  )
);

create index sellertray_tax_configurations_current_idx
  on public.sellertray_tax_configurations(tenant_id,revision desc);

alter table public.sellertray_tax_configurations enable row level security;
revoke all on public.sellertray_tax_configurations from public,anon,authenticated;
grant all on public.sellertray_tax_configurations to service_role;

create or replace function public.prevent_sellertray_tax_configuration_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'SellerTray tax configuration history is immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_tax_configuration_mutation()
  from public,anon,authenticated;

drop trigger if exists prevent_sellertray_tax_configuration_update on public.sellertray_tax_configurations;
create trigger prevent_sellertray_tax_configuration_update
before update or delete on public.sellertray_tax_configurations
for each row execute function public.prevent_sellertray_tax_configuration_mutation();

alter table public.orders
  add column if not exists subtotal_amount numeric(18,2),
  add column if not exists tax_applied boolean,
  add column if not exists tax_configuration_id uuid,
  add column if not exists tax_configuration_revision bigint,
  add column if not exists tax_rate_percent numeric(9,6),
  add column if not exists tax_amount numeric(18,2),
  add column if not exists tax_display_breakdown boolean,
  add column if not exists gross_amount numeric(18,2),
  add column if not exists tax_posted_at timestamptz;

alter table public.orders
  drop constraint if exists orders_tax_configuration_same_tenant,
  add constraint orders_tax_configuration_same_tenant
    foreign key (tenant_id,tax_configuration_id)
    references public.sellertray_tax_configurations(tenant_id,id)
    on delete restrict,
  drop constraint if exists orders_tax_snapshot_check,
  add constraint orders_tax_snapshot_check check (
    (
      tax_posted_at is null
      and subtotal_amount is null
      and tax_applied is null
      and tax_configuration_id is null
      and tax_configuration_revision is null
      and tax_rate_percent is null
      and tax_amount is null
      and tax_display_breakdown is null
      and gross_amount is null
    )
    or
    (
      tax_posted_at is not null
      and subtotal_amount is not null and subtotal_amount >= 0
      and tax_applied is not null
      and tax_rate_percent is not null and tax_rate_percent >= 0 and tax_rate_percent <= 100
      and tax_amount is not null and tax_amount >= 0
      and tax_display_breakdown is not null
      and gross_amount is not null and gross_amount >= 0
      and abs(gross_amount-(subtotal_amount+tax_amount)) < 0.005
      and abs(coalesce(total_amount,0)-gross_amount) < 0.005
      and (
        (tax_configuration_id is null and tax_configuration_revision is null)
        or (tax_configuration_id is not null and tax_configuration_revision is not null)
      )
      and (tax_applied or tax_amount=0)
    )
  );

alter table public.order_items
  add column if not exists tax_basis_amount numeric(18,2),
  add column if not exists tax_rate_percent numeric(9,6),
  add column if not exists tax_amount numeric(18,2),
  add column if not exists gross_line_total numeric(18,2);

alter table public.order_items
  drop constraint if exists order_items_tax_snapshot_check,
  add constraint order_items_tax_snapshot_check check (
    (
      tax_basis_amount is null
      and tax_rate_percent is null
      and tax_amount is null
      and gross_line_total is null
    )
    or
    (
      tax_basis_amount is not null and tax_basis_amount >= 0
      and tax_rate_percent is not null and tax_rate_percent >= 0 and tax_rate_percent <= 100
      and tax_amount is not null and tax_amount >= 0
      and gross_line_total is not null and gross_line_total >= 0
      and abs(gross_line_total-(tax_basis_amount+tax_amount)) < 0.005
    )
  );

alter table public.sale_returns
  add column if not exists subtotal_amount numeric(18,2),
  add column if not exists tax_amount numeric(18,2),
  add column if not exists tax_configuration_id uuid,
  add column if not exists tax_configuration_revision bigint,
  add column if not exists tax_rate_percent numeric(9,6);

alter table public.sale_returns
  drop constraint if exists sale_returns_tax_configuration_same_tenant,
  add constraint sale_returns_tax_configuration_same_tenant
    foreign key (tenant_id,tax_configuration_id)
    references public.sellertray_tax_configurations(tenant_id,id)
    on delete restrict,
  drop constraint if exists sale_returns_tax_snapshot_check,
  add constraint sale_returns_tax_snapshot_check check (
    (subtotal_amount is null and tax_amount is null and tax_rate_percent is null)
    or (
      subtotal_amount is not null and subtotal_amount >= 0
      and tax_amount is not null and tax_amount >= 0
      and tax_rate_percent is not null and tax_rate_percent >= 0 and tax_rate_percent <= 100
      and abs(amount-(subtotal_amount+tax_amount)) < 0.005
      and (
        (tax_configuration_id is null and tax_configuration_revision is null)
        or (tax_configuration_id is not null and tax_configuration_revision is not null)
      )
    )
  );

alter table public.sale_return_items
  add column if not exists subtotal_amount numeric(18,2),
  add column if not exists tax_amount numeric(18,2);

alter table public.sale_return_items
  drop constraint if exists sale_return_items_tax_snapshot_check,
  add constraint sale_return_items_tax_snapshot_check check (
    (subtotal_amount is null and tax_amount is null)
    or (
      subtotal_amount is not null and subtotal_amount >= 0
      and tax_amount is not null and tax_amount >= 0
      and abs(line_total-(subtotal_amount+tax_amount)) < 0.005
    )
  );

-- Existing issued invoices are historical pre-tax SellerTray facts. Snapshot them
-- explicitly as zero-tax rather than applying a newly configured tax retroactively.
update public.order_items oi
set tax_basis_amount=coalesce(oi.line_total,round((oi.quantity*oi.unit_price)::numeric,2)),
    tax_rate_percent=0,
    tax_amount=0,
    gross_line_total=coalesce(oi.line_total,round((oi.quantity*oi.unit_price)::numeric,2))
where exists (
  select 1 from public.order_financial_documents d
  where d.tenant_id=oi.tenant_id
    and d.order_id=oi.order_id
    and d.document_type='invoice'
);

update public.orders o
set subtotal_amount=coalesce((
      select sum(coalesce(oi.tax_basis_amount,oi.line_total,round((oi.quantity*oi.unit_price)::numeric,2)))::numeric(18,2)
      from public.order_items oi
      where oi.tenant_id=o.tenant_id and oi.order_id=o.id
    ),coalesce(o.total_amount,0)),
    tax_applied=false,
    tax_configuration_id=null,
    tax_configuration_revision=null,
    tax_rate_percent=0,
    tax_amount=0,
    tax_display_breakdown=false,
    gross_amount=coalesce(o.total_amount,0),
    tax_posted_at=d.issued_at,
    total_amount=coalesce(o.total_amount,0)
from public.order_financial_documents d
where d.tenant_id=o.tenant_id
  and d.order_id=o.id
  and d.document_type='invoice'
  and o.tax_posted_at is null;

update public.sale_return_items sri
set subtotal_amount=sri.line_total,
    tax_amount=0
where sri.subtotal_amount is null;

update public.sale_returns sr
set subtotal_amount=sr.amount,
    tax_amount=0,
    tax_configuration_id=null,
    tax_configuration_revision=null,
    tax_rate_percent=0
where sr.subtotal_amount is null;

create or replace function public.get_sellertray_tax_settings(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_row public.sellertray_tax_configurations%rowtype;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Tax settings are available to business Owners and Managers' using errcode='42501';
  end if;

  select * into v_row
  from public.sellertray_tax_configurations c
  where c.tenant_id=p_tenant_id
  order by c.revision desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'configurationId',null,
      'revision',0,
      'isActive',false,
      'ratePercent',0,
      'displayTaxBreakdown',true
    );
  end if;

  return jsonb_build_object(
    'configurationId',v_row.id,
    'revision',v_row.revision,
    'isActive',v_row.is_active,
    'ratePercent',v_row.rate_percent,
    'displayTaxBreakdown',v_row.display_tax_breakdown,
    'createdAt',v_row.created_at
  );
end;
$$;

revoke all on function public.get_sellertray_tax_settings(uuid) from public,anon;
grant execute on function public.get_sellertray_tax_settings(uuid) to authenticated;

create or replace function public.save_sellertray_tax_settings(
  p_tenant_id uuid,
  p_is_active boolean,
  p_rate_percent numeric,
  p_display_tax_breakdown boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_rate numeric(9,6) := round(coalesce(p_rate_percent,0)::numeric,6);
  v_previous public.sellertray_tax_configurations%rowtype;
  v_row public.sellertray_tax_configurations%rowtype;
  v_revision bigint;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_is_active is null or p_display_tax_breakdown is null then
    raise exception 'Business and complete tax settings are required' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can update tax settings' using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_rate<0 or v_rate>100 or (p_is_active and v_rate<=0) then
    raise exception 'Active tax rate must be greater than zero and no more than 100 percent' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sellertray-tax:'||p_tenant_id::text,0)
  );

  select * into v_previous
  from public.sellertray_tax_configurations c
  where c.tenant_id=p_tenant_id
  order by c.revision desc
  limit 1;

  if found
     and v_previous.is_active=p_is_active
     and v_previous.rate_percent=v_rate
     and v_previous.display_tax_breakdown=p_display_tax_breakdown then
    v_row:=v_previous;
  else
    v_revision:=coalesce(v_previous.revision,0)+1;
    insert into public.sellertray_tax_configurations(
      tenant_id,revision,is_active,rate_percent,display_tax_breakdown,actor_user_id
    ) values(
      p_tenant_id,v_revision,p_is_active,v_rate,p_display_tax_breakdown,v_user_id
    ) returning * into v_row;
  end if;

  return jsonb_build_object(
    'configurationId',v_row.id,
    'revision',v_row.revision,
    'isActive',v_row.is_active,
    'ratePercent',v_row.rate_percent,
    'displayTaxBreakdown',v_row.display_tax_breakdown,
    'createdAt',v_row.created_at
  );
end;
$$;

revoke all on function public.save_sellertray_tax_settings(uuid,boolean,numeric,boolean) from public,anon;
grant execute on function public.save_sellertray_tax_settings(uuid,boolean,numeric,boolean) to authenticated;

create or replace function public.quote_sellertray_tax(
  p_tenant_id uuid,
  p_subtotal numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_subtotal numeric(18,2) := round(coalesce(p_subtotal,0)::numeric,2);
  v_row public.sellertray_tax_configurations%rowtype;
  v_rate numeric(9,6):=0;
  v_tax numeric(18,2):=0;
  v_applied boolean:=false;
  v_display boolean:=false;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if v_subtotal<0 then
    raise exception 'Tax subtotal cannot be negative' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'SellerTray business membership required' using errcode='42501';
  end if;

  select * into v_row
  from public.sellertray_tax_configurations c
  where c.tenant_id=p_tenant_id
  order by c.revision desc
  limit 1;

  if found and v_row.is_active then
    v_applied:=true;
    v_rate:=v_row.rate_percent;
    v_tax:=round((v_subtotal*v_rate/100)::numeric,2);
    v_display:=v_row.display_tax_breakdown;
  end if;

  return jsonb_build_object(
    'configurationId',case when found then v_row.id else null end,
    'revision',case when found then v_row.revision else 0 end,
    'taxApplied',v_applied,
    'ratePercent',v_rate,
    'subtotal',v_subtotal,
    'taxAmount',v_tax,
    'grossAmount',(v_subtotal+v_tax)::numeric(18,2),
    'displayTaxBreakdown',v_display
  );
end;
$$;

revoke all on function public.quote_sellertray_tax(uuid,numeric) from public,anon;
grant execute on function public.quote_sellertray_tax(uuid,numeric) to authenticated;

-- Financial posting authority. Existing invoice replay never recalculates tax.
create or replace function public.ensure_sellertray_invoice_for_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_existing_id uuid;
  v_config public.sellertray_tax_configurations%rowtype;
  v_subtotal numeric(18,2);
  v_rate numeric(9,6):=0;
  v_tax numeric(18,2):=0;
  v_gross numeric(18,2);
  v_applied boolean:=false;
  v_display boolean:=false;
  v_document_id uuid;
  v_line_tax_total numeric(18,2):=0;
  v_delta numeric(18,2):=0;
  v_last_item_id uuid;
begin
  select * into v_order
  from public.orders o
  where o.id=p_order_id
  for update;
  if not found then
    raise exception 'SellerTray order not found' using errcode='22023';
  end if;

  select d.id into v_existing_id
  from public.order_financial_documents d
  where d.tenant_id=v_order.tenant_id
    and d.order_id=v_order.id
    and d.document_type='invoice';
  if found then
    return v_existing_id;
  end if;

  if v_order.status not in ('accepted','processing','ready','completed') then
    return null;
  end if;

  select coalesce(sum(round((oi.quantity*oi.unit_price)::numeric,2)),0)::numeric(18,2)
  into v_subtotal
  from public.order_items oi
  where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id;

  if not exists(
    select 1 from public.order_items oi
    where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id
  ) then
    raise exception 'SellerTray order has no invoiceable items' using errcode='23514';
  end if;
  if exists(
    select 1 from public.order_items oi
    where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id
      and oi.unit_price is null
  ) then
    raise exception 'SellerTray order has unpriced invoice items' using errcode='23514';
  end if;

  select * into v_config
  from public.sellertray_tax_configurations c
  where c.tenant_id=v_order.tenant_id
  order by c.revision desc
  limit 1;

  if found and v_config.is_active then
    v_applied:=true;
    v_rate:=v_config.rate_percent;
    v_display:=v_config.display_tax_breakdown;
    v_tax:=round((v_subtotal*v_rate/100)::numeric,2);
  end if;
  v_gross:=(v_subtotal+v_tax)::numeric(18,2);

  update public.order_items oi
  set tax_basis_amount=round((oi.quantity*oi.unit_price)::numeric,2),
      tax_rate_percent=v_rate,
      tax_amount=case when v_applied
        then round((round((oi.quantity*oi.unit_price)::numeric,2)*v_rate/100)::numeric,2)
        else 0 end,
      gross_line_total=round((oi.quantity*oi.unit_price)::numeric,2)+case when v_applied
        then round((round((oi.quantity*oi.unit_price)::numeric,2)*v_rate/100)::numeric,2)
        else 0 end
  where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id;

  select coalesce(sum(oi.tax_amount),0)::numeric(18,2),max(oi.id)
  into v_line_tax_total,v_last_item_id
  from public.order_items oi
  where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id;

  v_delta:=(v_tax-v_line_tax_total)::numeric(18,2);
  if abs(v_delta)>=0.005 and v_last_item_id is not null then
    update public.order_items oi
    set tax_amount=(oi.tax_amount+v_delta)::numeric(18,2),
        gross_line_total=(oi.gross_line_total+v_delta)::numeric(18,2)
    where oi.tenant_id=v_order.tenant_id and oi.id=v_last_item_id;
  end if;

  update public.orders o
  set subtotal_amount=v_subtotal,
      tax_applied=v_applied,
      tax_configuration_id=case when found then v_config.id else null end,
      tax_configuration_revision=case when found then v_config.revision else null end,
      tax_rate_percent=v_rate,
      tax_amount=v_tax,
      tax_display_breakdown=v_display,
      gross_amount=v_gross,
      total_amount=v_gross,
      tax_posted_at=now(),
      updated_at=now()
  where o.tenant_id=v_order.tenant_id and o.id=v_order.id;

  insert into public.order_financial_documents(
    tenant_id,order_id,document_type,document_reference,currency,amount,status
  ) values(
    v_order.tenant_id,v_order.id,'invoice','',coalesce(v_order.currency,'NGN'),v_gross,'issued'
  )
  returning id into v_document_id;

  return v_document_id;
end;
$$;

revoke all on function public.ensure_sellertray_invoice_for_order(uuid) from public,anon,authenticated;
grant execute on function public.ensure_sellertray_invoice_for_order(uuid) to service_role;

create or replace function public.guard_sellertray_tax_snapshot()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if current_user in ('anon','authenticated') and (
    new.subtotal_amount is distinct from old.subtotal_amount
    or new.tax_applied is distinct from old.tax_applied
    or new.tax_configuration_id is distinct from old.tax_configuration_id
    or new.tax_configuration_revision is distinct from old.tax_configuration_revision
    or new.tax_rate_percent is distinct from old.tax_rate_percent
    or new.tax_amount is distinct from old.tax_amount
    or new.tax_display_breakdown is distinct from old.tax_display_breakdown
    or new.gross_amount is distinct from old.gross_amount
    or new.tax_posted_at is distinct from old.tax_posted_at
  ) then
    raise exception 'SellerTray tax snapshots are server-managed' using errcode='42501';
  end if;

  if old.tax_posted_at is not null and (
    new.subtotal_amount is distinct from old.subtotal_amount
    or new.tax_applied is distinct from old.tax_applied
    or new.tax_configuration_id is distinct from old.tax_configuration_id
    or new.tax_configuration_revision is distinct from old.tax_configuration_revision
    or new.tax_rate_percent is distinct from old.tax_rate_percent
    or new.tax_amount is distinct from old.tax_amount
    or new.tax_display_breakdown is distinct from old.tax_display_breakdown
    or new.gross_amount is distinct from old.gross_amount
    or new.tax_posted_at is distinct from old.tax_posted_at
    or new.total_amount is distinct from old.total_amount
  ) then
    raise exception 'Posted SellerTray tax history is immutable' using errcode='55000';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sellertray_tax_snapshot() from public,anon,authenticated;

drop trigger if exists guard_sellertray_tax_snapshot on public.orders;
create trigger guard_sellertray_tax_snapshot
before update on public.orders
for each row execute function public.guard_sellertray_tax_snapshot();

-- Tax-aware quantity return. The original line tax snapshot, not current tax
-- settings, determines every partial/final refund. Final remaining quantity uses
-- the exact historical remainder so cent rounding always reconciles.
create or replace function public.return_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_items jsonb,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.order_payments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_command_id text := nullif(btrim(coalesce(p_command_id,'')),'');
  v_command_hash text;
  v_fingerprint text;
  v_normalized_items jsonb;
  v_existing public.sale_returns%rowtype;
  v_existing_refund_id uuid;
  v_return_id uuid;
  v_refund_id uuid;
  v_stock_location_id uuid;
  v_item_count integer;
  v_existing_movement_count integer;
  v_request_count integer;
  v_distinct_count integer;
  v_entry jsonb;
  v_requested_qty numeric(18,6);
  v_line record;
  v_prior_qty numeric(18,6);
  v_prior_subtotal numeric(18,2);
  v_prior_tax numeric(18,2);
  v_remaining_qty numeric(18,6);
  v_line_subtotal numeric(18,2);
  v_line_tax numeric(18,2);
  v_line_refund numeric(18,2);
  v_refund_subtotal numeric(18,2):=0;
  v_refund_tax numeric(18,2):=0;
  v_refund_amount numeric(18,2):=0;
  v_new_returned numeric(18,2);
  v_has_remaining boolean;
  v_return_status text;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null
     or v_reason is null or v_command_id is null then
    raise exception 'Business, sale, operator, return reason and retry identity are required' using errcode='22023';
  end if;
  if char_length(v_reason)>500 then
    raise exception 'Return reason is too long' using errcode='22023';
  end if;
  if char_length(v_command_id)<8 or char_length(v_command_id)>160
     or v_command_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$' then
    raise exception 'Return retry identity is invalid' using errcode='22023';
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception 'Choose at least one return item' using errcode='22023';
  end if;

  select jsonb_agg(e.value order by e.value->>'orderItemId')
  into v_normalized_items
  from jsonb_array_elements(p_items) e(value);

  select count(*)::integer,count(distinct value->>'orderItemId')::integer
  into v_request_count,v_distinct_count
  from jsonb_array_elements(v_normalized_items);
  if v_request_count<>v_distinct_count
     or exists(
       select 1 from jsonb_array_elements(v_normalized_items) e(value)
       where nullif(btrim(coalesce(value->>'orderItemId','')),'') is null
          or nullif(btrim(coalesce(value->>'quantity','')),'') is null
     ) then
    raise exception 'Return items must contain unique sale lines and quantities' using errcode='22023';
  end if;

  v_command_hash:=pg_catalog.md5(p_tenant_id::text||'|'||p_order_id::text||'|'||v_command_id);
  v_fingerprint:=pg_catalog.md5(v_reason||'|'||v_normalized_items::text);

  select * into v_existing
  from public.sale_returns sr
  where sr.tenant_id=p_tenant_id and sr.command_id_hash=v_command_hash
  limit 1;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.command_fingerprint is distinct from v_fingerprint then
      raise exception 'Return retry identity is already used for different facts' using errcode='23505';
    end if;
    select pr.id into v_existing_refund_id
    from public.payment_refunds pr
    where pr.tenant_id=p_tenant_id and pr.sale_return_id=v_existing.id;
    return jsonb_build_object(
      'orderId',p_order_id,'returnId',v_existing.id,'refundId',v_existing_refund_id,
      'returnStatus',(select o.return_status from public.orders o where o.tenant_id=p_tenant_id and o.id=p_order_id),
      'refundedSubtotal',coalesce(v_existing.subtotal_amount,v_existing.amount),
      'refundedTax',coalesce(v_existing.tax_amount,0),
      'refundedAmount',v_existing.amount,'currency',v_existing.currency,'idempotentReplay',true
    );
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;
  if not found or v_order.source<>'pos' then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if v_order.branch_id is null
     or not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to return sales from this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_refund_sale') then
    raise exception 'You do not have permission to refund completed sales' using errcode='42501';
  end if;
  if v_order.status<>'completed'
     or v_order.payment_status<>'paid'
     or v_order.fulfillment_status<>'collected'
     or v_order.return_status not in ('none','partial')
     or coalesce(v_order.returned_amount,0)>=v_order.total_amount then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;
  if v_order.tax_posted_at is null then
    raise exception 'POS sale is missing its historical tax snapshot' using errcode='23514';
  end if;

  select * into v_payment
  from public.order_payments p
  where p.tenant_id=p_tenant_id and p.order_id=p_order_id
    and p.method_type='cash' and p.provider='pos_cash' and p.status='confirmed'
  order by p.confirmed_at,p.id
  limit 1;
  if not found then
    raise exception 'Completed POS sale has no confirmed counter cash payment' using errcode='23514';
  end if;
  if v_payment.amount<>v_order.total_amount or v_payment.currency<>v_order.currency then
    raise exception 'Completed POS cash value does not match the sale total' using errcode='23514';
  end if;

  select sl.id into v_stock_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id and sl.branch_id=v_order.branch_id
    and sl.is_default=true and sl.is_active=true
  order by sl.created_at,sl.id
  limit 1;
  if v_stock_location_id is null then
    raise exception 'POS branch has no active default stock location' using errcode='23514';
  end if;

  select count(*)::integer into v_item_count
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;
  select count(*)::integer into v_existing_movement_count
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id and im.reference_type='order'
    and im.reference_id=p_order_id::text and im.movement_type='sale';
  if v_item_count<1 or v_existing_movement_count<>v_item_count then
    raise exception 'POS sale stock history is incomplete and cannot be returned automatically' using errcode='23514';
  end if;

  for v_entry in select value from jsonb_array_elements(v_normalized_items)
  loop
    begin
      v_requested_qty:=(v_entry->>'quantity')::numeric(18,6);
    exception when others then
      raise exception 'Return quantity is invalid' using errcode='22023';
    end;
    if v_requested_qty<=0 then
      raise exception 'Return quantity must be greater than zero' using errcode='22023';
    end if;

    select oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,
           oi.conversion_factor,oi.stock_quantity,oi.unit_price,oi.line_total,
           oi.tax_basis_amount,oi.tax_amount as original_tax,oi.gross_line_total
    into v_line
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
      and oi.id=(v_entry->>'orderItemId')::uuid;
    if not found then
      raise exception 'Return item does not belong to this sale' using errcode='22023';
    end if;
    if v_line.catalog_item_id is null or v_line.selected_uom is null
       or v_line.quantity is null or v_line.quantity<=0
       or v_line.conversion_factor is null or v_line.conversion_factor<=0
       or v_line.stock_quantity is null or v_line.stock_quantity<=0
       or v_line.tax_basis_amount is null or v_line.original_tax is null
       or v_line.gross_line_total is null then
      raise exception 'POS sale line has incomplete return snapshot' using errcode='23514';
    end if;

    select coalesce(sum(sri.quantity),0)::numeric(18,6),
           coalesce(sum(coalesce(sri.subtotal_amount,sri.line_total)),0)::numeric(18,2),
           coalesce(sum(coalesce(sri.tax_amount,0)),0)::numeric(18,2)
    into v_prior_qty,v_prior_subtotal,v_prior_tax
    from public.sale_return_items sri
    where sri.tenant_id=p_tenant_id and sri.order_item_id=v_line.id;

    v_remaining_qty:=v_line.quantity-v_prior_qty;
    if v_remaining_qty<=0 or v_requested_qty>v_remaining_qty then
      raise exception 'Return quantity exceeds the quantity still available for this item' using errcode='23514';
    end if;

    if v_requested_qty=v_remaining_qty then
      v_line_subtotal:=greatest(v_line.tax_basis_amount-v_prior_subtotal,0)::numeric(18,2);
      v_line_tax:=greatest(v_line.original_tax-v_prior_tax,0)::numeric(18,2);
    else
      v_line_subtotal:=round((v_line.tax_basis_amount*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
      v_line_tax:=round((v_line.original_tax*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
    end if;
    v_line_refund:=(v_line_subtotal+v_line_tax)::numeric(18,2);
    v_refund_subtotal:=v_refund_subtotal+v_line_subtotal;
    v_refund_tax:=v_refund_tax+v_line_tax;
    v_refund_amount:=v_refund_amount+v_line_refund;
  end loop;

  if v_refund_amount<=0
     or coalesce(v_order.returned_amount,0)+v_refund_amount>v_order.total_amount then
    raise exception 'Return value exceeds the remaining refundable sale amount' using errcode='23514';
  end if;

  insert into public.sale_returns(
    tenant_id,branch_id,order_id,original_payment_id,return_type,status,
    amount,currency,reason,actor_user_id,command_id_hash,command_fingerprint,
    subtotal_amount,tax_amount,tax_configuration_id,tax_configuration_revision,tax_rate_percent
  ) values(
    p_tenant_id,v_order.branch_id,p_order_id,v_payment.id,'partial','completed',
    v_refund_amount,v_payment.currency,left(v_reason,500),p_actor_user_id,v_command_hash,v_fingerprint,
    v_refund_subtotal,v_refund_tax,v_order.tax_configuration_id,v_order.tax_configuration_revision,v_order.tax_rate_percent
  ) returning id into v_return_id;

  for v_entry in select value from jsonb_array_elements(v_normalized_items)
  loop
    v_requested_qty:=(v_entry->>'quantity')::numeric(18,6);
    select oi.id,oi.catalog_item_id,oi.item_name,oi.selected_uom,oi.quantity,
           oi.conversion_factor,oi.stock_quantity,oi.unit_price,oi.line_total,
           oi.tax_basis_amount,oi.tax_amount as original_tax,oi.gross_line_total
    into v_line
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
      and oi.id=(v_entry->>'orderItemId')::uuid;

    select coalesce(sum(sri.quantity),0)::numeric(18,6),
           coalesce(sum(coalesce(sri.subtotal_amount,sri.line_total)),0)::numeric(18,2),
           coalesce(sum(coalesce(sri.tax_amount,0)),0)::numeric(18,2)
    into v_prior_qty,v_prior_subtotal,v_prior_tax
    from public.sale_return_items sri
    where sri.tenant_id=p_tenant_id and sri.order_item_id=v_line.id;
    v_remaining_qty:=v_line.quantity-v_prior_qty;
    if v_requested_qty=v_remaining_qty then
      v_line_subtotal:=greatest(v_line.tax_basis_amount-v_prior_subtotal,0)::numeric(18,2);
      v_line_tax:=greatest(v_line.original_tax-v_prior_tax,0)::numeric(18,2);
    else
      v_line_subtotal:=round((v_line.tax_basis_amount*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
      v_line_tax:=round((v_line.original_tax*v_requested_qty/v_line.quantity)::numeric,2)::numeric(18,2);
    end if;
    v_line_refund:=(v_line_subtotal+v_line_tax)::numeric(18,2);

    insert into public.sale_return_items(
      tenant_id,sale_return_id,order_item_id,catalog_item_id,product_name,
      selected_uom,quantity,conversion_factor,stock_quantity,unit_price,line_total,
      subtotal_amount,tax_amount
    ) values(
      p_tenant_id,v_return_id,v_line.id,v_line.catalog_item_id,v_line.item_name,
      v_line.selected_uom,v_requested_qty,v_line.conversion_factor,
      (v_requested_qty*v_line.conversion_factor)::numeric(18,6),
      v_line.unit_price,v_line_refund,v_line_subtotal,v_line_tax
    );

    perform public.record_sellertray_inventory_movement(
      p_tenant_id,v_order.branch_id,v_stock_location_id,v_line.catalog_item_id,
      'sale_return',(v_requested_qty*v_line.conversion_factor)::numeric(18,6),
      v_line.selected_uom,v_requested_qty,v_line.conversion_factor,
      'sale_return',v_return_id::text,
      'pos-return:'||v_return_id::text||':'||v_line.id::text,
      now(),p_actor_user_id,left(v_reason,500),
      jsonb_build_object(
        'return_id',v_return_id,'order_id',p_order_id,'public_order_id',v_order.public_order_id,
        'order_item_id',v_line.id,'original_payment_id',v_payment.id,'partial_return',true,
        'returned_subtotal',v_line_subtotal,'returned_tax',v_line_tax,'returned_gross',v_line_refund
      ),null
    );
  end loop;

  insert into public.payment_refunds(
    tenant_id,order_id,original_payment_id,sale_return_id,method_type,provider,status,
    amount,currency,reason,actor_user_id,idempotency_key
  ) values(
    p_tenant_id,p_order_id,v_payment.id,v_return_id,'cash','pos_cash','confirmed',
    v_refund_amount,v_payment.currency,left(v_reason,500),p_actor_user_id,
    'pos-cash-return:'||p_order_id::text||':'||v_command_hash
  ) returning id into v_refund_id;

  select exists(
    select 1
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
      and oi.quantity > coalesce((
        select sum(sri.quantity)
        from public.sale_return_items sri
        where sri.tenant_id=oi.tenant_id and sri.order_item_id=oi.id
      ),0)
  ) into v_has_remaining;

  v_new_returned:=(coalesce(v_order.returned_amount,0)+v_refund_amount)::numeric(18,2);
  if v_has_remaining then
    v_return_status:='partial';
  else
    v_return_status:='returned';
    v_new_returned:=v_order.total_amount;
  end if;

  update public.orders
  set return_status=v_return_status,
      returned_amount=v_new_returned,
      returned_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,action_type,risk_class,
    requested_by,actor_user_id,policy_result,action_status,financial_impact,currency,
    before_state,after_state,metadata,applied_at
  ) values(
    p_tenant_id,'pos-return:'||p_order_id::text||':'||v_command_hash,
    'merchant_app',v_order.customer_id,p_order_id,'sale_returned','high',
    public.sellertray_commercial_actor_kind(p_tenant_id,p_actor_user_id),p_actor_user_id,
    'allowed','applied',-v_refund_amount,v_payment.currency,
    jsonb_build_object('return_status',v_order.return_status,'returned_amount',v_order.returned_amount),
    jsonb_build_object('return_status',v_return_status,'returned_amount',v_new_returned),
    jsonb_build_object(
      'return_id',v_return_id,'refund_id',v_refund_id,'original_payment_id',v_payment.id,
      'reason',left(v_reason,500),'items',v_normalized_items,
      'refunded_subtotal',v_refund_subtotal,'refunded_tax',v_refund_tax,'refunded_gross',v_refund_amount
    ),now()
  ) on conflict(tenant_id,action_key) do nothing;

  return jsonb_build_object(
    'orderId',p_order_id,'returnId',v_return_id,'refundId',v_refund_id,
    'returnStatus',v_return_status,'refundedSubtotal',v_refund_subtotal,
    'refundedTax',v_refund_tax,'refundedAmount',v_refund_amount,
    'returnedAmount',v_new_returned,'currency',v_payment.currency,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  to service_role;

-- Keep the existing full-return compatibility command governed, but converge it
-- onto the quantity-aware tax-aware return authority so both paths reverse the
-- same historical line/tax snapshots.
create or replace function public.apply_sellertray_pos_cash_return_internal(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_items jsonb;
  v_existing_return_id uuid;
  v_existing_refund_id uuid;
begin
  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if not found or v_order.branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to return sales from this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_refund_sale') then
    raise exception 'You do not have permission to refund completed sales' using errcode='42501';
  end if;

  if v_order.return_status='returned' then
    select sr.id into v_existing_return_id
    from public.sale_returns sr
    where sr.tenant_id=p_tenant_id and sr.order_id=p_order_id
    order by sr.created_at desc,sr.id desc limit 1;
    select pr.id into v_existing_refund_id
    from public.payment_refunds pr
    where pr.tenant_id=p_tenant_id and pr.sale_return_id=v_existing_return_id;
    return jsonb_build_object(
      'orderId',p_order_id,'returnId',v_existing_return_id,'refundId',v_existing_refund_id,
      'returnStatus','returned','returnedAmount',v_order.returned_amount,'idempotentReplay',true
    );
  end if;

  select jsonb_agg(jsonb_build_object(
    'orderItemId',oi.id,
    'quantity',(oi.quantity-coalesce(r.returned_quantity,0))
  ) order by oi.id)
  into v_items
  from public.order_items oi
  left join lateral (
    select sum(sri.quantity)::numeric(18,6) as returned_quantity
    from public.sale_return_items sri
    where sri.tenant_id=oi.tenant_id and sri.order_item_id=oi.id
  ) r on true
  where oi.tenant_id=p_tenant_id
    and oi.order_id=p_order_id
    and oi.quantity-coalesce(r.returned_quantity,0)>0;

  if v_items is null or jsonb_array_length(v_items)=0 then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;

  return public.return_sellertray_pos_cash_sale(
    p_tenant_id,p_order_id,p_actor_user_id,p_reason,v_items,
    'legacy-full-return:'||p_order_id::text
  );
end;
$$;

revoke all on function public.apply_sellertray_pos_cash_return_internal(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;

-- Existing public 4-argument compatibility wrapper is recreated so its explicit
-- Branch/capability checks remain visible to authority-contract tests.
create or replace function public.return_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_branch_id uuid;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Business, sale and operator are required' using errcode='22023';
  end if;
  select o.branch_id into v_branch_id
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if not found or v_branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to return sales from this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_refund_sale') then
    raise exception 'You do not have permission to refund completed sales' using errcode='42501';
  end if;
  return public.apply_sellertray_pos_cash_return_internal(
    p_tenant_id,p_order_id,p_actor_user_id,p_reason
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.get_sellertray_tax_report_summary(
  p_tenant_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_branch_id uuid default null,
  p_source text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_timezone text;
  v_currency text;
  v_date_from date;
  v_date_to date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_source text:=nullif(lower(btrim(coalesce(p_source,''))),'');
  v_sales_subtotal numeric(18,2):=0;
  v_sales_tax numeric(18,2):=0;
  v_sales_gross numeric(18,2):=0;
  v_return_subtotal numeric(18,2):=0;
  v_return_tax numeric(18,2):=0;
  v_return_gross numeric(18,2):=0;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id and tm.role in ('owner','manager')
  ) or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'Tax reports are available to Owners and Managers' using errcode='42501';
  end if;

  select coalesce(nullif(t.timezone,''),'Africa/Lagos'),upper(t.currency)
  into v_timezone,v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_timezone is null then raise exception 'Business not found' using errcode='P0002'; end if;

  v_date_to:=coalesce(p_date_to,(now() at time zone v_timezone)::date);
  v_date_from:=coalesce(p_date_from,v_date_to-29);
  if v_date_from>v_date_to or (v_date_to-v_date_from)>365 then
    raise exception 'Tax report date range is invalid' using errcode='22023';
  end if;
  v_start_at:=v_date_from::timestamp at time zone v_timezone;
  v_end_at:=(v_date_to+1)::timestamp at time zone v_timezone;

  if v_source='all' then v_source:=null; end if;
  if v_source is not null and v_source not in ('pos','whatsapp','manual') then
    raise exception 'Unsupported sales channel' using errcode='22023';
  end if;

  if p_branch_id is not null then
    if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then
      raise exception 'Branch not found' using errcode='P0002';
    end if;
    if not public.sellertray_user_can_read_report_branch(p_tenant_id,p_branch_id,v_user_id) then
      raise exception 'You do not have access to reports for this Branch' using errcode='42501';
    end if;
  end if;

  select
    coalesce(sum(o.subtotal_amount),0)::numeric(18,2),
    coalesce(sum(o.tax_amount),0)::numeric(18,2),
    coalesce(sum(o.gross_amount),0)::numeric(18,2)
  into v_sales_subtotal,v_sales_tax,v_sales_gross
  from public.orders o
  where o.tenant_id=p_tenant_id
    and o.deleted_at is null
    and o.status='completed'
    and o.tax_posted_at is not null
    and o.created_at>=v_start_at and o.created_at<v_end_at
    and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
    and (p_branch_id is null or o.branch_id=p_branch_id)
    and (v_source is null or o.source=v_source);

  select
    coalesce(sum(coalesce(sr.subtotal_amount,sr.amount)),0)::numeric(18,2),
    coalesce(sum(coalesce(sr.tax_amount,0)),0)::numeric(18,2),
    coalesce(sum(sr.amount),0)::numeric(18,2)
  into v_return_subtotal,v_return_tax,v_return_gross
  from public.sale_returns sr
  join public.orders o on o.tenant_id=sr.tenant_id and o.id=sr.order_id
  where sr.tenant_id=p_tenant_id
    and sr.status='completed'
    and sr.created_at>=v_start_at and sr.created_at<v_end_at
    and public.sellertray_user_can_read_report_branch(p_tenant_id,sr.branch_id,v_user_id)
    and (p_branch_id is null or sr.branch_id=p_branch_id)
    and (v_source is null or o.source=v_source);

  return jsonb_build_object(
    'currency',v_currency,
    'dateFrom',v_date_from,
    'dateTo',v_date_to,
    'salesSubtotal',v_sales_subtotal,
    'salesTax',v_sales_tax,
    'salesGross',v_sales_gross,
    'returnedSubtotal',v_return_subtotal,
    'returnedTax',v_return_tax,
    'returnedGross',v_return_gross,
    'netRevenue',(v_sales_subtotal-v_return_subtotal)::numeric(18,2),
    'netTax',(v_sales_tax-v_return_tax)::numeric(18,2),
    'netGross',(v_sales_gross-v_return_gross)::numeric(18,2)
  );
end;
$$;

revoke all on function public.get_sellertray_tax_report_summary(uuid,date,date,uuid,text) from public,anon;
grant execute on function public.get_sellertray_tax_report_summary(uuid,date,date,uuid,text) to authenticated;

commit;
