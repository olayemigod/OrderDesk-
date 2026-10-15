begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

create temp table sellertray_branch_history_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  customer_id uuid not null,
  branch_id uuid not null,
  message_id uuid not null,
  active_notification_id uuid not null,
  delayed_notification_id uuid not null
) on commit drop;

insert into sellertray_branch_history_fixture(
  tenant_id,owner_user_id,staff_user_id,customer_id,branch_id,message_id,
  active_notification_id,delayed_notification_id
)
values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'history-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_branch_history_fixture
union all
select staff_user_id,'history-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_branch_history_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Branch History Test','sellertray-history-'||substr(tenant_id::text,1,8),'BHT','active'
from sellertray_branch_history_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_branch_history_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_branch_history_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_branch_history_fixture;

insert into public.branches(id,tenant_id,code,name,is_default,is_active)
select branch_id,tenant_id,'HISTORY','Historical Branch',false,true
from sellertray_branch_history_fixture;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_user_id,true
from sellertray_branch_history_fixture;

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'2348000000022','Historical Customer','2348000000022'
from sellertray_branch_history_fixture;

insert into public.inbound_messages(
  id,tenant_id,customer_id,branch_id,provider_message_id,message_type,text_body,raw_payload,received_at
)
select message_id,tenant_id,customer_id,branch_id,'wamid.history.branch','text','historical message','{}'::jsonb,now()-interval '2 minutes'
from sellertray_branch_history_fixture;

insert into public.merchant_notifications(
  id,tenant_id,event_key,severity,title,body,source_inbound_message_id
)
select active_notification_id,tenant_id,'new_whatsapp_message','attention','Historical Branch message','Historical Branch attention',message_id
from sellertray_branch_history_fixture;

select extensions.ok(
  public.sellertray_user_can_access_branch(
    (select tenant_id from sellertray_branch_history_fixture),
    (select branch_id from sellertray_branch_history_fixture),
    (select staff_user_id from sellertray_branch_history_fixture)
  ),
  'assigned Staff can operate the Branch while it is active'
);

select extensions.ok(
  public.sellertray_user_can_read_branch(
    (select tenant_id from sellertray_branch_history_fixture),
    (select branch_id from sellertray_branch_history_fixture),
    (select staff_user_id from sellertray_branch_history_fixture)
  ),
  'assigned Staff can read the Branch while it is active'
);

update public.branches
set is_active=false
where id=(select branch_id from sellertray_branch_history_fixture)
  and tenant_id=(select tenant_id from sellertray_branch_history_fixture);

select extensions.ok(
  not public.sellertray_user_can_access_branch(
    (select tenant_id from sellertray_branch_history_fixture),
    (select branch_id from sellertray_branch_history_fixture),
    (select owner_user_id from sellertray_branch_history_fixture)
  ),
  'Owner cannot operate a deactivated Branch'
);

select extensions.ok(
  public.sellertray_user_can_read_branch(
    (select tenant_id from sellertray_branch_history_fixture),
    (select branch_id from sellertray_branch_history_fixture),
    (select owner_user_id from sellertray_branch_history_fixture)
  ),
  'Owner retains historical read access to a deactivated Branch'
);

select extensions.ok(
  not public.sellertray_user_can_access_branch(
    (select tenant_id from sellertray_branch_history_fixture),
    (select branch_id from sellertray_branch_history_fixture),
    (select staff_user_id from sellertray_branch_history_fixture)
  ),
  'assigned Staff cannot operate a deactivated Branch'
);

select extensions.ok(
  public.sellertray_user_can_read_branch(
    (select tenant_id from sellertray_branch_history_fixture),
    (select branch_id from sellertray_branch_history_fixture),
    (select staff_user_id from sellertray_branch_history_fixture)
  ),
  'assigned Staff retains historical read access to a deactivated Branch'
);

select extensions.ok(
  (select qual ilike '%sellertray_current_user_can_read_branch%'
   from pg_policies
   where schemaname='public' and tablename='orders' and policyname='orders_select_member'),
  'order reads bind historical Branch access to the signed-in user'
);

select extensions.ok(
  (select qual ilike '%sellertray_user_can_access_branch%'
      and with_check ilike '%sellertray_user_can_access_branch%'
   from pg_policies
   where schemaname='public' and tablename='orders' and policyname='orders_update_member'),
  'order mutation remains tied to active Branch access'
);

select extensions.ok(
  (select qual ilike '%sellertray_current_user_can_read_branch%'
   from pg_policies
   where schemaname='public' and tablename='inbound_messages' and policyname='inbound_messages_select_member'),
  'WhatsApp history reads bind historical Branch access to the signed-in user'
);

select extensions.ok(
  not public.sellertray_user_can_receive_notification_scope(
    (select tenant_id from sellertray_branch_history_fixture),
    (select branch_id from sellertray_branch_history_fixture),
    (select staff_user_id from sellertray_branch_history_fixture)
  ),
  'deactivated Branch cannot deliver new operational push to Staff'
);

-- Delayed server-side notification creation may still record historical evidence,
-- but the push trigger must not treat the inactive Branch as operational.
insert into public.merchant_notifications(
  id,tenant_id,event_key,severity,title,body,source_inbound_message_id
)
select delayed_notification_id,tenant_id,'workflow_clarification','attention','Historical follow-up','Historical evidence only',message_id
from sellertray_branch_history_fixture;

select extensions.is(
  (
    select count(*)::integer
    from public.merchant_push_dispatches d
    where d.notification_id=(select delayed_notification_id from sellertray_branch_history_fixture)
  ),
  0,
  'delayed notification for an inactive Branch creates no operational push dispatch'
);

select set_config(
  'request.jwt.claim.sub',
  (select staff_user_id::text from sellertray_branch_history_fixture),
  true
);

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_list_merchant_notifications(
      (select tenant_id from sellertray_branch_history_fixture),50
    )
  ),
  2,
  'assigned Staff can still review historical notifications after Branch deactivation'
);

select set_config(
  'request.jwt.claim.sub',
  (select owner_user_id::text from sellertray_branch_history_fixture),
  true
);

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_list_merchant_notifications(
      (select tenant_id from sellertray_branch_history_fixture),50
    )
  ),
  2,
  'Owner can still review historical notifications after Branch deactivation'
);

select extensions.ok(
  public.sellertray_user_can_access_notification_scope(
    (select tenant_id from sellertray_branch_history_fixture),
    (select branch_id from sellertray_branch_history_fixture),
    (select owner_user_id from sellertray_branch_history_fixture)
  ),
  'notification read scope preserves management history independently of push eligibility'
);

select * from extensions.finish();
rollback;
