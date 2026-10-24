-- SellerTray pre-QA hardening: customer enquiries, enquiry-to-order tracking,
-- commercial action audit ledger, and channel-aware intent vocabulary.

create table if not exists public.customer_enquiries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_inbound_message_id uuid not null references public.inbound_messages(id) on delete cascade,
  channel text not null default 'whatsapp'
    check (channel in ('whatsapp','instagram','messenger','web','api')),
  enquiry_type text not null
    check (enquiry_type in ('price','availability','product','general')),
  status text not null default 'open'
    check (status in ('open','replied','converted','dismissed')),
  original_text text not null,
  normalized_text text not null,
  product_query text,
  matched_catalog_item_id uuid references public.catalog_items(id) on delete set null,
  matched_item_name text,
  quoted_price numeric(18,2),
  currency text not null default 'NGN',
  response_text text,
  converted_order_id uuid references public.orders(id) on delete set null,
  intent_event_id uuid references public.sellertray_intent_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  replied_at timestamptz,
  converted_at timestamptz,
  unique(tenant_id,source_inbound_message_id)
);

alter table public.customer_enquiries enable row level security;
revoke all on public.customer_enquiries from public,anon,authenticated;
grant all on public.customer_enquiries to service_role;

create index if not exists customer_enquiries_tenant_status_created_idx
  on public.customer_enquiries(tenant_id,status,created_at desc);
create index if not exists customer_enquiries_customer_created_idx
  on public.customer_enquiries(tenant_id,customer_id,created_at desc);
create index if not exists customer_enquiries_catalogue_idx
  on public.customer_enquiries(matched_catalog_item_id)
  where matched_catalog_item_id is not null;
create index if not exists customer_enquiries_converted_order_idx
  on public.customer_enquiries(converted_order_id)
  where converted_order_id is not null;

create table if not exists public.commercial_action_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action_key text not null,
  channel text not null default 'whatsapp'
    check (channel in ('whatsapp','instagram','messenger','web','api','merchant_app','system')),
  source_inbound_message_id uuid references public.inbound_messages(id) on delete set null,
  intent_event_id uuid references public.sellertray_intent_events(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  target_order_id uuid references public.orders(id) on delete set null,
  action_type text not null,
  risk_class text not null default 'low'
    check (risk_class in ('low','medium','high')),
  requested_by text not null
    check (requested_by in ('customer','merchant','staff','ai','system')),
  interpretation_source text
    check (interpretation_source is null or interpretation_source in ('vocabulary','rules','context','ai','none')),
  interpretation_confidence numeric(5,4)
    check (interpretation_confidence is null or (interpretation_confidence >= 0 and interpretation_confidence <= 1)),
  policy_result text not null default 'pending'
    check (policy_result in ('pending','allowed','blocked','clarification_required','not_applicable')),
  action_status text not null default 'requested'
    check (action_status in ('requested','applied','rejected','clarification_required','failed')),
  financial_impact numeric(18,2),
  currency text,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique(tenant_id,action_key)
);

alter table public.commercial_action_ledger enable row level security;
revoke all on public.commercial_action_ledger from public,anon,authenticated;
grant all on public.commercial_action_ledger to service_role;

create index if not exists commercial_action_ledger_tenant_created_idx
  on public.commercial_action_ledger(tenant_id,created_at desc);
create index if not exists commercial_action_ledger_order_idx
  on public.commercial_action_ledger(target_order_id,created_at desc)
  where target_order_id is not null;
create index if not exists commercial_action_ledger_message_idx
  on public.commercial_action_ledger(source_inbound_message_id)
  where source_inbound_message_id is not null;

alter table public.sellertray_intent_events
  add column if not exists channel text not null default 'whatsapp';

alter table public.sellertray_intent_events
  drop constraint if exists sellertray_intent_events_channel_check;

alter table public.sellertray_intent_events
  add constraint sellertray_intent_events_channel_check
  check (channel in ('whatsapp','instagram','messenger','web','api'));

create or replace function public.sellertray_list_customer_enquiries(
  p_tenant_id uuid,
  p_status text default null,
  p_limit integer default 100
)
returns table(
  id uuid,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  enquiry_type text,
  status text,
  original_text text,
  product_query text,
  matched_catalog_item_id uuid,
  matched_item_name text,
  quoted_price numeric,
  currency text,
  response_text text,
  converted_order_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then raise exception 'SellerTray business membership required'; end if;

  return query
  select
    e.id,e.customer_id,
    coalesce(nullif(btrim(c.display_name),''),c.phone,c.wa_id,'Customer'),
    c.phone,
    e.enquiry_type,e.status,e.original_text,e.product_query,
    e.matched_catalog_item_id,e.matched_item_name,e.quoted_price,e.currency,
    e.response_text,e.converted_order_id,e.created_at
  from public.customer_enquiries e
  join public.customers c on c.id=e.customer_id and c.tenant_id=e.tenant_id
  where e.tenant_id=p_tenant_id
    and (p_status is null or e.status=p_status)
  order by e.created_at desc
  limit greatest(1,least(coalesce(p_limit,100),500));
end;
$$;

revoke all on function public.sellertray_list_customer_enquiries(uuid,text,integer) from public,anon;
grant execute on function public.sellertray_list_customer_enquiries(uuid,text,integer)
to authenticated,service_role;

insert into public.sellertray_intent_vocab(intent,phrase,match_mode,confidence,priority)
values
('product_price_enquiry','how much is','prefix',0.98,8),
('product_price_enquiry','how much are','prefix',0.98,8),
('product_price_enquiry','how much be','prefix',0.97,8),
('product_price_enquiry','price of','prefix',0.98,8),
('product_price_enquiry','what is the price of','prefix',0.99,5),
('product_price_enquiry','whats the price of','prefix',0.99,5),
('product_price_enquiry','wetin be the price','prefix',0.96,10),
('product_availability_enquiry','do you have','prefix',0.98,8),
('product_availability_enquiry','do you sell','prefix',0.97,10),
('product_availability_enquiry','is this available','prefix',0.98,8),
('product_availability_enquiry','is it available','prefix',0.96,12),
('product_availability_enquiry','you get','prefix',0.94,15),
('product_availability_enquiry','una get','prefix',0.94,15),
('product_enquiry','tell me about','prefix',0.93,20),
('product_enquiry','what size','prefix',0.94,20),
('product_enquiry','which one','prefix',0.88,40)
on conflict do nothing;

update public.sellertray_intent_vocab
set active=false
where intent='catalogue_query'
  and phrase in (
    'how much is','how much for','price of','do you have','is this available',
    'you get','una get','how much be','wetin be the price'
  );

alter table public.merchant_notifications
  drop constraint if exists merchant_notifications_event_check;

alter table public.merchant_notifications
  add constraint merchant_notifications_event_check
  check (event_key in (
    'new_whatsapp_order',
    'order_change_request',
    'new_whatsapp_message',
    'payment_verification_required',
    'payment_confirmed',
    'payment_failed',
    'payment_exception',
    'payment_gate_blocked',
    'customer_complaint',
    'refund_request',
    'catalogue_enquiry',
    'customer_enquiry',
    'workflow_clarification'
  ));
