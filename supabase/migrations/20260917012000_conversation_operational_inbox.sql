-- SellerTray competitive hardening: operational conversation ownership.
-- Gives each WhatsApp conversation an explicit automation/human work state
-- without changing the customer-facing channel or order source of truth.

begin;

create schema if not exists sellertray_private;
revoke all on schema sellertray_private from public,anon,authenticated;

create table if not exists public.conversation_work_states (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  state text not null default 'ai_handling'
    check (state in ('ai_handling','needs_merchant','merchant_handling','waiting_customer','resolved')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  last_state_reason text,
  last_customer_message_at timestamptz,
  last_merchant_reply_at timestamptz,
  resolved_at timestamptz,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,customer_id),
  constraint conversation_work_states_customer_fk
    foreign key (tenant_id,customer_id)
    references public.customers(tenant_id,id)
    on delete cascade
);

create index if not exists conversation_work_states_queue_idx
  on public.conversation_work_states(tenant_id,state,updated_at desc);

create index if not exists conversation_work_states_assignee_idx
  on public.conversation_work_states(tenant_id,assigned_user_id,state,updated_at desc)
  where assigned_user_id is not null;

alter table public.conversation_work_states enable row level security;
revoke all on public.conversation_work_states from public,anon,authenticated;
grant all on public.conversation_work_states to service_role;

create table if not exists public.conversation_work_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  action text not null
    check (action in (
      'take_over','return_to_ai','assign','waiting_customer','resolve',
      'needs_merchant','customer_message','reopen'
    )),
  from_state text
    check (from_state is null or from_state in ('ai_handling','needs_merchant','merchant_handling','waiting_customer','resolved')),
  to_state text not null
    check (to_state in ('ai_handling','needs_merchant','merchant_handling','waiting_customer','resolved')),
  actor_user_id uuid references auth.users(id) on delete set null,
  from_assigned_user_id uuid references auth.users(id) on delete set null,
  to_assigned_user_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint conversation_work_events_customer_fk
    foreign key (tenant_id,customer_id)
    references public.customers(tenant_id,id)
    on delete cascade
);

create index if not exists conversation_work_events_customer_idx
  on public.conversation_work_events(tenant_id,customer_id,created_at desc);

alter table public.conversation_work_events enable row level security;
revoke all on public.conversation_work_events from public,anon,authenticated;
grant all on public.conversation_work_events to service_role;

create or replace function sellertray_private.apply_conversation_work_action(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_assigned_user_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_current_state text;
  v_current_assignee uuid;
  v_new_state text;
  v_new_assignee uuid;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.customers c
    where c.tenant_id=p_tenant_id and c.id=p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  if p_actor_user_id is not null and not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  insert into public.conversation_work_states(
    tenant_id,customer_id,state,updated_by_user_id
  ) values (
    p_tenant_id,p_customer_id,'ai_handling',p_actor_user_id
  )
  on conflict (tenant_id,customer_id) do nothing;

  select s.state,s.assigned_user_id
  into v_current_state,v_current_assignee
  from public.conversation_work_states s
  where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id
  for update;

  v_new_state := v_current_state;
  v_new_assignee := v_current_assignee;

  case p_action
    when 'take_over' then
      if p_actor_user_id is null then raise exception 'Actor is required'; end if;
      v_new_state := 'merchant_handling';
      v_new_assignee := coalesce(p_assigned_user_id,p_actor_user_id);

    when 'assign' then
      if p_assigned_user_id is null then raise exception 'Assignee is required'; end if;
      v_new_state := 'merchant_handling';
      v_new_assignee := p_assigned_user_id;

    when 'return_to_ai' then
      v_new_state := 'ai_handling';
      v_new_assignee := null;

    when 'waiting_customer' then
      if p_actor_user_id is null then raise exception 'Actor is required'; end if;
      v_new_state := 'waiting_customer';
      v_new_assignee := coalesce(v_current_assignee,p_actor_user_id);

    when 'resolve' then
      v_new_state := 'resolved';

    when 'needs_merchant' then
      v_new_state := 'needs_merchant';

    when 'reopen' then
      v_new_state := 'needs_merchant';

    else
      raise exception 'Unsupported conversation action';
  end case;

  if v_new_assignee is not null and not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_new_assignee
  ) then
    raise exception 'Assigned team member is not part of this business';
  end if;

  update public.conversation_work_states s
  set state=v_new_state,
      assigned_user_id=v_new_assignee,
      last_state_reason=nullif(left(btrim(coalesce(p_note,'')),500),''),
      last_merchant_reply_at=case when p_action='waiting_customer' then v_now else s.last_merchant_reply_at end,
      resolved_at=case when v_new_state='resolved' then v_now else null end,
      updated_by_user_id=p_actor_user_id,
      updated_at=v_now
  where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id;

  insert into public.conversation_work_events(
    tenant_id,customer_id,action,from_state,to_state,actor_user_id,
    from_assigned_user_id,to_assigned_user_id,note
  ) values (
    p_tenant_id,p_customer_id,p_action,v_current_state,v_new_state,p_actor_user_id,
    v_current_assignee,v_new_assignee,nullif(left(btrim(coalesce(p_note,'')),500),'')
  );

  return jsonb_build_object(
    'customerId',p_customer_id,
    'state',v_new_state,
    'assignedUserId',v_new_assignee,
    'updatedAt',v_now
  );
