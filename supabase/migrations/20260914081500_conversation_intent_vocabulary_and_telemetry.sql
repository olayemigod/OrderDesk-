-- SellerTray unified conversation intent vocabulary, telemetry and AI-learning candidates.

create table if not exists public.sellertray_intent_vocab (
  id bigserial primary key,
  intent text not null,
  phrase text not null,
  match_mode text not null default 'exact'
    check (match_mode in ('exact','contains','prefix')),
  locale text not null default 'en-NG',
  confidence numeric(4,3) not null default 0.930
    check (confidence >= 0 and confidence <= 1),
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(intent, phrase, match_mode, locale)
);

alter table public.sellertray_intent_vocab enable row level security;
revoke all on public.sellertray_intent_vocab from public, anon, authenticated;
grant all on public.sellertray_intent_vocab to service_role;

create table if not exists public.sellertray_intent_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_inbound_message_id uuid not null references public.inbound_messages(id) on delete cascade,
  intent text not null,
  source text not null check (source in ('vocabulary','rules','context','ai','none')),
  confidence numeric(5,4) not null default 0 check (confidence >= 0 and confidence <= 1),
  target_order_id uuid references public.orders(id) on delete set null,
  target_order_ref text,
  ai_model text,
  ai_input_tokens integer,
  ai_output_tokens integer,
  ai_total_tokens integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(tenant_id, source_inbound_message_id)
);

alter table public.sellertray_intent_events enable row level security;
revoke all on public.sellertray_intent_events from public, anon, authenticated;
grant all on public.sellertray_intent_events to service_role;

create index if not exists sellertray_intent_events_tenant_created_idx
  on public.sellertray_intent_events(tenant_id, created_at desc);
create index if not exists sellertray_intent_events_intent_created_idx
  on public.sellertray_intent_events(intent, created_at desc);

