-- Issues #224/#225. Run only against disposable full SellerTray test database.
-- No test identities, orders, or historical events should be inserted in Production.
begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.ok(
  to_regclass('public.sellertray_branch_access_events') is not null
  and (select c.relrowsecurity from pg_class c
       where c.oid='public.sellertray_branch_access_events'::regclass),
  'Branch permission event history exists with RLS enabled'
);
select extensions.ok(
  not has_table_privilege('anon','public.sellertray_branch_access_events','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_branch_access_events','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_branch_access_events','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_branch_access_events','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_branch_access_events','DELETE')
  and not has_table_privilege('service_role','public.sellertray_branch_access_events','TRUNCATE')
  and not has_function_privilege(
    'authenticated','public.prevent_sellertray_branch_access_event_mutation()','EXECUTE'),
  'browser roles cannot read, write, or invoke Branch access event internals'
);
select extensions.ok(
  exists(select 1 from pg_trigger t
         where t.tgrelid='public.sellertray_branch_access_events'::regclass
           and t.tgname='prevent_sellertray_branch_access_event_mutation'
           and t.tgenabled='O'
           and t.tgfoid='public.prevent_sellertray_branch_access_event_mutation()'::regprocedure
           and (t.tgtype & 2)=2 and (t.tgtype & 8)=8 and (t.tgtype & 16)=16),
  'Branch permission history has an active immutable UPDATE/DELETE trigger'
);
select extensions.ok(
  exists(select 1 from pg_constraint c
         where c.conrelid='public.sellertray_branch_access_events'::regclass
           and c.conname='sellertray_branch_access_events_branch_same_tenant'
           and c.confrelid='public.branches'::regclass and c.confdeltype='c'),
  'Branch audit event enforces same-tenant Branch scope and retirement cascade'
);
select extensions.ok(
  exists(select 1 from pg_trigger t
         where t.tgrelid='public.branch_inventory_policy_events'::regclass
           and t.tgname='prevent_sellertray_inventory_policy_event_mutation'
           and t.tgenabled='O'
           and t.tgfoid='public.prevent_sellertray_inventory_policy_event_mutation()'::regprocedure
           and (t.tgtype & 2)=2 and (t.tgtype & 8)=8 and (t.tgtype & 16)=16),
  'inventory low-stock policy history has active immutable UPDATE/DELETE guard'
);
select extensions.ok(
  not has_table_privilege('service_role','public.branch_inventory_policy_events','TRUNCATE'),
  'service role cannot TRUNCATE inventory policy audit events around row guards'
);

create temp table audit_history_fixture (
  tenant_id uuid not null,
  foreign_tenant_id uuid not null,
  owner_id uuid not null,
  staff_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  second_branch_id uuid,
  foreign_branch_id uuid,
  staff_denied boolean not null default false,
  foreign_branch_denied boolean not null default false,
  branch_update_denied boolean not null default false,
  branch_delete_denied boolean not null default false,
  policy_update_denied boolean not null default false,
  policy_delete_denied boolean not null default false
) on commit drop;

