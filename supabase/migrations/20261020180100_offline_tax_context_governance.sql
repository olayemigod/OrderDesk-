begin;

-- Offline POS preserves the server-issued tax configuration identity seen by
-- the device. The client does not become tax authority: replay validates that
-- the same immutable configuration is still current before any payment/stock
-- effect can post. A revision of 0 + null ID means the server had no tax
-- configuration when the offline context was cached.

alter table public.orders
  add column if not exists offline_tax_context_locked boolean not null default false,
  add column if not exists offline_tax_configuration_id uuid,
  add column if not exists offline_tax_configuration_revision bigint;

alter table public.orders
  drop constraint if exists orders_offline_tax_configuration_same_tenant,
  add constraint orders_offline_tax_configuration_same_tenant
    foreign key (tenant_id,offline_tax_configuration_id)
    references public.sellertray_tax_configurations(tenant_id,id)
    on delete restrict,
  drop constraint if exists orders_offline_tax_context_check,
  add constraint orders_offline_tax_context_check check (
    (
      offline_tax_context_locked=false
      and offline_tax_configuration_id is null
      and offline_tax_configuration_revision is null
    )
    or
    (
      offline_tax_context_locked=true
      and offline_tax_configuration_revision is not null
      and offline_tax_configuration_revision>=0
      and (
        (offline_tax_configuration_revision=0 and offline_tax_configuration_id is null)
        or (offline_tax_configuration_revision>0 and offline_tax_configuration_id is not null)
      )
      and source='pos'
    )
  );

create or replace function public.bind_sellertray_offline_tax_context(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_expected_tax_configuration_id uuid,
  p_expected_tax_configuration_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_current public.sellertray_tax_configurations%rowtype;
  v_current_revision bigint:=0;
  v_current_id uuid:=null;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null
     or p_expected_tax_configuration_revision is null
     or p_expected_tax_configuration_revision<0 then
    raise exception 'Business, queued sale, operator and tax context are required' using errcode='22023';
  end if;
  if (p_expected_tax_configuration_revision=0 and p_expected_tax_configuration_id is not null)
     or (p_expected_tax_configuration_revision>0 and p_expected_tax_configuration_id is null) then
    raise exception 'Queued sale tax context is invalid' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;
  if not found or v_order.source<>'pos' or v_order.status<>'draft' then
    raise exception 'Queued SellerTray POS sale not found' using errcode='22023';
  end if;
  if v_order.payment_status<>'unpaid' or coalesce(v_order.amount_paid,0)<>0
     or exists(select 1 from public.order_payments p where p.tenant_id=p_tenant_id and p.order_id=p_order_id)
     or exists(select 1 from public.order_financial_documents d where d.tenant_id=p_tenant_id and d.order_id=p_order_id)
     or exists(
       select 1 from public.inventory_movements im
       where im.tenant_id=p_tenant_id and im.reference_type='order' and im.reference_id=p_order_id::text
     ) then
    raise exception 'Queued sale already has commercial effects and cannot change tax context' using errcode='23514';
  end if;
  if v_order.branch_id is null
     or not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to sell from this Branch' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.sellertray_pos_draft_requests r
    where r.tenant_id=p_tenant_id and r.order_id=p_order_id
  ) then
    raise exception 'Tax context may only be bound to an idempotent queued POS sale' using errcode='23514';
  end if;

  select * into v_current
  from public.sellertray_tax_configurations c
  where c.tenant_id=p_tenant_id
  order by c.revision desc
  limit 1;
  if found then
    v_current_revision:=v_current.revision;
    v_current_id:=v_current.id;
  end if;

  if v_current_revision<>p_expected_tax_configuration_revision
     or v_current_id is distinct from p_expected_tax_configuration_id then
    raise exception 'Queued sale needs review because Business tax settings changed' using errcode='23514';
  end if;

  if v_order.offline_tax_context_locked then
    if v_order.offline_tax_configuration_revision<>p_expected_tax_configuration_revision
       or v_order.offline_tax_configuration_id is distinct from p_expected_tax_configuration_id then
      raise exception 'Queued sale tax context is already locked to different settings' using errcode='23505';
    end if;
  else
    update public.orders o
    set offline_tax_context_locked=true,
        offline_tax_configuration_id=p_expected_tax_configuration_id,
        offline_tax_configuration_revision=p_expected_tax_configuration_revision,
        updated_at=now()
    where o.tenant_id=p_tenant_id and o.id=p_order_id;
  end if;

  return jsonb_build_object(
    'orderId',p_order_id,
    'taxConfigurationId',p_expected_tax_configuration_id,
    'taxConfigurationRevision',p_expected_tax_configuration_revision,
    'locked',true
  );
