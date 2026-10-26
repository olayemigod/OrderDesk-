begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(28);

select extensions.is(
  (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='merchant_notifications' and column_name in ('lifecycle_source_type','lifecycle_source_id')),
  2,
  'merchant notifications carry generic lifecycle source identity'
);
select extensions.ok(
  to_regclass('public.merchant_notifications_lifecycle_source_uniq') is not null,
  'lifecycle source identity has a duplicate-prevention index'
);
select extensions.ok(
  position('activation_attention_required' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.merchant_notifications'::regclass and conname='merchant_notifications_event_check'))) > 0,
  'notification event vocabulary includes governed activation attention'
);
select extensions.ok(to_regprocedure('public.emit_sellertray_lifecycle_notification(uuid,text,text,uuid,text,text,text,uuid,text[],timestamptz)') is not null,'lifecycle notification emitter exists');
select extensions.ok(to_regprocedure('public.sellertray_merchant_unread_notification_count(uuid)') is not null,'tenant-scoped unread count RPC exists');
select extensions.ok(to_regprocedure('public.materialize_sellertray_lifecycle_notifications()') is not null,'timed lifecycle materializer exists');
select extensions.ok(not has_function_privilege('anon','public.emit_sellertray_lifecycle_notification(uuid,text,text,uuid,text,text,text,uuid,text[],timestamptz)','EXECUTE'),'anonymous users cannot invoke lifecycle emitter');
select extensions.ok(not has_function_privilege('authenticated','public.emit_sellertray_lifecycle_notification(uuid,text,text,uuid,text,text,text,uuid,text[],timestamptz)','EXECUTE'),'merchant clients cannot forge lifecycle notifications');
select extensions.ok(not has_function_privilege('anon','public.materialize_sellertray_lifecycle_notifications()','EXECUTE'),'anonymous users cannot invoke lifecycle materializer');
select extensions.ok(not has_function_privilege('authenticated','public.materialize_sellertray_lifecycle_notifications()','EXECUTE'),'merchant clients cannot invoke lifecycle materializer');
select extensions.ok(has_function_privilege('authenticated','public.sellertray_merchant_unread_notification_count(uuid)','EXECUTE'),'authenticated clients can read their governed unread count');
select extensions.ok(not has_function_privilege('anon','public.sellertray_merchant_unread_notification_count(uuid)','EXECUTE'),'anonymous clients cannot read merchant unread counts');

select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_commercial_orders'::regclass and tgname='sellertray_commercial_order_lifecycle_notification' and not tgisinternal),'commercial order facts emit lifecycle notifications');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_commercial_adjustments'::regclass and tgname='sellertray_commercial_adjustment_lifecycle_notification' and not tgisinternal),'commercial adjustment facts emit lifecycle notifications');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_commercial_direct_payment_confirmations'::regclass and tgname='sellertray_direct_payment_lifecycle_notification' and not tgisinternal),'direct payment facts emit lifecycle notifications');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_commercial_installment_payment_confirmations'::regclass and tgname='sellertray_gateway_payment_lifecycle_notification' and not tgisinternal),'gateway payment facts emit lifecycle notifications');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_master_agreement_versions'::regclass and tgname='sellertray_master_agreement_version_notification' and not tgisinternal),'Master Agreement version facts materialize governed notices');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_master_agreement_acceptances'::regclass and tgname='sellertray_master_agreement_acceptance_notification' and not tgisinternal),'Master Agreement acceptance facts emit lifecycle notifications');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_commercial_setup_appointment_events'::regclass and tgname='sellertray_setup_event_lifecycle_notification' and not tgisinternal),'setup appointment facts emit lifecycle notifications');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_commercial_branch_setup_readiness'::regclass and tgname='sellertray_branch_readiness_lifecycle_notification' and not tgisinternal),'Branch readiness facts emit lifecycle notifications');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.sellertray_commercial_entitlement_events'::regclass and tgname='sellertray_entitlement_lifecycle_notification' and not tgisinternal),'entitlement facts emit lifecycle notifications');
select extensions.ok(exists(select 1 from pg_trigger where tgrelid='public.platform_admin_audit'::regclass and tgname='sellertray_activation_attention_notification' and not tgisinternal),'reconciliation failure audit can emit merchant-safe activation attention');
select extensions.ok(
  position('partition by e.tenant_id' in lower(pg_get_functiondef('public.materialize_sellertray_lifecycle_notifications()'::regprocedure))) > 0
  and position('e.effective_from desc' in lower(pg_get_functiondef('public.materialize_sellertray_lifecycle_notifications()'::regprocedure))) > 0,
  'expiry materialization selects the latest canonical entitlement term per Business'
);
select extensions.ok(
  position('not v_has_provisional' in lower(pg_get_functiondef('public.queue_sellertray_entitlement_lifecycle_notification()'::regprocedure))) > 0,
  'direct full-entitlement activation still emits activation success exactly once'
);
select extensions.ok(
  to_regclass('cron.job') is null or exists(select 1 from cron.job where jobname='sellertray-lifecycle-notifications' and active),
  'timed lifecycle materialization is scheduled when pg_cron is available'
);

create temp table oa5a_fixture(tenant_id uuid not null,user_id uuid not null,source_id uuid not null,first_notification_id uuid) on commit drop;
insert into oa5a_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null);
insert into auth.users(id,email,aud,role,created_at,updated_at)
select user_id,'oa5a-'||substr(user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from oa5a_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'OA5A Test Business','oa5a-'||substr(tenant_id::text,1,8),'O5A','trial' from oa5a_fixture;
insert into public.tenant_members(tenant_id,user_id,role) select tenant_id,user_id,'owner' from oa5a_fixture;

update oa5a_fixture f set first_notification_id=public.emit_sellertray_lifecycle_notification(
  f.tenant_id,'commercial_order_created','oa5a_test',f.source_id,'info','OA5A lifecycle test','First governed lifecycle notification.'
);
select extensions.is(
  public.emit_sellertray_lifecycle_notification(f.tenant_id,'commercial_order_created','oa5a_test',f.source_id,'info','OA5A lifecycle test','First governed lifecycle notification.'),
  f.first_notification_id,
  'replaying the same lifecycle source/event returns the committed notification'
) from oa5a_fixture f;
select extensions.is(
  (select count(*)::integer from public.merchant_notifications n join oa5a_fixture f on n.tenant_id=f.tenant_id and n.lifecycle_source_type='oa5a_test' and n.lifecycle_source_id=f.source_id and n.event_key='commercial_order_created'),
  1,
  'replaying a lifecycle source/event cannot create duplicate notifications'
);

insert into public.merchant_notifications(tenant_id,event_key,severity,title,body,message_type,audience_roles)
select tenant_id,'platform_update','info','Staff-only test','This notification must not count for the Owner.','operational',array['staff']::text[] from oa5a_fixture;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',user_id,'role','authenticated')::text from oa5a_fixture),true);
select extensions.is(
  public.sellertray_merchant_unread_notification_count((select tenant_id from oa5a_fixture)),
  1,
  'unread count applies the same audience and membership truth as the notification inbox'
);

select * from extensions.finish();
rollback;