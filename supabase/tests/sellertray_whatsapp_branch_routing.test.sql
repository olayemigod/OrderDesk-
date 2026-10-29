begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(19);

create temp table sellertray_whatsapp_branch_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  customer_id uuid not null,
  default_branch_id uuid,
  second_branch_id uuid,
  first_message_id uuid not null,
  second_message_id uuid not null,
  whatsapp_order_id uuid,
  wrong_branch_order_rejected boolean not null default false,
  staff_route_rejected boolean not null default false,
  staff_second_branch_unread_rejected boolean not null default false
) on commit drop;

insert into sellertray_whatsapp_branch_fixture(
  tenant_id,owner_user_id,staff_user_id,customer_id,first_message_id,second_message_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'wa-branch-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_whatsapp_branch_fixture
union all
select staff_user_id,'wa-branch-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_whatsapp_branch_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray WhatsApp Branch Test','sellertray-wa-branch-'||substr(tenant_id::text,1,8),'WBT','active'
from sellertray_whatsapp_branch_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_whatsapp_branch_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_whatsapp_branch_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_whatsapp_branch_fixture;

update sellertray_whatsapp_branch_fixture f
set default_branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'WHATSAPP','WhatsApp Branch',false,true
from sellertray_whatsapp_branch_fixture;

update sellertray_whatsapp_branch_fixture f
set second_branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='WHATSAPP';

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,'2348000000001','WhatsApp Branch Customer','2348000000001'
from sellertray_whatsapp_branch_fixture;

insert into public.tenant_whatsapp_connections(
  tenant_id,phone_number_id,connection_status,onboarding_method,credential_mode,
  webhook_subscription_status,connected_at,last_verified_at
)
select tenant_id,'100000000000001','connected','manual','platform_system_user','subscribed',now(),now()
from sellertray_whatsapp_branch_fixture;

select extensions.is(
  (
    select c.branch_id
    from public.tenant_whatsapp_connections c
    where c.tenant_id=(select tenant_id from sellertray_whatsapp_branch_fixture)
  ),
  (select default_branch_id from sellertray_whatsapp_branch_fixture),
  'legacy WhatsApp connection creation defaults to the active Main Branch'
);

select set_config(
  'request.jwt.claim.sub',
  (select owner_user_id::text from sellertray_whatsapp_branch_fixture),
  true
);

select public.set_sellertray_whatsapp_branch(
  (select tenant_id from sellertray_whatsapp_branch_fixture),
  (select second_branch_id from sellertray_whatsapp_branch_fixture)
);

select extensions.is(
  (
    select c.branch_id
    from public.tenant_whatsapp_connections c
    where c.tenant_id=(select tenant_id from sellertray_whatsapp_branch_fixture)
  ),
  (select second_branch_id from sellertray_whatsapp_branch_fixture),
  'Owner can explicitly route future WhatsApp traffic to another active Branch'
);

insert into public.inbound_messages(
  id,tenant_id,customer_id,provider_message_id,message_type,text_body,raw_payload,received_at
)
select first_message_id,tenant_id,customer_id,'wamid.branch.first','text','first branch message','{}'::jsonb,now()-interval '2 minutes'
from sellertray_whatsapp_branch_fixture;

select extensions.is(
  (
    select im.branch_id
    from public.inbound_messages im
    where im.id=(select first_message_id from sellertray_whatsapp_branch_fixture)
  ),
  (select second_branch_id from sellertray_whatsapp_branch_fixture),
  'new inbound message inherits the connection receiving Branch'
);

update sellertray_whatsapp_branch_fixture
set whatsapp_order_id=public.create_sellertray_whatsapp_order_atomic(
  tenant_id,
  customer_id,
  first_message_id,
  null,
  1,
  'fallback',
  'branch-routing-test',
  '{}'::text[],
  'NGN',
  '[]'::jsonb
);

select extensions.is(
  (
    select o.branch_id
    from public.orders o
    where o.id=(select whatsapp_order_id from sellertray_whatsapp_branch_fixture)
  ),
  (select second_branch_id from sellertray_whatsapp_branch_fixture),
  'shared WhatsApp order inherits its immutable source-message Branch'
);

do $$
begin
  begin
    insert into public.orders(
      tenant_id,customer_id,source_message_id,status,source,currency,branch_id
    )
    select tenant_id,customer_id,first_message_id,'needs_review','whatsapp','NGN',default_branch_id
    from sellertray_whatsapp_branch_fixture;
  exception when sqlstate '23514' then
    update sellertray_whatsapp_branch_fixture set wrong_branch_order_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select wrong_branch_order_rejected from sellertray_whatsapp_branch_fixture),
  'WhatsApp order cannot be assigned to a Branch different from its source message'
);

select public.set_sellertray_whatsapp_branch(
  (select tenant_id from sellertray_whatsapp_branch_fixture),
  (select default_branch_id from sellertray_whatsapp_branch_fixture)
);

insert into public.inbound_messages(
  id,tenant_id,customer_id,provider_message_id,message_type,text_body,raw_payload,received_at
)
select second_message_id,tenant_id,customer_id,'wamid.branch.second','text','second branch message','{}'::jsonb,now()-interval '1 minute'
from sellertray_whatsapp_branch_fixture;

select extensions.is(
  (
    select im.branch_id
    from public.inbound_messages im
    where im.id=(select second_message_id from sellertray_whatsapp_branch_fixture)
  ),
  (select default_branch_id from sellertray_whatsapp_branch_fixture),
  'later inbound message follows the updated receiving Branch'
);

