begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

create temp table sellertray_notification_branch_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  customer_id uuid not null,
  default_branch_id uuid,
  second_branch_id uuid,
  default_message_id uuid not null,
  second_message_id uuid not null,
  default_notification_id uuid,
  second_notification_id uuid,
  business_notification_id uuid,
  staff_cross_branch_mark_rejected boolean not null default false
) on commit drop;

insert into sellertray_notification_branch_fixture(
  tenant_id,owner_user_id,staff_user_id,customer_id,default_message_id,second_message_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'notification-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_notification_branch_fixture
union all
select staff_user_id,'notification-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_notification_branch_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Notification Branch Test','sellertray-notification-'||substr(tenant_id::text,1,8),'NBT','active'
from sellertray_notification_branch_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_notification_branch_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_notification_branch_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_notification_branch_fixture;

update sellertray_notification_branch_fixture f
set default_branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'SECOND','Second Branch',false,true
from sellertray_notification_branch_fixture;

update sellertray_notification_branch_fixture f
set second_branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='SECOND';

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'2348000000011','Notification Customer','2348000000011'
from sellertray_notification_branch_fixture;

insert into public.inbound_messages(
  id,tenant_id,customer_id,branch_id,provider_message_id,message_type,text_body,raw_payload,received_at
)
select default_message_id,tenant_id,customer_id,default_branch_id,'wamid.notification.default','text','default branch','{}'::jsonb,now()-interval '2 minutes'
from sellertray_notification_branch_fixture
union all
select second_message_id,tenant_id,customer_id,second_branch_id,'wamid.notification.second','text','second branch','{}'::jsonb,now()-interval '1 minute'
from sellertray_notification_branch_fixture;

insert into public.merchant_notifications(
  tenant_id,event_key,severity,title,body,source_inbound_message_id
)
select tenant_id,'new_whatsapp_message','attention','Default Branch message','Default Branch attention',default_message_id
from sellertray_notification_branch_fixture
returning id into temp table sellertray_default_notification_returning;

update sellertray_notification_branch_fixture
set default_notification_id=(select id from sellertray_default_notification_returning limit 1);

insert into public.merchant_notifications(
  tenant_id,event_key,severity,title,body,source_inbound_message_id
)
select tenant_id,'new_whatsapp_message','attention','Second Branch message','Second Branch attention',second_message_id
from sellertray_notification_branch_fixture
returning id into temp table sellertray_second_notification_returning;

update sellertray_notification_branch_fixture
set second_notification_id=(select id from sellertray_second_notification_returning limit 1);

insert into public.merchant_notifications(
  tenant_id,event_key,severity,title,body
)
select tenant_id,'payment_gate_blocked','attention','Business notice','Management attention'
from sellertray_notification_branch_fixture
returning id into temp table sellertray_business_notification_returning;

update sellertray_notification_branch_fixture
set business_notification_id=(select id from sellertray_business_notification_returning limit 1);

select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='merchant_notifications'
      and column_name='branch_id'
  ),
  'merchant notifications expose explicit Branch attribution'
);

select extensions.ok(
  (select qual ilike '%sellertray_user_can_access_notification_scope%'
   from pg_policies
   where schemaname='public'
     and tablename='merchant_notifications'
     and policyname='merchant_notifications_select_member'),
  'direct notification reads enforce Branch-aware scope'
);

select extensions.ok(
  (select qual ilike '%sellertray_user_can_access_notification_scope%'
      and with_check ilike '%sellertray_user_can_access_notification_scope%'
   from pg_policies
   where schemaname='public'
     and tablename='merchant_notifications'
     and policyname='merchant_notifications_update_member'),
  'legacy notification read-marker updates cannot cross Branch scope'
);

select extensions.ok(
  (select qual ilike '%sellertray_user_can_access_notification_scope%'
      and with_check ilike '%sellertray_user_can_access_notification_scope%'
   from pg_policies
   where schemaname='public'
     and tablename='merchant_notification_reads'
     and policyname='merchant_notification_reads_own'),
  'per-user read rows require notification visibility'
);

select extensions.is(
  (select n.branch_id from public.merchant_notifications n where n.id=(select default_notification_id from sellertray_notification_branch_fixture)),
  (select default_branch_id from sellertray_notification_branch_fixture),
  'notification inherits its inbound message Main Branch'
);

select extensions.is(
  (select n.branch_id from public.merchant_notifications n where n.id=(select second_notification_id from sellertray_notification_branch_fixture)),
  (select second_branch_id from sellertray_notification_branch_fixture),
  'notification inherits its inbound message second Branch'
);

select extensions.is(
  (select n.branch_id from public.merchant_notifications n where n.id=(select business_notification_id from sellertray_notification_branch_fixture)),
  null::uuid,
  'genuinely business-wide notification remains unassigned to a Branch'
);

select set_config(
  'request.jwt.claim.sub',
  (select owner_user_id::text from sellertray_notification_branch_fixture),
  true
);

select extensions.is(
  (select count(*)::integer from public.sellertray_list_merchant_notifications(
    (select tenant_id from sellertray_notification_branch_fixture),50
  )),
  3,
  'Owner sees notifications from every active Branch plus business-wide management notices'
);

select set_config(
  'request.jwt.claim.sub',
  (select staff_user_id::text from sellertray_notification_branch_fixture),
  true
);

select extensions.is(
  (select count(*)::integer from public.sellertray_list_merchant_notifications(
    (select tenant_id from sellertray_notification_branch_fixture),50
  )),
  1,
  'unassigned Staff sees only the default Branch notification'
);

select extensions.is(
  public.sellertray_unread_notification_count_for_user(
    (select staff_user_id from sellertray_notification_branch_fixture)
  ),
  1,
  'Staff unread count excludes inaccessible Branch and management-only notifications'
);

do $$
begin
  begin
    perform public.sellertray_mark_merchant_notification_read(
      (select second_notification_id from sellertray_notification_branch_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_notification_branch_fixture
    set staff_cross_branch_mark_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_cross_branch_mark_rejected from sellertray_notification_branch_fixture),
  'Staff cannot mark another Branch notification as read'
);

select extensions.is(
  (
    select count(*)::integer
    from public.merchant_push_dispatches d
    where d.tenant_id=(select tenant_id from sellertray_notification_branch_fixture)
      and d.user_id=(select staff_user_id from sellertray_notification_branch_fixture)
  ),
  1,
  'push fan-out sends Staff only the default Branch notification'
);

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,second_branch_id,staff_user_id,true
from sellertray_notification_branch_fixture;

insert into public.merchant_notifications(
  tenant_id,event_key,severity,title,body,source_inbound_message_id
)
select tenant_id,'workflow_clarification','attention','Second Branch follow-up','Branch-scoped follow-up',second_message_id
from sellertray_notification_branch_fixture;

select extensions.is(
  (select count(*)::integer from public.sellertray_list_merchant_notifications(
    (select tenant_id from sellertray_notification_branch_fixture),50
  )),
  2,
  'explicit Branch assignment moves Staff notification visibility to the assigned Branch'
);

select extensions.is(
  (
    select count(*)::integer
    from public.merchant_push_dispatches d
    where d.tenant_id=(select tenant_id from sellertray_notification_branch_fixture)
      and d.user_id=(select staff_user_id from sellertray_notification_branch_fixture)
  ),
  2,
  'future push fan-out follows explicit Staff Branch assignment'
);

select * from extensions.finish();
rollback;
