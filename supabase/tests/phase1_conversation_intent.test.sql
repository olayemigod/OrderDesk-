begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

select extensions.ok(
  to_regclass('public.sellertray_intent_vocab') is not null,
  'conversation vocabulary table exists'
);
select extensions.ok(
  to_regclass('public.sellertray_intent_events') is not null,
  'conversation intent telemetry table exists'
);
select extensions.ok(
  to_regclass('public.sellertray_intent_vocab_candidates') is not null,
  'AI vocabulary candidate table exists'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.sellertray_intent_vocab'::regclass),
  'conversation vocabulary keeps RLS enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.sellertray_intent_events'::regclass),
  'conversation intent telemetry keeps RLS enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.sellertray_intent_vocab_candidates'::regclass),
  'AI vocabulary candidates keep RLS enabled'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_intent_vocab','SELECT'),
  'merchant clients cannot read platform vocabulary directly'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_intent_events','SELECT'),
  'merchant clients cannot read raw intent telemetry directly'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.sellertray_record_intent_vocab_candidate(text,text,numeric,uuid)',
    'EXECUTE'
  ),
  'AI candidate learner is server-only'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.sellertray_record_intent_vocab_candidate(text,text,numeric,uuid)',
    'EXECUTE'
  ),
  'service role can accumulate AI vocabulary candidates'
);

select extensions.ok(
  (select count(*) from public.sellertray_intent_vocab where active) >= 150,
  'SellerTray ships a broad active intent vocabulary'
);

select extensions.is(
  (
    select intent
    from public.sellertray_intent_vocab
    where phrase='paid' and match_mode='exact' and active
    order by priority asc limit 1
  ),
  'payment_claim',
  '"paid" maps to payment claim'
);

select extensions.is(
  (
    select intent
    from public.sellertray_intent_vocab
    where phrase='no need again' and match_mode='exact' and active
    order by priority asc limit 1
  ),
  'order_cancel',
  '"no need again" maps to cancellation intent'
);

select extensions.is(
  (
    select intent
    from public.sellertray_intent_vocab
    where phrase='where my order dey' and match_mode='exact' and active
    order by priority asc limit 1
  ),
  'order_status',
  'Pidgin order-status vocabulary is available'
);

select extensions.ok(
  position('customer_complaint' in pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='public.merchant_notifications'::regclass
      and conname='merchant_notifications_event_check'
  ))) > 0
  and position('refund_request' in pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='public.merchant_notifications'::regclass
      and conname='merchant_notifications_event_check'
  ))) > 0,
  'merchant notifications support conversation workflow attention events'
);

select * from extensions.finish();
rollback;