end;
$$;

revoke all on function sellertray_private.apply_conversation_work_action(uuid,uuid,text,uuid,uuid,text)
  from public,anon,authenticated;

create or replace function public.sellertray_update_conversation_work_state(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_action text,
  p_assigned_user_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  return sellertray_private.apply_conversation_work_action(
    p_tenant_id,p_customer_id,p_action,v_user_id,p_assigned_user_id,p_note
  );
end;
$$;

revoke all on function public.sellertray_update_conversation_work_state(uuid,uuid,text,uuid,text)
  from public,anon;
grant execute on function public.sellertray_update_conversation_work_state(uuid,uuid,text,uuid,text)
  to authenticated;

create or replace function public.sellertray_apply_conversation_service_action(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_action text,
  p_actor_user_id uuid default null,
  p_assigned_user_id uuid default null,
  p_note text default null
)
returns jsonb
language sql
security definer
set search_path=''
as $$
  select sellertray_private.apply_conversation_work_action(
    p_tenant_id,p_customer_id,p_action,p_actor_user_id,p_assigned_user_id,p_note
  );
$$;

revoke all on function public.sellertray_apply_conversation_service_action(uuid,uuid,text,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.sellertray_apply_conversation_service_action(uuid,uuid,text,uuid,uuid,text)
  to service_role;

create or replace function public.sellertray_note_conversation_inbound(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_requires_merchant boolean default false
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_old_state text;
  v_old_assignee uuid;
  v_new_state text;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.customers c
    where c.tenant_id=p_tenant_id and c.id=p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  insert into public.conversation_work_states(
    tenant_id,customer_id,state,last_customer_message_at,updated_at
  ) values (
    p_tenant_id,p_customer_id,
    case when p_requires_merchant then 'needs_merchant' else 'ai_handling' end,
    v_now,v_now
  )
  on conflict (tenant_id,customer_id) do nothing;

  select s.state,s.assigned_user_id
  into v_old_state,v_old_assignee
  from public.conversation_work_states s
  where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id
  for update;

  if p_requires_merchant then
    v_new_state := 'needs_merchant';
  elsif v_old_state='waiting_customer' then
    v_new_state := 'merchant_handling';
  elsif v_old_state='resolved' then
    v_new_state := 'ai_handling';
  else
    v_new_state := v_old_state;
  end if;

  update public.conversation_work_states s
  set state=v_new_state,
      last_customer_message_at=v_now,
      resolved_at=case when v_new_state='resolved' then s.resolved_at else null end,
      updated_at=v_now
  where s.tenant_id=p_tenant_id and s.customer_id=p_customer_id;

  if v_new_state is distinct from v_old_state then
    insert into public.conversation_work_events(
      tenant_id,customer_id,action,from_state,to_state,
      from_assigned_user_id,to_assigned_user_id,note
    ) values (
      p_tenant_id,p_customer_id,
      case
        when p_requires_merchant then 'needs_merchant'
        when v_old_state='resolved' then 'reopen'
        else 'customer_message'
      end,
      v_old_state,v_new_state,v_old_assignee,v_old_assignee,
      case when p_requires_merchant then 'Automation paused for merchant review' else null end
    );
  end if;

  return v_new_state;
end;
$$;

revoke all on function public.sellertray_note_conversation_inbound(uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.sellertray_note_conversation_inbound(uuid,uuid,boolean)
  to service_role;

create or replace function public.sellertray_list_conversations(
  p_tenant_id uuid,
  p_limit integer default 200
)
returns table(
  customer_id uuid,
  customer_name text,
  customer_phone text,
  customer_wa_id text,
  work_state text,
  assigned_user_id uuid,
  assigned_user_email text,
  last_state_reason text,
  last_inbound_message_id uuid,
  last_inbound_text text,
  last_inbound_at timestamptz,
  last_outbound_text text,
  last_outbound_at timestamptz,
  latest_order_id uuid,
  latest_order_public_id text,
  latest_order_status text,
  latest_order_payment_status text,
  last_activity_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  return query
  select
    c.id,
    coalesce(nullif(btrim(c.display_name),''),c.phone,c.wa_id,'WhatsApp customer'),
    c.phone,
    c.wa_id,
    coalesce(ws.state,'ai_handling'),
    ws.assigned_user_id,
    au.email::text,
    ws.last_state_reason,
    li.id,
    li.text_body,
    li.received_at,
    lo.message_body,
    lo.created_at,
    ord.id,
    ord.public_order_id,
    ord.status,
    ord.payment_status,
    greatest(
      coalesce(li.received_at,'epoch'::timestamptz),
      coalesce(lo.created_at,'epoch'::timestamptz),
      coalesce(ord.updated_at,'epoch'::timestamptz),
      coalesce(ws.updated_at,'epoch'::timestamptz)
    )
  from public.customers c
  left join public.conversation_work_states ws
    on ws.tenant_id=c.tenant_id and ws.customer_id=c.id
  left join auth.users au
    on au.id=ws.assigned_user_id
  left join lateral (
    select im.id,im.text_body,im.received_at
    from public.inbound_messages im
    where im.tenant_id=c.tenant_id and im.customer_id=c.id
    order by im.received_at desc
    limit 1
  ) li on true
  left join lateral (
    select n.message_body,n.created_at
    from public.outbound_notifications n
    where n.tenant_id=c.tenant_id and n.customer_id=c.id
    order by n.created_at desc
    limit 1
  ) lo on true
  left join lateral (
    select o.id,o.public_order_id,o.status,o.payment_status,o.updated_at
    from public.orders o
    where o.tenant_id=c.tenant_id and o.customer_id=c.id
    order by o.updated_at desc
    limit 1
  ) ord on true
  where c.tenant_id=p_tenant_id
    and (li.id is not null or ws.customer_id is not null)
  order by greatest(
    coalesce(li.received_at,'epoch'::timestamptz),
    coalesce(lo.created_at,'epoch'::timestamptz),
    coalesce(ord.updated_at,'epoch'::timestamptz),
    coalesce(ws.updated_at,'epoch'::timestamptz)
  ) desc
  limit greatest(1,least(coalesce(p_limit,200),500));
end;
$$;

revoke all on function public.sellertray_list_conversations(uuid,integer)
  from public,anon;
grant execute on function public.sellertray_list_conversations(uuid,integer)
  to authenticated,service_role;

alter table public.outbound_notifications
  drop constraint if exists outbound_notifications_event_key_check;

alter table public.outbound_notifications
  add constraint outbound_notifications_event_key_check
  check (event_key = any(array[
    'order_received'::text,
    'order_accepted'::text,
    'order_ready'::text,
    'order_out_for_delivery'::text,
    'order_rejected'::text,
    'order_cancelled'::text,
    'order_status_reply'::text,
    'order_receipt'::text,
    'order_change_request_received'::text,
    'payment_options'::text,
    'payment_instructions'::text,
    'payment_claim_received'::text,
    'payment_confirmed'::text,
    'payment_status_reply'::text,
    'financial_document'::text,
    'customer_enquiry_reply'::text,
    'merchant_conversation_reply'::text,
    'workflow_clarification'::text
  ]));

commit;
