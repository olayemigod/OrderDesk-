-- SellerTray competitive hardening: Nigerian English / Pidgin commercial phrases.
-- These are intent hints only. Order/payment/fulfilment execution continues through
-- the existing governed state machines and safety gates.

insert into public.sellertray_intent_vocab(intent,phrase,match_mode,confidence,priority)
values
('product_price_enquiry','abeg how much be','prefix',0.98,10),
('product_price_enquiry','how much this one be','prefix',0.97,15),
('product_price_enquiry','how much e be','prefix',0.96,20),
('product_availability_enquiry','you get this','prefix',0.96,20),
('product_availability_enquiry','una get this','prefix',0.96,20),
('product_availability_enquiry','this one dey available','prefix',0.96,20),
('product_availability_enquiry','e dey stock','prefix',0.94,25),

('new_order','abeg send me','prefix',0.94,25),
('new_order','abeg give me','prefix',0.94,25),
('new_order','i wan buy','prefix',0.98,10),
('new_order','i wan take','prefix',0.97,15),
('new_order','make una send me','prefix',0.95,20),
('new_order','make you send me','prefix',0.95,20),
('new_order','i need make una send','prefix',0.94,25),

('order_cancel','i no want again','exact',0.99,10),
('order_cancel','i no want this again','exact',0.99,10),
('order_cancel','i no need again','exact',0.99,10),
('order_cancel','no need again','exact',0.98,10),
('order_cancel','abeg no send am','prefix',0.99,10),
('order_cancel','no send am again','prefix',0.99,10),
('order_cancel','leave the order','exact',0.98,10),

('order_change_items','make am two','prefix',0.98,10),
('order_change_items','make am three','prefix',0.98,10),
('order_change_items','reduce am to','prefix',0.97,15),
('order_change_items','increase am to','prefix',0.97,15),
('order_change_items','change am to','prefix',0.97,15),
('order_add_items','join one more','prefix',0.95,20),
('order_add_items','add one more','prefix',0.96,15),
('order_remove_items','comot this one','prefix',0.97,15),
('order_remove_items','remove this one','prefix',0.97,15),

('payment_options','which account make i pay','prefix',0.98,10),
('payment_options','which account make i send am','prefix',0.98,10),
('payment_options','where i fit transfer','prefix',0.98,10),
('payment_claim','i don transfer','prefix',0.99,10),
('payment_claim','i don pay','prefix',0.99,10),
('payment_claim','money don send','exact',0.97,15),
('payment_status','you don receive am','exact',0.96,20),
('payment_status','payment don enter','exact',0.96,20),

('delivery_instruction','you fit send am','prefix',0.97,15),
('delivery_instruction','make rider bring am','prefix',0.97,15),
('delivery_instruction','send am tomorrow','prefix',0.96,20),
('delivery_instruction','bring am tomorrow','prefix',0.96,20),
('delivery_status','how far rider','prefix',0.97,15),
('delivery_status','rider dey where','exact',0.98,10),
('pickup_request','i go pick am','prefix',0.98,10),
('pickup_request','i go collect am','prefix',0.98,10),
('delivery_confirm','i don collect am','exact',0.99,10),
('delivery_confirm','i don get am','exact',0.98,10),

('complaint','this one no be wetin i order','exact',0.99,10),
('complaint','na wrong thing be this','exact',0.98,10),
('complaint','this thing spoil','exact',0.97,15),
('refund_request','abeg refund me','prefix',0.99,10),
('refund_request','abeg send my money back','prefix',0.99,10),

('general_chatter','okay na','exact',0.98,10),
('general_chatter','alright na','exact',0.98,10),
('general_chatter','thanks boss','exact',0.98,10),
('general_chatter','thank you boss','exact',0.98,10),
('general_chatter','we dey','exact',0.94,25)
on conflict do nothing;
