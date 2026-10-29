-- Add observed natural-language phrases from live SellerTray WhatsApp usage.

insert into public.sellertray_intent_vocab(intent,phrase,match_mode,confidence,priority)
values
('payment_options','how to pay','exact',0.98,10),
('financial_receipt_request','i need receipt','exact',0.97,10),
('financial_receipt_request','i need my receipt','exact',0.98,10),
('financial_receipt_request','receipt please','exact',0.97,10),
('financial_receipt_request','send my receipt','exact',0.98,10),
('invoice_request','i need invoice','exact',0.98,10),
('invoice_request','send my invoice','exact',0.98,10),
('delivery_confirm','order received','exact',0.99,10),
('delivery_confirm','received thanks','exact',0.99,10),
('delivery_confirm','received thank you','exact',0.99,10),
('general_chatter','hello again','exact',0.99,5),
('general_chatter','hello there','exact',0.99,5),
('general_chatter','thank you for the order','exact',0.99,5),
('general_chatter','thanks for the order','exact',0.99,5)
on conflict do nothing;
