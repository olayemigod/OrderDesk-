-- SellerTray competitive hardening: Nigerian English / Pidgin commercial intent coverage.
-- Keep destructive intent phrases explicit. Bare social phrases such as
-- "don't worry" must not cancel an order without stronger context.

begin;

update public.sellertray_intent_vocab
set active=false
where intent='order_cancel'
  and lower(btrim(phrase)) in ('dont worry','no need','leave it');

insert into public.sellertray_intent_vocab(intent,phrase,match_mode,confidence,priority)
values
('payment_claim','i don send money','exact',0.99,10),
('payment_claim','i don send the money','exact',0.99,10),
('payment_claim','i don send am','exact',0.97,15),
('payment_claim','money don go','exact',0.96,20),
('payment_claim','check account i don pay','exact',0.98,10),
('payment_claim','abeg check your account','exact',0.94,25),
('payment_options','where make i pay','exact',0.98,10),
('payment_options','how i fit pay','exact',0.98,10),
('payment_options','which account make i pay','exact',0.99,10),
('payment_options','which account make i send am','exact',0.99,10),
('payment_status','you don see the transfer','exact',0.98,10),
('payment_status','you don see my payment','exact',0.98,10),
('payment_status','money enter','exact',0.93,25),
('payment_status','payment enter','exact',0.94,25),

('order_cancel','i no want am again','exact',0.99,10),
('order_cancel','i no need am again','exact',0.99,10),
('order_cancel','no send am again','exact',0.99,10),
('order_cancel','make una no send am again','exact',0.99,10),
('order_cancel','make you no send am again','exact',0.99,10),
('order_cancel','forget the order','exact',0.99,10),
('order_cancel','forget am abeg','exact',0.96,20),

('order_add_items','add one more','prefix',0.97,15),
('order_add_items','put one more','prefix',0.95,20),
('order_add_items','join one','prefix',0.93,25),
('order_add_items','add am join','prefix',0.94,20),
('order_remove_items','comot one','prefix',0.97,15),
('order_remove_items','take one comot','prefix',0.96,20),
('order_remove_items','remove one','prefix',0.97,15),
('order_change_items','make am three','prefix',0.97,15),
('order_change_items','make am four','prefix',0.97,15),
('order_change_items','reduce am to','prefix',0.96,20),
('order_change_items','increase am to','prefix',0.96,20),

('order_status','my order nko','exact',0.99,10),
('order_status','how far my order','exact',0.99,10),
('order_status','wetin happen to my order','exact',0.99,10),
('order_status','where my order reach','exact',0.98,10),
('delivery_status','rider nko','exact',0.97,15),
('delivery_status','where rider dey','exact',0.99,10),
('delivery_status','rider don reach where','exact',0.98,10),
('delivery_status','when rider go reach','exact',0.97,15),
('delivery_confirm','i don get am','exact',0.99,10),
('delivery_confirm','i don collect am','exact',0.99,10),
('delivery_confirm','e don reach me','exact',0.99,10),
('pickup_request','i go carry am myself','exact',0.99,10),
('pickup_request','i go come collect am','exact',0.99,10),
('pickup_request','make i come pick am','exact',0.98,10),
('delivery_instruction','make rider bring am','prefix',0.97,15),
('delivery_instruction','you fit send am','prefix',0.96,20),
('delivery_instruction','send am tomorrow','prefix',0.97,15),

('product_price_enquiry','abeg how much be this','prefix',0.98,10),
('product_price_enquiry','how much this','prefix',0.96,20),
('product_price_enquiry','how much for this','prefix',0.97,15),
('product_price_enquiry','wetin this cost','prefix',0.97,15),
('product_price_enquiry','wetin be price','prefix',0.96,20),
('product_availability_enquiry','you get this','prefix',0.96,20),
('product_availability_enquiry','una get this','prefix',0.96,20),
('product_availability_enquiry','this one dey','prefix',0.94,25),
('product_availability_enquiry','e dey available','prefix',0.96,20),
('product_enquiry','which sizes you get','prefix',0.97,15),
('product_enquiry','which size una get','prefix',0.97,15),
('product_enquiry','show me the sizes','prefix',0.96,20),

('complaint','this thing spoil','prefix',0.98,10),
('complaint','e spoil','exact',0.96,20),
('complaint','na wrong thing you send','prefix',0.99,10),
('complaint','you send wrong item','prefix',0.99,10),
('complaint','item no complete','exact',0.98,10),
('complaint','one item no dey','exact',0.97,15),
('refund_request','abeg refund me','exact',0.99,10),
('refund_request','give me back my money','exact',0.99,10),
('refund_request','return my money abeg','exact',0.99,10),

('general_chatter','dont worry','exact',0.98,5),
('general_chatter','no need','exact',0.94,20),
('general_chatter','leave it','exact',0.92,25),
('general_chatter','ehen','exact',0.90,40),
('general_chatter','okay na','exact',0.97,10)
on conflict(intent,phrase,match_mode,locale) do update
set confidence=excluded.confidence,
    priority=excluded.priority,
    active=true;

commit;