create table if not exists public.sellertray_intent_vocab_candidates (
  normalized_phrase text not null,
  intent text not null,
  locale text not null default 'en-NG',
  observations integer not null default 1,
  max_confidence numeric(5,4) not null default 0,
  last_source_message_id uuid references public.inbound_messages(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  promoted boolean not null default false,
  primary key(normalized_phrase, intent, locale)
);

alter table public.sellertray_intent_vocab_candidates enable row level security;
revoke all on public.sellertray_intent_vocab_candidates from public, anon, authenticated;
grant all on public.sellertray_intent_vocab_candidates to service_role;

insert into public.sellertray_intent_vocab(intent,phrase,match_mode,confidence,priority)
values
('payment_claim','paid','exact',0.99,10),
('payment_claim','i have paid','exact',0.99,10),
('payment_claim','ive paid','exact',0.99,10),
('payment_claim','i ve paid','exact',0.99,10),
('payment_claim','payment done','exact',0.99,10),
('payment_claim','payment made','exact',0.99,10),
('payment_claim','transfer done','exact',0.99,10),
('payment_claim','transferred','exact',0.97,10),
('payment_claim','i transferred','prefix',0.97,15),
('payment_claim','i sent the money','exact',0.98,10),
('payment_claim','money sent','exact',0.97,10),
('payment_claim','check your account','exact',0.95,20),
('payment_claim','check account','exact',0.94,20),
('payment_claim','i don pay','exact',0.98,10),
('payment_claim','don pay','exact',0.98,10),
('payment_claim','i don transfer','exact',0.98,10),
('payment_claim','done payment','exact',0.98,10),
('payment_options','how can i pay','exact',0.98,10),
('payment_options','how do i pay','exact',0.98,10),
('payment_options','where can i pay','exact',0.97,10),
('payment_options','send account','exact',0.97,10),
('payment_options','send account details','exact',0.99,10),
('payment_options','send bank details','exact',0.99,10),
('payment_options','bank details','exact',0.97,10),
('payment_options','payment options','exact',0.99,10),
('payment_options','payment details','exact',0.99,10),
('payment_options','i want to pay','exact',0.98,10),
('payment_options','i wan pay','exact',0.98,10),
('payment_options','make i pay','exact',0.97,10),
('payment_status','has my payment reflected','exact',0.99,10),
('payment_status','did my payment reflect','exact',0.99,10),
('payment_status','payment status','exact',0.99,10),
('payment_status','has it reflected','exact',0.95,20),
('payment_status','did it enter','exact',0.94,20),
('order_cancel','cancel it','exact',0.98,10),
('order_cancel','cancel my order','exact',0.99,10),
('order_cancel','i dont want it again','exact',0.98,10),
('order_cancel','i do not want it again','exact',0.98,10),
('order_cancel','no need again','exact',0.96,20),
('order_cancel','dont worry again','exact',0.94,30),
('order_cancel','dont send it again','exact',0.98,10),
('order_cancel','stop the order','exact',0.98,10),
('order_cancel','leave it','exact',0.90,40),
('order_add_items','add one','prefix',0.90,40),
('order_add_items','add two','prefix',0.90,40),
('order_add_items','add another','prefix',0.92,30),
('order_add_items','include','prefix',0.88,50),
('order_remove_items','remove','prefix',0.94,20),
('order_remove_items','take out','prefix',0.93,20),
('order_remove_items','dont add','prefix',0.90,40),
('order_change_items','make it','prefix',0.90,40),
('order_change_items','change it to','prefix',0.94,20),
('order_change_items','instead make it','contains',0.92,30),
('order_status','where is my order','exact',0.99,10),
('order_status','order status','exact',0.99,10),
('order_status','track my order','exact',0.99,10),
('order_status','whats happening with my order','exact',0.97,10),
('delivery_status','has the rider left','exact',0.98,10),
('delivery_status','where is the rider','exact',0.98,10),
('delivery_status','is it on the way','exact',0.96,20),
('delivery_confirm','received','exact',0.99,10),
('delivery_confirm','i received it','exact',0.99,10),
('delivery_confirm','i have received it','exact',0.99,10),
('delivery_confirm','got it','exact',0.97,10),
('delivery_confirm','i got it','exact',0.98,10),
('delivery_confirm','it has arrived','exact',0.96,20),
('invoice_request','send invoice','exact',0.99,10),
('invoice_request','invoice','exact',0.98,10),
('financial_receipt_request','send receipt','exact',0.98,10),
('financial_receipt_request','payment receipt','exact',0.99,10),
('financial_receipt_request','send payment receipt','exact',0.99,10),
('pickup_request','ill pick it up','exact',0.98,10),
('pickup_request','i will pick it up','exact',0.98,10),
('pickup_request','i will pick it myself','exact',0.98,10),
('pickup_request','i go pick am','exact',0.97,10),
('delivery_instruction','send it to my office','prefix',0.94,20),
('delivery_instruction','deliver to','prefix',0.94,20),
('delivery_instruction','bring it to','prefix',0.93,20),
('delivery_instruction','use this address','prefix',0.94,20),
('catalogue_query','do you have','prefix',0.88,50),
('catalogue_query','how much is','prefix',0.90,40),
('catalogue_query','how much for','prefix',0.90,40),
('catalogue_query','price of','prefix',0.90,40),
('catalogue_query','is this available','exact',0.94,20),
('complaint','this is not what i ordered','exact',0.99,10),
('complaint','wrong order','exact',0.98,10),
('complaint','i have a complaint','exact',0.99,10),
('complaint','something is wrong','exact',0.91,40),
('complaint','this is wrong','exact',0.93,30),
('refund_request','i want my money back','exact',0.99,10),
('refund_request','refund me','exact',0.99,10),
('refund_request','i want a refund','exact',0.99,10),
('refund_request','return my money','exact',0.98,10),
('general_chatter','thanks','exact',0.99,5),
('general_chatter','thank you','exact',0.99,5),
('general_chatter','okay','exact',0.99,5),
('general_chatter','ok','exact',0.99,5),
('general_chatter','alright','exact',0.99,5),
('general_chatter','nice','exact',0.97,5),
('general_chatter','great','exact',0.97,5),
('general_chatter','good morning','exact',0.99,5),
('general_chatter','good afternoon','exact',0.99,5),
('general_chatter','good evening','exact',0.99,5),
('general_chatter','noted','exact',0.98,5)
on conflict do nothing;

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
    'workflow_clarification'
  ));
