begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(38);

select extensions.ok((select relrowsecurity from pg_class where oid='public.orders'::regclass),'orders keeps RLS enabled');
select extensions.ok((select relrowsecurity from pg_class where oid='public.order_items'::regclass),'order_items keeps RLS enabled');
select extensions.ok((select relrowsecurity from pg_class where oid='public.customers'::regclass),'customers keeps RLS enabled');
select extensions.ok((select relrowsecurity from pg_class where oid='public.inbound_messages'::regclass),'inbound_messages keeps RLS enabled');
select extensions.ok((select relrowsecurity from pg_class where oid='public.merchant_payment_methods'::regclass),'merchant_payment_methods keeps RLS enabled');
select extensions.ok((select relrowsecurity from pg_class where oid='public.order_payments'::regclass),'order_payments keeps RLS enabled');
select extensions.ok((select relrowsecurity from pg_class where oid='public.order_financial_documents'::regclass),'order_financial_documents keeps RLS enabled');

select extensions.ok(not has_table_privilege('authenticated','public.customers','UPDATE'),'authenticated clients cannot directly update customer identity rows');
select extensions.ok(has_function_privilege('authenticated','public.update_sellertray_customer_profile(uuid,uuid,text,text)','EXECUTE'),'authenticated clients use the governed customer-profile RPC');

select extensions.ok(has_column_privilege('authenticated','public.orders','status','UPDATE'),'authenticated merchant may update order status');
select extensions.ok(has_column_privilege('authenticated','public.orders','status_reason','UPDATE'),'authenticated merchant may update status reason');

select extensions.ok(not has_column_privilege('authenticated','public.orders','fulfillment_method','UPDATE'),'fulfillment method is server-governed');
select extensions.ok(not has_column_privilege('authenticated','public.orders','fulfillment_status','UPDATE'),'fulfillment status is server-governed');
select extensions.ok(not has_column_privilege('authenticated','public.orders','delivery_provider','UPDATE'),'delivery provider is server-governed');
select extensions.ok(not has_column_privilege('authenticated','public.orders','delivery_reference','UPDATE'),'delivery reference is server-governed');
select extensions.ok(not has_column_privilege('authenticated','public.orders','delivery_note','UPDATE'),'delivery note is server-governed');
select extensions.ok(not has_column_privilege('authenticated','public.orders','dispatched_at','UPDATE'),'dispatch timestamp is server-governed');
select extensions.ok(not has_column_privilege('authenticated','public.orders','fulfilled_at','UPDATE'),'fulfillment timestamp is server-governed');

select extensions.ok(has_table_privilege('authenticated','public.order_payments','SELECT'),'merchants may read safe payment records');
select extensions.ok(not has_table_privilege('authenticated','public.order_payments','INSERT'),'merchants cannot insert payment records directly');
select extensions.ok(not has_table_privilege('authenticated','public.order_payments','UPDATE'),'merchants cannot update payment records directly');

select extensions.ok(has_table_privilege('authenticated','public.order_financial_documents','SELECT'),'merchants may read financial document records');
select extensions.ok(not has_table_privilege('authenticated','public.order_financial_documents','UPDATE'),'financial documents are not client-updatable');

select extensions.ok(not has_function_privilege('authenticated','public.create_sellertray_manual_order_atomic(uuid,text,text,text,jsonb)','EXECUTE'),'manual atomic order creation is not directly callable by authenticated clients');
select extensions.ok(not has_function_privilege('authenticated','public.create_sellertray_whatsapp_order_atomic(uuid,uuid,uuid,text,numeric,text,text,text[],text,jsonb)','EXECUTE'),'WhatsApp atomic order creation is service-only');
select extensions.ok(not has_function_privilege('authenticated','public.claim_sellertray_inbound_message(uuid)','EXECUTE'),'inbound claim function is service-only');
select extensions.ok(not has_function_privilege('authenticated','public.consume_sellertray_rate_limit(text,text,integer,integer)','EXECUTE'),'rate limiter is service-only');
select extensions.ok(not has_function_privilege('authenticated','public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz)','EXECUTE'),'payment creation RPC is service-only');

select extensions.ok(not has_function_privilege('anon','public.sync_sellertray_order_total_from_items()','EXECUTE'),'anonymous role cannot directly execute order-total trigger function');
select extensions.ok(not has_function_privilege('authenticated','public.sync_sellertray_order_total_from_items()','EXECUTE'),'authenticated role cannot directly execute order-total trigger function');
select extensions.ok(not has_function_privilege('service_role','public.sync_sellertray_order_total_from_items()','EXECUTE'),'service role cannot directly execute trigger-only order-total function');

select extensions.ok(has_function_privilege('service_role','public.create_sellertray_manual_order_atomic(uuid,text,text,text,jsonb)','EXECUTE'),'service role can create manual atomic orders');
select extensions.ok(has_function_privilege('service_role','public.create_sellertray_whatsapp_order_atomic(uuid,uuid,uuid,text,numeric,text,text,text[],text,jsonb)','EXECUTE'),'service role can create WhatsApp atomic orders');
select extensions.ok(has_function_privilege('service_role','public.claim_sellertray_inbound_message(uuid)','EXECUTE'),'service role can claim inbound messages');
select extensions.ok(has_function_privilege('service_role','public.consume_sellertray_rate_limit(text,text,integer,integer)','EXECUTE'),'service role can consume rate limits');
select extensions.ok(has_function_privilege('service_role','public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz)','EXECUTE'),'service role can create governed payments');

select extensions.ok(not has_table_privilege('anon','sellertray_private.request_rate_limits','SELECT'),'anonymous role cannot read private rate-limit ledger');
select extensions.ok(not has_table_privilege('authenticated','sellertray_private.request_rate_limits','SELECT'),'authenticated role cannot read private rate-limit ledger');

select * from extensions.finish();
rollback;