select extensions.is(
  (
    select im.branch_id
    from public.inbound_messages im
    where im.id=(select first_message_id from sellertray_whatsapp_branch_fixture)
  ),
  (select second_branch_id from sellertray_whatsapp_branch_fixture),
  'changing the route does not rewrite historical message Branch'
);

select extensions.is(
  (
    select unread_count
    from public.sellertray_conversation_unread_counts(
      (select tenant_id from sellertray_whatsapp_branch_fixture),
      (select second_branch_id from sellertray_whatsapp_branch_fixture)
    )
    where customer_id=(select customer_id from sellertray_whatsapp_branch_fixture)
  ),
  1::bigint,
  'second Branch has its own unread count for the customer'
);

select extensions.is(
  (
    select unread_count
    from public.sellertray_conversation_unread_counts(
      (select tenant_id from sellertray_whatsapp_branch_fixture),
      (select default_branch_id from sellertray_whatsapp_branch_fixture)
    )
    where customer_id=(select customer_id from sellertray_whatsapp_branch_fixture)
  ),
  1::bigint,
  'Main Branch independently has the same customer unread once'
);

select public.sellertray_mark_conversation_read(
  (select tenant_id from sellertray_whatsapp_branch_fixture),
  (select second_branch_id from sellertray_whatsapp_branch_fixture),
  (select customer_id from sellertray_whatsapp_branch_fixture),
  now()
);

select extensions.is(
  (
    select unread_count
    from public.sellertray_conversation_unread_counts(
      (select tenant_id from sellertray_whatsapp_branch_fixture),
      (select second_branch_id from sellertray_whatsapp_branch_fixture)
    )
    where customer_id=(select customer_id from sellertray_whatsapp_branch_fixture)
  ),
  0::bigint,
  'reading the customer in one Branch clears only that Branch unread state'
);

select extensions.is(
  (
    select unread_count
    from public.sellertray_conversation_unread_counts(
      (select tenant_id from sellertray_whatsapp_branch_fixture),
      (select default_branch_id from sellertray_whatsapp_branch_fixture)
    )
    where customer_id=(select customer_id from sellertray_whatsapp_branch_fixture)
  ),
  1::bigint,
  'reading the customer in another Branch does not clear Main Branch unread state'
);

select extensions.is(
  (
    select unread_count
    from public.sellertray_conversation_unread_counts(
      (select tenant_id from sellertray_whatsapp_branch_fixture)
    )
    where customer_id=(select customer_id from sellertray_whatsapp_branch_fixture)
  ),
  1::bigint,
  'legacy tenant-wide unread API remains compatible and aggregates accessible Branches'
);

select public.sellertray_mark_conversation_read(
  (select tenant_id from sellertray_whatsapp_branch_fixture),
  (select customer_id from sellertray_whatsapp_branch_fixture),
  now()
);

select extensions.is(
  (
    select unread_count
    from public.sellertray_conversation_unread_counts(
      (select tenant_id from sellertray_whatsapp_branch_fixture)
    )
    where customer_id=(select customer_id from sellertray_whatsapp_branch_fixture)
  ),
  0::bigint,
  'legacy mark-read API updates each accessible Branch cursor safely'
);

select set_config(
  'request.jwt.claim.sub',
  (select staff_user_id::text from sellertray_whatsapp_branch_fixture),
  true
);

select extensions.ok(
  public.sellertray_user_can_access_branch(
    (select tenant_id from sellertray_whatsapp_branch_fixture),
    (select default_branch_id from sellertray_whatsapp_branch_fixture),
    (select staff_user_id from sellertray_whatsapp_branch_fixture)
  ),
  'Staff with no explicit assignment retains default Branch access'
);

select extensions.ok(
  not public.sellertray_user_can_access_branch(
    (select tenant_id from sellertray_whatsapp_branch_fixture),
    (select second_branch_id from sellertray_whatsapp_branch_fixture),
    (select staff_user_id from sellertray_whatsapp_branch_fixture)
  ),
  'Staff cannot access another Branch by business membership alone'
);

do $$
begin
  begin
    perform public.sellertray_conversation_unread_counts(
      (select tenant_id from sellertray_whatsapp_branch_fixture),
      (select second_branch_id from sellertray_whatsapp_branch_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_whatsapp_branch_fixture set staff_second_branch_unread_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_second_branch_unread_rejected from sellertray_whatsapp_branch_fixture),
  'branch-specific unread API fails closed outside Staff Branch access'
);

do $$
begin
  begin
    perform public.set_sellertray_whatsapp_branch(
      (select tenant_id from sellertray_whatsapp_branch_fixture),
      (select second_branch_id from sellertray_whatsapp_branch_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_whatsapp_branch_fixture set staff_route_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_route_rejected from sellertray_whatsapp_branch_fixture),
  'Staff cannot change the business WhatsApp receiving Branch'
);

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,second_branch_id,staff_user_id,true
from sellertray_whatsapp_branch_fixture;

select extensions.ok(
  public.sellertray_user_can_access_branch(
    (select tenant_id from sellertray_whatsapp_branch_fixture),
    (select second_branch_id from sellertray_whatsapp_branch_fixture),
    (select staff_user_id from sellertray_whatsapp_branch_fixture)
  ),
  'explicit Staff Branch assignment grants access to routed WhatsApp work'
);

select extensions.ok(
  not public.sellertray_user_can_access_branch(
    (select tenant_id from sellertray_whatsapp_branch_fixture),
    (select default_branch_id from sellertray_whatsapp_branch_fixture),
    (select staff_user_id from sellertray_whatsapp_branch_fixture)
  ),
  'explicit Staff assignment removes implicit default-Branch fallback'
);

select * from extensions.finish();
rollback;
