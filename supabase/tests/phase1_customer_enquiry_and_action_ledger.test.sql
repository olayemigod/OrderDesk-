begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(18);

select extensions.ok(
  to_regclass('public.customer_enquiries') is not null,
  'customer enquiry table exists'
);
select extensions.ok(
  to_regclass('public.commercial_action_ledger') is not null,
  'commercial action ledger exists'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.customer_enquiries'::regclass),
  'customer enquiries keep RLS enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid='public.commercial_action_ledger'::regclass),
  'commercial action ledger keeps RLS enabled'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.customer_enquiries','SELECT'),
  'raw customer enquiry rows are not directly exposed to merchant clients'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.commercial_action_ledger','SELECT'),
  'raw commercial audit ledger is server-only'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sellertray_list_customer_enquiries(uuid,text,integer)',
    'EXECUTE'
  ),
  'authenticated tenant members can use the governed enquiry list RPC'
);
select extensions.is(
  (
    select intent
    from public.sellertray_intent_vocab
    where phrase='how much is' and match_mode='prefix' and active
    order by priority asc limit 1
  ),
  'product_price_enquiry',
  'price question vocabulary maps to price enquiry'
);
select extensions.is(
  (
    select intent
    from public.sellertray_intent_vocab
    where phrase='do you have' and match_mode='prefix' and active
    order by priority asc limit 1
  ),
  'product_availability_enquiry',
  'availability question vocabulary maps to availability enquiry'
);
select extensions.ok(
  not exists(
    select 1
    from public.sellertray_intent_vocab
    where active
      and intent='catalogue_query'
      and phrase in ('how much is','price of','do you have','is this available')
  ),
  'legacy broad catalogue phrases cannot beat enquiry-specific intents'
);
select extensions.ok(
  exists(
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='sellertray_intent_events'
      and column_name='channel'
  ),
  'intent telemetry carries an explicit source channel'
);
select extensions.ok(
  position('instagram' in pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='public.sellertray_intent_events'::regclass
      and conname='sellertray_intent_events_channel_check'
  ))) > 0,
  'intent channel contract is ready for non-WhatsApp adapters'
);
select extensions.ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='customer_enquiries'
      and indexname='customer_enquiries_tenant_status_created_idx'
  ),
  'customer enquiry operational index exists'
);
select extensions.ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='commercial_action_ledger'
      and indexname='commercial_action_ledger_tenant_created_idx'
  ),
  'commercial audit tenant index exists'
);
select extensions.ok(
  exists(
    select 1 from pg_constraint
    where conrelid='public.commercial_action_ledger'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) like '%tenant_id, action_key%'
  ),
  'commercial actions are idempotent per tenant/action key'
);
select extensions.ok(
  position('customer_enquiry' in pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='public.merchant_notifications'::regclass
      and conname='merchant_notifications_event_check'
  ))) > 0,
  'merchant notifications support customer enquiry leads'
);
select extensions.ok(
  (select count(*) from public.sellertray_intent_vocab where active and intent like 'product_%_enquiry') >= 10,
  'specific product enquiry vocabulary is populated'
);
select extensions.ok(
  (select count(*) from public.sellertray_intent_vocab where active) >= 200,
  'SellerTray retains a broad natural-language vocabulary'
);

select * from extensions.finish();
rollback;
