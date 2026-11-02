begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(47);

select extensions.ok(to_regclass('public.sellertray_feature_catalogue') is not null,'C2 creates the canonical Feature catalogue');
select extensions.ok(to_regclass('public.sellertray_capability_catalogue') is not null,'C2 creates the canonical Capability catalogue');
select extensions.ok(to_regclass('public.sellertray_limit_definitions') is not null,'C2 creates the canonical Limit catalogue');
select extensions.ok((select count(*)>=15 from public.sellertray_feature_catalogue),'Feature catalogue is seeded from real SellerTray product areas');
select extensions.ok((select count(*)>=20 from public.sellertray_capability_catalogue),'Capability catalogue is seeded from real current/future action vocabulary');
select extensions.is((select count(*)::integer from public.sellertray_limit_definitions where code='branch_count'),0,'Branch count is not introduced as a Plan Profile limit');

select extensions.is((select count(*)::integer from public.sellertray_plan_profiles where code in ('starter','growth','scale')),3,'Starter, Growth and Scale exist as editable Plan Profile seeds');
select extensions.is((select count(*)::integer from public.sellertray_plan_profile_versions v join public.sellertray_plan_profiles p on p.id=v.plan_profile_id where p.code in ('starter','growth','scale') and v.version=1 and v.status='draft'),3,'All initial Plan Profile versions remain draft');
select extensions.is((select count(*)::integer from public.sellertray_plan_profile_versions where status='published'),0,'Batch 2 does not publish a speculative plan');
select extensions.is((select count(*)::integer from public.sellertray_plan_profile_feature_grants),0,'Draft Plan Profile seeds have no speculative feature grants');
select extensions.is((select count(*)::integer from public.sellertray_plan_profile_capability_grants),0,'Draft Plan Profile seeds have no speculative capability grants');
select extensions.is((select count(*)::integer from public.sellertray_plan_profile_limit_values),0,'Draft Plan Profile seeds have no speculative limits');

select extensions.ok((select relrowsecurity from pg_class where oid='public.sellertray_plan_profile_versions'::regclass),'Plan Profile versions are protected by RLS');
select extensions.ok(not has_table_privilege('authenticated','public.sellertray_plan_profile_versions','SELECT'),'Merchant clients cannot directly read internal Plan Profile master rows');
select extensions.ok(has_table_privilege('service_role','public.sellertray_plan_profile_versions','SELECT'),'Server authority can inspect Plan Profile versions');
select extensions.ok(has_function_privilege('service_role','public.publish_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid)','EXECUTE'),'Service authority can use governed Plan Profile publication command');
select extensions.ok(not has_function_privilege('authenticated','public.publish_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid)','EXECUTE'),'Merchant clients cannot publish Plan Profiles');
select extensions.ok(position('version identity is immutable' in lower(pg_get_functiondef('public.guard_sellertray_plan_profile_version_mutation()'::regprocedure)))>0,'Plan Profile version identity is immutable');
select extensions.ok(position('v_old_status' in pg_get_functiondef('public.guard_sellertray_profile_grant_mutation()'::regprocedure))>0 and position('v_new_status' in pg_get_functiondef('public.guard_sellertray_profile_grant_mutation()'::regprocedure))>0,'Grant mutation checks both old and new version state');

select extensions.ok(to_regclass('public.sellertray_addon_definitions') is not null and to_regclass('public.sellertray_addon_versions') is not null,'C2 represents versioned add-on entitlement definitions');
select extensions.ok((select relrowsecurity from pg_class where oid='public.sellertray_addon_versions'::regclass),'Add-on versions are protected by RLS');
select extensions.ok(has_function_privilege('service_role','public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid)','EXECUTE'),'Add-on publication is available only through server authority');
select extensions.ok(not has_function_privilege('authenticated','public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid)','EXECUTE'),'Merchant clients cannot publish add-ons');

