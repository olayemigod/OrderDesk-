begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

create temp table oa5a_unread_fixture(
  tenant_id uuid not null,
  user_id uuid not null,
  other_tenant_id uuid not null
) on commit drop;

insert into oa5a_unread_fixture
values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select user_id,'oa5a-unread-'||substr(user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from oa5a_unread_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'OA5A unread reachability','oa5a-unread-'||substr(tenant_id::text,1,8),'O5C','trial'
from oa5a_unread_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select other_tenant_id,'OA5A unread other','oa5a-unread-other-'||substr(other_tenant_id::text,1,8),'O5D','trial'
from oa5a_unread_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,user_id,'owner' from oa5a_unread_fixture;

insert into public.merchant_notifications(
  tenant_id,event_key,severity,title,body,message_type,audience_roles,created_at
)
select
  f.tenant_id,'platform_update','info','Reachability '||g,'Test body','operational',
  array['owner']::text[],now()-make_interval(secs=>g)
from oa5a_unread_fixture f
cross join generate_series(1,250) g;

insert into public.merchant_notification_reads(notification_id,tenant_id,user_id,read_at)
select n.id,n.tenant_id,f.user_id,now()
from oa5a_unread_fixture f
join lateral (
  select n.*
  from public.merchant_notifications n
  where n.tenant_id=f.tenant_id
  order by n.created_at desc,n.id desc
  limit 200
) n on true;

select set_config(
  'request.jwt.claims',
  (select jsonb_build_object('sub',user_id,'role','authenticated')::text from oa5a_unread_fixture),
  true
);

select extensions.is(
  public.sellertray_merchant_unread_notification_count((select tenant_id from oa5a_unread_fixture)),
  50,
  'exact unread count remains authoritative after newer notifications are read'
);

select extensions.is(
  (select count(*)::integer
   from public.sellertray_list_merchant_notifications((select tenant_id from oa5a_unread_fixture),50)),
  50,
  'bounded inbox still returns only the requested page size'
);

select extensions.ok(
  (select bool_and(not n.is_read)
   from public.sellertray_list_merchant_notifications((select tenant_id from oa5a_unread_fixture),50) n),
  'older unread notices are prioritized ahead of newer read notices'
);

select extensions.ok(
  position(
    'order by is_read asc'
    in lower(pg_get_functiondef('public.sellertray_list_merchant_notifications(uuid,integer)'::regprocedure))
  ) > 0,
  'unread-first ordering is enforced by shared server authority'
);

select extensions.throws_ok(
  format(
    'select * from public.sellertray_list_merchant_notifications(%L::uuid,50)',
    (select other_tenant_id from oa5a_unread_fixture)
  ),
  'P0001',
  'SellerTray business membership required',
  'unread-first convergence preserves cross-Business denial'
);

select * from extensions.finish();
rollback;
