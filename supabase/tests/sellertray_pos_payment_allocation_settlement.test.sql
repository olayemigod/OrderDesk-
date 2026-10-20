begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.has_column('public','orders','pos_payment_terms','POS order snapshots payment terms');
select extensions.has_column('public','orders','pos_checkout_command_id','POS checkout keeps command identity');
select extensions.has_column('public','orders','pos_checkout_request_hash','POS checkout keeps request identity');
select extensions.ok(to_regprocedure('public.sellertray_record_pos_payment_allocation(uuid,uuid,uuid,numeric,text,uuid,text)') is not null,'POS allocation command exists');
select extensions.ok(to_regprocedure('public.sellertray_finalize_pos_order_if_allowed(uuid,uuid,uuid)') is not null,'POS governed finalizer exists');
select extensions.ok(to_regprocedure('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)') is not null,'atomic POS allocation checkout exists');
select extensions.ok(
  lower(pg_get_functiondef('public.guard_sellertray_payment_transition()'::regprocedure)) like '%payment allocations exceed the invoice amount%'
  and lower(pg_get_functiondef('public.guard_sellertray_payment_transition()'::regprocedure)) like '%pending_verification%'
  and lower(pg_get_functiondef('public.guard_sellertray_payment_transition()'::regprocedure)) like '%confirmed%',
  'payment guard reserves aggregate active allocations without requiring each payment to equal the invoice'
);
select extensions.ok(
  lower(pg_get_functiondef('public.sync_sellertray_order_payment_state()'::regprocedure)) like '%v_amount_paid >= v_invoice.amount%'
  or lower(pg_get_functiondef('public.sync_sellertray_order_payment_state()'::regprocedure)) like '%v_amount_paid>=v_invoice.amount%',
  'order becomes paid only when confirmed total covers the invoice'
);
select extensions.ok(
  lower(pg_get_functiondef('public.sync_sellertray_order_payment_state()'::regprocedure)) like '%verification_required%'
  and lower(pg_get_functiondef('public.sync_sellertray_order_payment_state()'::regprocedure)) like '%v_amount_paid > 0%'
  or lower(pg_get_functiondef('public.sync_sellertray_order_payment_state()'::regprocedure)) like '%v_amount_paid>0%',
  'partial and verification states remain distinct in the existing payment vocabulary'
);
select extensions.ok(
  lower(pg_get_functiondef('public.cancel_sellertray_competing_payment_attempts()'::regprocedure)) like '%payment_status%'
  and lower(pg_get_functiondef('public.cancel_sellertray_competing_payment_attempts()'::regprocedure)) like '%paid%',
  'competing payment attempts are cancelled only after the invoice becomes fully paid'
);
select extensions.ok(
  lower(pg_get_functiondef('public.queue_sellertray_payment_confirmation()'::regprocedure)) like '%payment_status%'
  and lower(pg_get_functiondef('public.queue_sellertray_payment_confirmation()'::regprocedure)) like '%paid%',
  'WhatsApp payment confirmation is emitted only for a fully paid order'
);
select extensions.ok(
  lower(pg_get_functiondef('public.sellertray_payment_gate_decision(uuid,text)'::regprocedure)) like '%pos_payment_terms%'
  and lower(pg_get_functiondef('public.sellertray_payment_gate_decision(uuid,text)'::regprocedure)) like '%allow_pos_partial_payments%'
  and lower(pg_get_functiondef('public.sellertray_payment_gate_decision(uuid,text)'::regprocedure)) like '%allow_pos_pay_later%',
  'payment gate consumes explicit governed POS credit terms'
);
select extensions.ok(
  lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%allow_pos_split_payments%'
  and lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%allow_pos_partial_payments%'
  and lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%allow_pos_pay_later%',
  'checkout enforces merchant split, partial and pay-later policy'
);
select extensions.ok(
  lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%pos_checkout_command_id%'
  and lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%pos-allocation:%',
  'split checkout preserves command and allocation idempotency'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)','EXECUTE'),
  'allocation checkout stays behind the service boundary'
);
select extensions.ok(
  lower(pg_get_functiondef('public.confirm_sellertray_offline_payment(uuid,uuid,text)'::regprocedure)) like '%sellertray_finalize_pos_order_if_allowed%'
  and lower(pg_get_functiondef('public.confirm_sellertray_offline_payment(uuid,uuid,text)'::regprocedure)) like '%finalize_sellertray_pos_confirmed_payment%',
  'manual confirmation supports new allocations while preserving legacy bank-transfer finalisation'
);

select extensions.ok(
  lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%providerreference%'
  and lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%offlinecapturedat%',
  'checkout consumes immutable offline Bank reference and capture-time evidence'
);
select extensions.ok(
  lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%v_method_type<>''bank_transfer'' or v_confirm_now%'
  and lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%unconfirmed bank payment%',
  'offline Bank evidence is accepted only for an unconfirmed governed Bank allocation'
);
select extensions.ok(
  lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%provider_reference=v_provider_reference%'
  and lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%customer_claimed_at=v_offline_captured_at%',
  'offline Bank evidence binds to the existing order payment rather than creating separate payment truth'
);
select extensions.ok(
  lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%offline-bank-evidence:%'
  and lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%offline_bank_evidence%'
  and lower(pg_get_functiondef('public.checkout_sellertray_pos_sale(uuid,uuid,jsonb,boolean,uuid,uuid)'::regprocedure)) like '%mobile_offline_pos%',
  'offline Bank evidence creates a deterministic payment audit event'
);

select * from extensions.finish();
rollback;
