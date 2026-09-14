-- Expand SellerTray vocabulary and accumulate AI-resolved phrases for controlled learning.

create or replace function public.sellertray_record_intent_vocab_candidate(
  p_normalized_phrase text,
  p_intent text,
  p_confidence numeric,
  p_source_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_normalized_phrase is null or btrim(p_normalized_phrase) = '' then
    return;
  end if;

  insert into public.sellertray_intent_vocab_candidates(
    normalized_phrase,intent,locale,observations,max_confidence,last_source_message_id,last_seen_at
  )
  values(
    left(btrim(p_normalized_phrase),500),p_intent,'en-NG',1,
    greatest(0,least(coalesce(p_confidence,0),1)),p_source_message_id,now()
  )
  on conflict(normalized_phrase,intent,locale) do update
  set observations = public.sellertray_intent_vocab_candidates.observations + 1,
      max_confidence = greatest(
        public.sellertray_intent_vocab_candidates.max_confidence,
        excluded.max_confidence
      ),
      last_source_message_id = excluded.last_source_message_id,
      last_seen_at = now();
end;
$$;

revoke all on function public.sellertray_record_intent_vocab_candidate(text,text,numeric,uuid)
from public,anon,authenticated;
grant execute on function public.sellertray_record_intent_vocab_candidate(text,text,numeric,uuid)
to service_role;

insert into public.sellertray_intent_vocab(intent,phrase,match_mode,confidence,priority)
values
('payment_claim','i just paid','exact',0.99,10),
('payment_claim','just paid','exact',0.98,10),
('payment_claim','i paid','exact',0.99,10),
('payment_claim','sent payment','exact',0.98,10),
('payment_claim','payment sent','exact',0.98,10),
('payment_claim','i have transferred','exact',0.99,10),
('payment_claim','i don send am','exact',0.96,20),
('payment_claim','i don send the money','exact',0.98,10),
('payment_claim','money don enter','exact',0.92,30),
('payment_options','account number','exact',0.93,30),
('payment_options','give me account','exact',0.97,10),
('payment_options','give me your account','exact',0.97,10),
('payment_options','which account','exact',0.96,10),
('payment_options','where should i transfer','exact',0.98,10),
('payment_options','where i go pay','exact',0.97,10),
('payment_options','how i go pay','exact',0.97,10),
('payment_status','you don see am','exact',0.91,40),
('payment_status','have you seen it','exact',0.91,40),
('payment_status','have you received payment','exact',0.96,15),
('order_cancel','dont worry','exact',0.91,40),
('order_cancel','no need','exact',0.91,40),
('order_cancel','forget it','exact',0.93,30),
('order_cancel','forget the order','exact',0.98,10),
('order_cancel','leave am','exact',0.91,40),
('order_cancel','abeg cancel am','exact',0.99,10),
('order_cancel','i no want am again','exact',0.98,10),
('order_cancel','i no need am again','exact',0.98,10),
('order_cancel','dont send again','exact',0.98,10),
('order_add_items','add','prefix',0.87,60),
('order_add_items','put another','prefix',0.91,40),
('order_add_items','join','prefix',0.86,60),
('order_add_items','add am','prefix',0.91,40),
('order_add_items','add this','prefix',0.90,40),
('order_remove_items','remove am','prefix',0.95,20),
('order_remove_items','comot','prefix',0.91,40),
('order_remove_items','take this out','prefix',0.96,20),
('order_remove_items','i dont want this one','prefix',0.92,30),
('order_change_items','make am','prefix',0.90,40),
('order_change_items','make it three','prefix',0.94,20),
('order_change_items','make it two','prefix',0.94,20),
('order_change_items','change quantity','prefix',0.96,20),
('order_change_items','change the quantity','prefix',0.97,10),
('order_change_items','use this instead','prefix',0.94,20),
('order_status','where my order dey','exact',0.98,10),
('order_status','wetin happen to my order','exact',0.96,20),
('order_status','my order nko','exact',0.97,10),
('order_status','how far my order','exact',0.96,20),
('delivery_status','where rider dey','exact',0.98,10),
('delivery_status','rider don comot','exact',0.97,10),
('delivery_status','has it left','exact',0.94,25),
('delivery_confirm','i don receive am','exact',0.99,10),
('delivery_confirm','don receive','exact',0.98,10),
('delivery_confirm','e don reach','exact',0.96,20),
('delivery_confirm','it is here','exact',0.95,20),
('pickup_request','i will come for it','exact',0.97,10),
('pickup_request','i go come pick am','exact',0.98,10),
('pickup_request','i will collect it','exact',0.97,10),
('pickup_request','ill collect it','exact',0.97,10),
('delivery_instruction','send am go','prefix',0.90,40),
('delivery_instruction','bring am come','prefix',0.90,40),
('delivery_instruction','this is my address','prefix',0.92,30),
('catalogue_query','you get','prefix',0.87,60),
('catalogue_query','una get','prefix',0.87,60),
('catalogue_query','how much be','prefix',0.90,40),
('catalogue_query','wetin be the price','prefix',0.91,40),
('complaint','this thing no correct','exact',0.96,20),
('complaint','this is not correct','exact',0.96,20),
('complaint','you sent wrong thing','exact',0.98,10),
('complaint','item is missing','exact',0.98,10),
('complaint','something is missing','exact',0.96,20),
('complaint','it is damaged','exact',0.98,10),
('complaint','it is spoilt','exact',0.98,10),
('refund_request','give me my money back','exact',0.99,10),
('refund_request','send my money back','exact',0.99,10),
('refund_request','i need refund','exact',0.99,10),
('general_chatter','oya','exact',0.90,50),
('general_chatter','sharp','exact',0.92,40),
('general_chatter','no wahala','exact',0.97,10)
on conflict do nothing;
