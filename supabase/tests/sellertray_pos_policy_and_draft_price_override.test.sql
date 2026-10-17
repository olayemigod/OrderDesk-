begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

select extensions.has_column('public','merchant_operational_policies','allow_pos_price_override','POS policy stores price override choice');
select extensions.has_column('public','merchant_operational_policies','allow_pos_split_payments','POS policy stores split payment choice');
select extensions.has_column('public','merchant_operational_policies','allow_pos_partial_payments','POS policy stores partial payment choice');
select extensions.has_column('public','merchant_operational_policies','allow_pos_pay_later','POS policy stores pay later choice');
select extensions.has_column('public','merchant_operational_policies','pos_manual_confirmation_mode','POS policy stores manual confirmation authority');
select extensions.ok(to_regprocedure('public.sellertray_get_pos_policy(uuid)') is not null,'POS policy reader exists');
select extensions.ok(to_regprocedure('public.sellertray_save_pos_policy(uuid,boolean,boolean,boolean,boolean,text)') is not null,'POS policy save command exists');
select extensions.ok(to_regprocedure('public.sellertray_user_can_confirm_pos_manual_payment(uuid,uuid,uuid)') is not null,'manual payment confirmation authority helper exists');
select extensions.ok(
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_sellertray_pos_draft_items' and lower(pg_get_functiondef(p.oid)) like '%unitprice%' and lower(pg_get_functiondef(p.oid)) like '%allow_pos_price_override%' and lower(pg_get_functiondef(p.oid)) like '%can_manage_orders%'),
  'draft edit command governs price override by merchant policy and capability'
);
select extensions.ok(
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellertray_user_can_confirm_pos_manual_payment' and lower(pg_get_functiondef(p.oid)) like '%branch_operator%' and lower(pg_get_functiondef(p.oid)) like '%can_manage_payments%' and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'),
  'manual confirmation policy preserves Branch authority and optional payment-manager authority'
);
select extensions.ok(
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='confirm_sellertray_offline_payment' and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_confirm_pos_manual_payment%'),
  'POS manual payment confirmation consumes merchant confirmation policy'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.sellertray_user_can_confirm_pos_manual_payment(uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.sellertray_user_can_confirm_pos_manual_payment(uuid,uuid,uuid)','EXECUTE'),
  'manual confirmation authority helper stays behind service boundary'
);

select * from extensions.finish();
rollback;