insert into audit_history_fixture(tenant_id,foreign_tenant_id,owner_id,staff_id,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'branch-history-owner-'||left(owner_id::text,8)||'@example.com',
  'authenticated','authenticated',now(),now() from audit_history_fixture
union all
select staff_id,'branch-history-staff-'||left(staff_id::text,8)||'@example.com',
  'authenticated','authenticated',now(),now() from audit_history_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Branch Audit First Business',
  'audit-first-'||left(tenant_id::text,8),'A' || upper(left(md5(tenant_id::text),2)),'active'
from audit_history_fixture
union all
select foreign_tenant_id,'Branch Audit Other Business',
  'audit-other-'||left(foreign_tenant_id::text,8),'B' || upper(left(md5(foreign_tenant_id::text),2)),'active'
from audit_history_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from audit_history_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from audit_history_fixture
union all select tenant_id,staff_id,'staff' from audit_history_fixture;

update audit_history_fixture f
set branch_id=(select b.id from public.branches b
               where b.tenant_id=f.tenant_id and b.is_default=true limit 1),
    foreign_branch_id=(select b.id from public.branches b
                       where b.tenant_id=f.foreign_tenant_id and b.is_default=true limit 1);

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'AUD2','Second Branch',false,true
from audit_history_fixture;

update audit_history_fixture f
set second_branch_id=(select b.id from public.branches b
                      where b.tenant_id=f.tenant_id and b.code='AUD2');

select set_config('request.jwt.claim.sub',(select owner_id::text from audit_history_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.ok(
  public.set_sellertray_member_branch_access(
    (select tenant_id from audit_history_fixture),
    (select staff_id from audit_history_fixture),
    (select second_branch_id from audit_history_fixture),true),
  'Owner can explicitly grant Staff access to a second Branch'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_branch_access_events e
   where e.tenant_id=(select tenant_id from audit_history_fixture)),
  2,
  'first explicit nondefault grant emits both default-fallback and new-Branch history'
);
select extensions.ok(
  not exists(
    select 1 from public.sellertray_branch_access_events e
    where e.tenant_id=(select tenant_id from audit_history_fixture)
      and e.actor_user_id is distinct from (select owner_id from audit_history_fixture)
  ),
  'permission events attribute both inherited and explicit Branch grants to the Owner'
);

select public.set_sellertray_member_branch_access(
  (select tenant_id from audit_history_fixture),
  (select staff_id from audit_history_fixture),
  (select second_branch_id from audit_history_fixture),true);

select extensions.is(
  (select count(*)::integer from public.sellertray_branch_access_events e
   where e.tenant_id=(select tenant_id from audit_history_fixture)),
  2,
  'idempotent same-value Staff Branch grant does not duplicate history'
);

select public.set_sellertray_member_branch_access(
  (select tenant_id from audit_history_fixture),
  (select staff_id from audit_history_fixture),
  (select second_branch_id from audit_history_fixture),false);

select extensions.ok(
  (select count(*) from public.sellertray_branch_access_events e
   where e.tenant_id=(select tenant_id from audit_history_fixture))=3
  and exists (
    select 1 from public.sellertray_branch_access_events e
    where e.tenant_id=(select tenant_id from audit_history_fixture)
      and e.branch_id=(select second_branch_id from audit_history_fixture)
      and e.previous_can_operate=true and e.new_can_operate=false),
  'revocation retains before/after decision instead of overwriting a grant'
);

select set_config('request.jwt.claim.sub',(select staff_id::text from audit_history_fixture),true);
do $staff$
begin
  begin
    perform public.set_sellertray_member_branch_access(
      (select tenant_id from audit_history_fixture),
      (select staff_id from audit_history_fixture),
      (select second_branch_id from audit_history_fixture),true);
  exception when sqlstate '42501' then
    update audit_history_fixture set staff_denied=true;
  end;
end;
$staff$;
select extensions.ok(
  (select staff_denied from audit_history_fixture),
  'Staff cannot assign their own Branch authority'
);

select set_config('request.jwt.claim.sub',(select owner_id::text from audit_history_fixture),true);
do $scope$
begin
  begin
    perform public.set_sellertray_member_branch_access(
      (select tenant_id from audit_history_fixture),
      (select staff_id from audit_history_fixture),
      (select foreign_branch_id from audit_history_fixture),true);
  exception when sqlstate '23514' then
    update audit_history_fixture set foreign_branch_denied=true;
  end;
end;
$scope$;
select extensions.ok(
  (select foreign_branch_denied from audit_history_fixture)
  and (select count(*) from public.sellertray_branch_access_events e
       where e.tenant_id=(select tenant_id from audit_history_fixture))=3,
  'cross-Business Branch grants are denied without additional audit records'
);

select extensions.ok(
  public.reset_sellertray_member_branch_access(
    (select tenant_id from audit_history_fixture),
    (select staff_id from audit_history_fixture)
  )=2
  and not exists (
    select 1 from public.branch_user_access bua
    where bua.tenant_id=(select tenant_id from audit_history_fixture)
      and bua.user_id=(select staff_id from audit_history_fixture))
  and (select count(*) from public.sellertray_branch_access_events e
       where e.tenant_id=(select tenant_id from audit_history_fixture))=5,
  'reset records both revoked explicit assignments and restores implicit fallback'
);
select extensions.ok(
  public.reset_sellertray_member_branch_access(
    (select tenant_id from audit_history_fixture),
    (select staff_id from audit_history_fixture)
  )=0
  and (select count(*) from public.sellertray_branch_access_events e
       where e.tenant_id=(select tenant_id from audit_history_fixture))=5,
  'replaying reset is idempotent and does not manufacture history'
);

do $immutable$
begin
  begin
    update public.sellertray_branch_access_events
    set new_can_operate=true
    where tenant_id=(select tenant_id from audit_history_fixture);
  exception when sqlstate '55000' then
    update audit_history_fixture set branch_update_denied=true;
  end;
  begin
    delete from public.sellertray_branch_access_events
    where tenant_id=(select tenant_id from audit_history_fixture);
  exception when sqlstate '55000' then
    update audit_history_fixture set branch_delete_denied=true;
  end;
end;
$immutable$;

select extensions.ok(
  (select branch_update_denied from audit_history_fixture)
  and (select count(*) from public.sellertray_branch_access_events e
       where e.tenant_id=(select tenant_id from audit_history_fixture))=5,
  'existing Branch permissions history cannot be updated'
);
select extensions.ok(
  (select branch_delete_denied from audit_history_fixture),
  'existing Branch permissions history cannot be deleted'
);

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Audit-only low-stock item','AUDIT-LOW',100,true,'Each',false
from audit_history_fixture;

insert into public.branch_inventory_policy_events(
  tenant_id,branch_id,catalog_item_id,
  previous_low_stock_threshold,new_low_stock_threshold,
  previous_reorder_target,new_reorder_target,actor_user_id
)
select tenant_id,branch_id,product_id,0,5,null,10,owner_id
from audit_history_fixture;

do $immutable$
begin
  begin
    update public.branch_inventory_policy_events
    set new_low_stock_threshold=999
    where tenant_id=(select tenant_id from audit_history_fixture);
  exception when sqlstate '55000' then
    update audit_history_fixture set policy_update_denied=true;
  end;
  begin
    delete from public.branch_inventory_policy_events
    where tenant_id=(select tenant_id from audit_history_fixture);
  exception when sqlstate '55000' then
    update audit_history_fixture set policy_delete_denied=true;
  end;
end;
$immutable$;

select extensions.ok(
  (select policy_update_denied from audit_history_fixture)
  and exists (select 1 from public.branch_inventory_policy_events e
              where e.tenant_id=(select tenant_id from audit_history_fixture)
                and e.new_low_stock_threshold=5),
  'inventory policy event values cannot be rewritten'
);
select extensions.ok(
  (select policy_delete_denied from audit_history_fixture),
  'inventory policy event rows cannot be deleted while the Business exists'
);

delete from public.tenants
where id in (select tenant_id from audit_history_fixture
             union all select foreign_tenant_id from audit_history_fixture);

select extensions.ok(
  not exists(select 1 from public.sellertray_branch_access_events e
             where e.tenant_id=(select tenant_id from audit_history_fixture))
  and not exists(select 1 from public.branch_inventory_policy_events e
                 where e.tenant_id=(select tenant_id from audit_history_fixture)),
  'governed Business retirement cascade removes dependent audit rows'
);

select * from extensions.finish();
rollback;
