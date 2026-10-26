begin;
create extension if not exists pgtap with schema extensions;
create temp table oa5a_tap_results(result text);
insert into oa5a_tap_results select extensions.plan(15);
create temp table oa5a_acceptance_fixture as select gen_random_uuid() tenant_id,gen_random_uuid() user_id,gen_random_uuid() other_tenant,gen_random_uuid() full_id,gen_random_uuid() later_id;
insert into auth.users(id,email,aud,role,created_at,updated_at)
select user_id,'oa5a-accept-'||user_id||'@example.com','authenticated','authenticated',now(),now() from oa5a_acceptance_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'OA5A acceptance','oa5a-'||tenant_id,'O5A','trial' from oa5a_acceptance_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select other_tenant,'OA5A other','oa5a-'||other_tenant,'O5B','trial' from oa5a_acceptance_fixture;
insert into public.tenant_members(tenant_id,user_id,role) select tenant_id,user_id,'owner' from oa5a_acceptance_fixture;
insert into public.merchant_notifications(tenant_id,event_key,severity,title,body,message_type,audience_roles)
select f.tenant_id,'platform_update','info','Test update','Test body','operational',array['owner']::text[]
from oa5a_acceptance_fixture f cross join generate_series(1,250);
insert into public.merchant_notifications(tenant_id,event_key,severity,title,body,message_type,audience_roles,expires_at)
select tenant_id,'platform_update','info','Expired','Test body','operational',array['owner']::text[],now()-interval '1 day' from oa5a_acceptance_fixture;
insert into public.merchant_notifications(tenant_id,event_key,severity,title,body,message_type,audience_roles)
select tenant_id,'platform_update','info','Cashier only','Test body','operational',array['staff']::text[] from oa5a_acceptance_fixture;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',user_id,'role','authenticated')::text from oa5a_acceptance_fixture),true);
insert into oa5a_tap_results select extensions.is(public.sellertray_merchant_unread_notification_count((select tenant_id from oa5a_acceptance_fixture)),250,'exact count exceeds bounded inbox and excludes expiry/audience');
insert into oa5a_tap_results select extensions.is((select count(*)::integer from public.sellertray_list_merchant_notifications((select tenant_id from oa5a_acceptance_fixture),200)),200,'inbox stays bounded at 200');
create temp table oa5a_read_target as select id from public.sellertray_list_merchant_notifications((select tenant_id from oa5a_acceptance_fixture),1);
select public.sellertray_mark_merchant_notification_read((select id from oa5a_read_target));
select public.sellertray_mark_merchant_notification_read((select id from oa5a_read_target));
insert into oa5a_tap_results select extensions.is(public.sellertray_merchant_unread_notification_count((select tenant_id from oa5a_acceptance_fixture)),249,'repeated read decreases exact count once');
insert into oa5a_tap_results select extensions.is((select count(*)::integer from public.merchant_notification_reads r join oa5a_read_target t on t.id=r.notification_id),1,'read replay stores one fact');
insert into oa5a_tap_results select extensions.throws_ok(format('select public.sellertray_merchant_unread_notification_count(%L::uuid)',(select other_tenant from oa5a_acceptance_fixture)),'42501','SellerTray business membership required','cross-tenant count denied');
select public.sellertray_mark_all_merchant_notifications_read((select tenant_id from oa5a_acceptance_fixture));
insert into oa5a_tap_results select extensions.is(public.sellertray_merchant_unread_notification_count((select tenant_id from oa5a_acceptance_fixture)),0,'mark-all covers unread beyond list limit');
insert into oa5a_tap_results select extensions.ok(not exists(select 1 from pg_publication where pubname='supabase_realtime') or exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='merchant_notification_reads'),'read facts are published for cross-device synchronization');
insert into public.sellertray_commercial_entitlement_events(id,tenant_id,event_type,idempotency_key,effective_from,effective_until,reason)
select full_id,tenant_id,'installment.full_entitlement_released','oa5a-full-'||full_id,now()-interval '1 day',now()+interval '3 days','Rollback-only notification acceptance' from oa5a_acceptance_fixture;
insert into oa5a_tap_results select extensions.is((select count(*)::integer from public.merchant_notifications n join oa5a_acceptance_fixture f on n.tenant_id=f.tenant_id where n.lifecycle_source_id=f.full_id and n.event_key='activation_succeeded'),1,'direct full activation emits success without provisional');
select public.materialize_sellertray_lifecycle_notifications();
select public.materialize_sellertray_lifecycle_notifications();
insert into oa5a_tap_results select extensions.is((select count(*)::integer from public.merchant_notifications n join oa5a_acceptance_fixture f on n.tenant_id=f.tenant_id where n.lifecycle_source_id=f.full_id and n.event_key='entitlement_expiring'),1,'expiry scheduler replay is idempotent');
insert into public.sellertray_commercial_entitlement_events(id,tenant_id,event_type,idempotency_key,effective_from,effective_until,reason)
select later_id,tenant_id,'installment.full_entitlement_released','oa5a-later-'||later_id,now(),now()+interval '100 days','Rollback-only later term acceptance' from oa5a_acceptance_fixture;
select public.materialize_sellertray_lifecycle_notifications();
insert into oa5a_tap_results select extensions.is((select count(*)::integer from public.merchant_notifications n join oa5a_acceptance_fixture f on n.tenant_id=f.tenant_id where n.event_key in ('entitlement_expiring','entitlement_expired') and (n.expires_at is null or n.expires_at>now())),0,'later current term retires stale expiry attention');
insert into oa5a_tap_results select extensions.ok(not has_function_privilege('authenticated','public.materialize_sellertray_lifecycle_notifications()','EXECUTE'),'merchant cannot run lifecycle scheduler');
insert into oa5a_tap_results select extensions.ok(not has_function_privilege('anon','public.sellertray_merchant_unread_notification_count(uuid)','EXECUTE'),'anonymous count denied');
insert into public.merchant_notifications(tenant_id,event_key,severity,title,body,message_type,lifecycle_source_type,lifecycle_source_id)
select tenant_id,'master_agreement_required','attention','Obsolete agreement','Old version notice','operational','master_agreement_version',gen_random_uuid() from oa5a_acceptance_fixture;
select public.materialize_sellertray_lifecycle_notifications();
insert into oa5a_tap_results select extensions.is((select count(*)::integer from public.merchant_notifications n join oa5a_acceptance_fixture f on n.tenant_id=f.tenant_id where n.event_key='master_agreement_required' and n.lifecycle_source_id is distinct from public.resolve_sellertray_master_agreement_version_id(now()) and (n.expires_at is null or n.expires_at>now())),0,'superseded agreement notices cannot remain actionable');
insert into oa5a_tap_results select extensions.ok(not has_function_privilege('authenticated','public.queue_sellertray_entitlement_lifecycle_notification()','EXECUTE'),'merchant cannot forge activation trigger');
insert into oa5a_tap_results select extensions.is((select count(*)::integer from public.merchant_notifications n join oa5a_acceptance_fixture f on n.tenant_id=f.tenant_id where n.lifecycle_source_id=f.full_id and n.event_key='activation_succeeded'),1,'repeated materialization never duplicates activation success');
insert into oa5a_tap_results select * from extensions.finish();
select * from oa5a_tap_results;
rollback;
