alter table public.commercial_action_ledger
  add column if not exists actor_user_id uuid;

create index if not exists commercial_action_ledger_actor_idx
  on public.commercial_action_ledger(actor_user_id,created_at desc)
  where actor_user_id is not null;

create or replace function public.sellertray_commercial_actor_kind(
  p_tenant_id uuid,
  p_user_id uuid
)
returns text
language sql
security definer
set search_path=''
stable
as $$
  select case
    when p_user_id is null then 'system'
    when exists(
      select 1 from public.tenant_members tm
      where tm.tenant_id=p_tenant_id
        and tm.user_id=p_user_id
        and tm.role='staff'
    ) then 'staff'
    else 'merchant'
  end;
$$;

revoke all on function public.sellertray_commercial_actor_kind(uuid,uuid)
from public,anon,authenticated;
grant execute on function public.sellertray_commercial_actor_kind(uuid,uuid)
to service_role;

create or replace function public.audit_sellertray_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_requested_by text;
  v_risk text;
  v_action_type text;
begin
  if old.status is not distinct from new.status then return new; end if;
  if old.fulfillment_status is distinct from new.fulfillment_status then return new; end if;

  v_requested_by := public.sellertray_commercial_actor_kind(new.tenant_id,v_actor);
  v_risk := case
    when new.status in ('cancelled','completed') then 'high'
    when new.status in ('accepted','rejected') then 'medium'
    else 'low'
  end;
  v_action_type := case new.status
    when 'accepted' then 'order_accepted'
    when 'rejected' then 'order_rejected'
    when 'processing' then 'order_processing_started'
    when 'ready' then 'order_marked_ready'
    when 'cancelled' then 'order_cancelled'
    when 'completed' then 'order_completed'
    else 'order_status_changed'
  end;

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,actor_user_id,
    policy_result,action_status,before_state,after_state,metadata,applied_at
  )
  values(
    new.tenant_id,
    'order-status:'||new.id::text||':'||old.status||':'||new.status||':'||extract(epoch from new.updated_at)::text,
    case when new.source='whatsapp' then 'whatsapp' else 'merchant_app' end,
    new.customer_id,new.id,
    v_action_type,v_risk,v_requested_by,v_actor,
    'allowed','applied',
    jsonb_build_object(
      'status',old.status,
      'status_reason',old.status_reason,
      'payment_status',old.payment_status,
      'amount_paid',old.amount_paid,
      'fulfillment_status',old.fulfillment_status,
      'fulfillment_method',old.fulfillment_method
    ),
    jsonb_build_object(
      'status',new.status,
      'status_reason',new.status_reason,
      'payment_status',new.payment_status,
      'amount_paid',new.amount_paid,
      'fulfillment_status',new.fulfillment_status,
      'fulfillment_method',new.fulfillment_method
    ),
    jsonb_build_object('public_order_id',new.public_order_id),
    now()
  )
  on conflict(tenant_id,action_key) do nothing;

  return new;
end;
$$;

revoke all on function public.audit_sellertray_order_status_transition()
from public,anon,authenticated;

drop trigger if exists audit_sellertray_order_status_transition on public.orders;
create trigger audit_sellertray_order_status_transition
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function public.audit_sellertray_order_status_transition();

create or replace function public.audit_sellertray_payment_outcome()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_customer_id uuid;
  v_order_ref text;
  v_actor uuid;
  v_requested_by text;
  v_action text;
  v_risk text := 'high';
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if old.status is not distinct from new.status
     and old.exception_state is not distinct from new.exception_state
     and old.exception_reason is not distinct from new.exception_reason then
    return new;
  end if;

  if old.status is distinct from new.status then
    if new.status not in ('confirmed','failed','cancelled','expired') then return new; end if;
    v_action := case new.status
      when 'confirmed' then 'payment_confirmed'
      when 'failed' then 'payment_failed'
      when 'cancelled' then 'payment_cancelled'
      when 'expired' then 'payment_expired'
      else 'payment_status_changed'
    end;
  else
    if new.exception_state='none' then return new; end if;
    v_action := 'payment_exception_changed';
  end if;

  select o.customer_id,o.public_order_id
  into v_customer_id,v_order_ref
  from public.orders o
  where o.id=new.order_id and o.tenant_id=new.tenant_id;

  v_actor := coalesce(new.confirmed_by_user_id,auth.uid());
  v_requested_by := case
    when new.customer_claimed_at is not null
         and new.status='confirmed'
         and new.confirmed_by_user_id is null
         and new.confirmation_source is null then 'customer'
    else public.sellertray_commercial_actor_kind(new.tenant_id,v_actor)
  end;

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,actor_user_id,
    policy_result,action_status,financial_impact,currency,
    before_state,after_state,metadata,applied_at
  )
  values(
    new.tenant_id,
    'payment-outcome:'||new.id::text||':'||
      coalesce(old.status,'')||':'||coalesce(new.status,'')||':'||
      coalesce(old.exception_state,'')||':'||coalesce(new.exception_state,''),
    'system',v_customer_id,new.order_id,
    v_action,v_risk,v_requested_by,v_actor,
    case when new.status='confirmed' then 'allowed' else 'not_applicable' end,
    'applied',
    case when new.status='confirmed' and old.status is distinct from new.status then new.amount else null end,
    new.currency,
    jsonb_build_object(
      'payment_id',old.id,'status',old.status,'exception_state',old.exception_state,
      'exception_reason',old.exception_reason,'amount',old.amount,'provider',old.provider,'method_type',old.method_type
    ),
    jsonb_build_object(
      'payment_id',new.id,'status',new.status,'exception_state',new.exception_state,
      'exception_reason',new.exception_reason,'amount',new.amount,'provider',new.provider,
      'method_type',new.method_type,'confirmation_source',new.confirmation_source
    ),
    jsonb_build_object('public_order_id',v_order_ref,'provider_reference',new.provider_reference),
    now()
  )
  on conflict(tenant_id,action_key) do nothing;

  return new;