select extensions.is((select count(*)::integer from public.sellertray_commercial_charge_types where code in ('branch_subscription','branch_setup','addon','additional_staff')),4,'Commercial charge classes are explicit governed data');
select extensions.ok(to_regclass('public.sellertray_commercial_tax_profiles') is not null and to_regclass('public.sellertray_commercial_tax_profile_versions') is not null,'ProcessEdge commercial tax has its own versioned master');
select extensions.ok(to_regclass('public.sellertray_commercial_payment_methods') is not null and to_regclass('public.sellertray_commercial_payment_method_versions') is not null,'ProcessEdge commercial payment methods have a separate versioned master');
select extensions.is((select count(*)::integer from public.sellertray_commercial_payment_methods where code in ('paystack','bank_transfer','flutterwave')),3,'Commercial payment-method identities are seeded without activating version configuration');
select extensions.ok(to_regclass('public.merchant_payment_methods') is not null,'Merchant customer tender authority remains separate from ProcessEdge commercial payment methods');
select extensions.ok(to_regclass('public.sellertray_commercial_adjustment_types') is not null,'Commercial adjustment and discount types are governed data');
select extensions.ok(to_regclass('public.sellertray_commercial_entitlement_override_versions') is not null,'Business-specific recurring entitlement overrides have versioned authority');

select extensions.ok((select is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='sellertray_commercial_tax_profile_versions' and column_name='command_id'),'Tax profile publication is command-idempotent');
select extensions.ok((select is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='sellertray_commercial_payment_method_versions' and column_name='command_id'),'Commercial payment-method publication is command-idempotent');
select extensions.ok(has_function_privilege('service_role','public.publish_sellertray_commercial_tax_profile_version_admin(uuid,numeric,timestamptz,timestamptz,text,uuid,uuid)','EXECUTE'),'Tax profile versions publish through server-only governed command');
select extensions.ok(not has_function_privilege('authenticated','public.publish_sellertray_commercial_tax_profile_version_admin(uuid,numeric,timestamptz,timestamptz,text,uuid,uuid)','EXECUTE'),'Merchant clients cannot publish ProcessEdge commercial tax');

select extensions.ok((select count(*)=1 from information_schema.columns where table_schema='public' and table_name='sellertray_commercial_price_versions' and column_name='plan_profile_version_id'),'Existing price authority can bind a Plan Profile Version');
select extensions.ok((select count(*)=1 from information_schema.columns where table_schema='public' and table_name='sellertray_commercial_price_versions' and column_name='addon_version_id'),'Existing price authority can bind an add-on version');
select extensions.ok(position('additional_staff' in (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.sellertray_commercial_price_versions'::regclass and conname='sellertray_commercial_price_versions_kind_check'))>0,'Existing price authority supports approved additional charge classes');
select extensions.ok(position('legacy c1 10-for-12' in lower(pg_get_functiondef('public.validate_sellertray_commercial_price_version()'::regprocedure)))>0,'Legacy 10-for-12 validation remains explicitly isolated to C1 plan-code prices');
select extensions.ok(has_function_privilege('service_role','public.resolve_sellertray_commercial_v2_price_version(uuid,text,uuid,uuid,text,text,timestamptz)','EXECUTE'),'C2 price resolution is server-only');
select extensions.ok(not has_function_privilege('authenticated','public.resolve_sellertray_commercial_v2_price_version(uuid,text,uuid,uuid,text,text,timestamptz)','EXECUTE'),'Merchant clients cannot bypass C2 price authority');
select extensions.ok(to_regclass('public.sellertray_commercial_price_publication_commands') is not null and (select relrowsecurity from pg_class where oid='public.sellertray_commercial_price_publication_commands'::regclass),'C2 price publication has an immutable RLS-protected command ledger');

select extensions.ok((select count(*)=1 from information_schema.columns where table_schema='public' and table_name='sellertray_installment_policy_versions' and column_name='plan_profile_version_id'),'Installment policy can bind Plan Profile Versions');
select extensions.ok(position('plan_profile_cycle' in (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.sellertray_installment_policy_versions'::regclass and conname='sellertray_installment_policy_scope_kind_check'))>0,'Installment policy adds Plan-Profile-cycle scope without removing legacy plan-cycle scope');
select extensions.ok(has_function_privilege('service_role','public.resolve_sellertray_installment_policy_v2(uuid,uuid,uuid,text,timestamptz)','EXECUTE'),'Plan-Profile-aware installment policy resolver is server-only');
select extensions.ok(to_regprocedure('public.resolve_sellertray_installment_policy(uuid,uuid,text,text,timestamptz)') is not null,'Legacy installment resolver remains available during compatibility period');

select extensions.ok(to_regclass('public.sellertray_branch_subscriptions') is null,'Batch 2 does not create Branch Subscription runtime authority early');
select extensions.ok((select count(*)=0 from information_schema.columns where table_schema='public' and table_name='tenant_subscriptions' and column_name='branch_id'),'Legacy tenant_subscriptions remains Business-scoped during Batch 2');

select * from extensions.finish();
rollback;
