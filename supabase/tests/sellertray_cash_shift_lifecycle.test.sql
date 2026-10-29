begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

create temp table sellertray_cash_lifecycle_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  branch_id uuid,
  register_id uuid,
  shift_id uuid,
  movement_id uuid,
  direct_delete_rejected boolean not null default false
) on commit drop;

insert into sellertray_cash_lifecycle_fixture(tenant_id,owner_user_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'cash-lifecycle-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_cash_lifecycle_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Cash Lifecycle Test',
  'sellertray-cash-lifecycle-'||substr(tenant_id::text,1,8),'CLT','active'
from sellertray_cash_lifecycle_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_cash_lifecycle_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_cash_lifecycle_fixture;

update sellertray_cash_lifecycle_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_cash_lifecycle_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

update sellertray_cash_lifecycle_fixture
set shift_id=(public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,100,owner_user_id
)->>'shiftId')::uuid;

select extensions.ok(
  (select shift_id is not null from sellertray_cash_lifecycle_fixture),
  'cashier shift exists before lifecycle cleanup'
);

update sellertray_cash_lifecycle_fixture
set movement_id=(public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'cash_in',20,'LIFECYCLE-CASH-IN','Lifecycle cash evidence',null,owner_user_id
)->>'movementId')::uuid;

select extensions.ok(
  (select movement_id is not null from sellertray_cash_lifecycle_fixture),
  'cash movement evidence exists before lifecycle cleanup'
);

-- Tenant teardown must also work after governed correction history exists, not
-- only for a pristine cash ledger. Replacing 20 with 15 makes expected cash 115.
select public.correct_sellertray_shift_cash_movement(
  tenant_id,
  shift_id,
  movement_id,
  'replace',
  'Lifecycle correction evidence',
  'lifecycle-correct-001',
  'cash_in',
  15,
  'LIFECYCLE-CASH-IN-CORRECTED',
  'Corrected lifecycle cash evidence',
  null,
  owner_user_id
)
from sellertray_cash_lifecycle_fixture;

select extensions.is(
  (
    select public.close_sellertray_cash_shift(
      tenant_id,shift_id,115,null,owner_user_id
    )->>'status'
    from sellertray_cash_lifecycle_fixture
  ),
  'closed','cashier shift closes before lifecycle cleanup'
);

select extensions.is(
  (
    select public.review_sellertray_cash_shift(
      tenant_id,shift_id,'accepted','Lifecycle review',owner_user_id
    )->>'status'
    from sellertray_cash_lifecycle_fixture
  ),
  'reviewed','cashier shift review is historical evidence before deletion'
);

do $$
begin
  begin
    delete from public.sellertray_cash_shifts
    where id=(select shift_id from sellertray_cash_lifecycle_fixture);
  exception when sqlstate '55000' then
    update sellertray_cash_lifecycle_fixture set direct_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select direct_delete_rejected from sellertray_cash_lifecycle_fixture),
  'cashier history cannot be deleted directly while the business exists'
);

delete from public.tenants
where id=(select tenant_id from sellertray_cash_lifecycle_fixture);

select extensions.ok(
  not exists(
    select 1 from public.tenants t
    where t.id=(select tenant_id from sellertray_cash_lifecycle_fixture)
  ),
  'governed parent business deletion is not blocked by corrected cashier history'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_cash_shifts s
    where s.tenant_id=(select tenant_id from sellertray_cash_lifecycle_fixture)
  ),
  0,'cashier shifts follow parent business deletion'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_shift_cash_movements m
    where m.tenant_id=(select tenant_id from sellertray_cash_lifecycle_fixture)
  ),
  0,'corrected cash movement history follows parent business deletion'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_registers r
    where r.tenant_id=(select tenant_id from sellertray_cash_lifecycle_fixture)
  ),
  0,'register records follow parent business deletion'
);

select * from extensions.finish();
rollback;