end;
$$;

revoke all on function public.audit_sellertray_payment_outcome()
from public,anon,authenticated;

drop trigger if exists audit_sellertray_payment_outcome on public.order_payments;
create trigger audit_sellertray_payment_outcome
after update of status,exception_state,exception_reason on public.order_payments
for each row execute function public.audit_sellertray_payment_outcome();

create or replace function public.audit_sellertray_change_request()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_actor uuid;
  v_requested_by text;
  v_action_type text;
  v_risk text;
begin
  select * into v_order
  from public.orders o
  where o.id=coalesce(new.order_id,old.order_id)
    and o.tenant_id=coalesce(new.tenant_id,old.tenant_id);

  if tg_op='INSERT' then
    v_action_type := case new.request_kind
      when 'add_items' then 'order_add_items_requested'
      when 'remove_items' then 'order_remove_items_requested'
      when 'change_items' then 'order_change_requested'
      when 'cancel_order' then 'order_cancel_requested'
      else 'order_change_requested'
    end;
    v_risk := case when new.request_kind='cancel_order' then 'high' else 'medium' end;

    insert into public.commercial_action_ledger(
      tenant_id,action_key,channel,source_inbound_message_id,customer_id,target_order_id,
      action_type,risk_class,requested_by,policy_result,action_status,
      before_state,after_state,metadata
    )
    values(
      new.tenant_id,new.source_inbound_message_id::text||':'||v_action_type,
      'whatsapp',new.source_inbound_message_id,new.customer_id,new.order_id,
      v_action_type,v_risk,'customer','pending','requested',
      jsonb_build_object(
        'status',v_order.status,'payment_status',v_order.payment_status,
        'amount_paid',v_order.amount_paid,'total_amount',v_order.total_amount,
        'fulfillment_status',v_order.fulfillment_status
      ),
      '{}'::jsonb,
      jsonb_build_object('request_id',new.id,'request_kind',new.request_kind,'request_text',new.request_text)
    )
    on conflict(tenant_id,action_key) do update
    set before_state=excluded.before_state,
        metadata=excluded.metadata;
    return new;
  end if;

  if old.status is distinct from new.status and new.status <> 'pending' then
    v_actor := coalesce(new.resolved_by_user_id,auth.uid());
    v_requested_by := public.sellertray_commercial_actor_kind(new.tenant_id,v_actor);

    insert into public.commercial_action_ledger(
      tenant_id,action_key,channel,source_inbound_message_id,customer_id,target_order_id,
      action_type,risk_class,requested_by,actor_user_id,
      policy_result,action_status,before_state,after_state,metadata,applied_at
    )
    values(
      new.tenant_id,'change-resolution:'||new.id::text||':'||new.status,
      'merchant_app',new.source_inbound_message_id,new.customer_id,new.order_id,
      'order_change_request_'||new.status,
      case when new.request_kind='cancel_order' then 'high' else 'medium' end,
      v_requested_by,v_actor,
      case when new.status in ('approved','resolved') then 'allowed' else 'blocked' end,
      case when new.status in ('approved','resolved') then 'applied' else 'rejected' end,
      jsonb_build_object(
        'request_status',old.status,'order_status',v_order.status,
        'payment_status',v_order.payment_status,'fulfillment_status',v_order.fulfillment_status
      ),
      jsonb_build_object(
        'request_status',new.status,'order_status',v_order.status,
        'payment_status',v_order.payment_status,'fulfillment_status',v_order.fulfillment_status
      ),
      jsonb_build_object('request_id',new.id,'request_kind',new.request_kind,'request_text',new.request_text),
      now()
    )
    on conflict(tenant_id,action_key) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.audit_sellertray_change_request()
from public,anon,authenticated;

drop trigger if exists audit_sellertray_change_request_insert on public.customer_order_change_requests;
create trigger audit_sellertray_change_request_insert
after insert on public.customer_order_change_requests
for each row execute function public.audit_sellertray_change_request();

drop trigger if exists audit_sellertray_change_request_update on public.customer_order_change_requests;
create trigger audit_sellertray_change_request_update
after update of status,resolved_by_user_id on public.customer_order_change_requests
for each row execute function public.audit_sellertray_change_request();