end;
$$;

revoke all on function public.bind_sellertray_offline_tax_context(uuid,uuid,uuid,uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.bind_sellertray_offline_tax_context(uuid,uuid,uuid,uuid,bigint)
  to service_role;

create or replace function public.guard_sellertray_offline_tax_context()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if current_user in ('anon','authenticated') and (
    new.offline_tax_context_locked is distinct from old.offline_tax_context_locked
    or new.offline_tax_configuration_id is distinct from old.offline_tax_configuration_id
    or new.offline_tax_configuration_revision is distinct from old.offline_tax_configuration_revision
  ) then
    raise exception 'SellerTray offline tax context is server-managed' using errcode='42501';
  end if;

  if old.offline_tax_context_locked and (
    new.offline_tax_context_locked is distinct from old.offline_tax_context_locked
    or new.offline_tax_configuration_id is distinct from old.offline_tax_configuration_id
    or new.offline_tax_configuration_revision is distinct from old.offline_tax_configuration_revision
  ) then
    raise exception 'SellerTray offline tax context is immutable once bound' using errcode='55000';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sellertray_offline_tax_context() from public,anon,authenticated;

drop trigger if exists guard_sellertray_offline_tax_context on public.orders;
create trigger guard_sellertray_offline_tax_context
before update on public.orders
for each row execute function public.guard_sellertray_offline_tax_context();

-- Replace the posting authority from the immediately preceding Tax Foundation
-- migration so online orders use the latest config at posting, while queued
-- offline orders must post with their still-current locked config identity.
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
  v_latest public.sellertray_tax_configurations%rowtype;
  v_has_config boolean:=false;
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
  if found then return v_existing_id; end if;

  if v_order.status not in ('accepted','processing','ready','completed') then return null; end if;

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
    where oi.tenant_id=v_order.tenant_id and oi.order_id=v_order.id and oi.unit_price is null
  ) then
    raise exception 'SellerTray order has unpriced invoice items' using errcode='23514';
  end if;

  select * into v_latest
  from public.sellertray_tax_configurations c
  where c.tenant_id=v_order.tenant_id
  order by c.revision desc
  limit 1;

  if v_order.offline_tax_context_locked then
    if v_order.offline_tax_configuration_revision=0 then
      if found then
        raise exception 'Queued sale needs review because Business tax settings changed' using errcode='23514';
      end if;
      v_has_config:=false;
    else
      if not found
         or v_latest.id is distinct from v_order.offline_tax_configuration_id
         or v_latest.revision<>v_order.offline_tax_configuration_revision then
        raise exception 'Queued sale needs review because Business tax settings changed' using errcode='23514';
      end if;
      v_config:=v_latest;
      v_has_config:=true;
    end if;
  else
    if found then
      v_config:=v_latest;
      v_has_config:=true;
    end if;
  end if;

  if v_has_config and v_config.is_active then
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
      tax_configuration_id=case when v_has_config then v_config.id else null end,
      tax_configuration_revision=case when v_has_config then v_config.revision else null end,
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
  ) returning id into v_document_id;

  return v_document_id;
end;
$$;

revoke all on function public.ensure_sellertray_invoice_for_order(uuid) from public,anon,authenticated;
grant execute on function public.ensure_sellertray_invoice_for_order(uuid) to service_role;

commit;
