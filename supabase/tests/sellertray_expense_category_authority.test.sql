begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(28);

create temp table sellertray_expense_category_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_user_id uuid not null,
  staff_user_id uuid not null,
  other_owner_user_id uuid not null,
  branch_id uuid,
  register_id uuid,
  shift_id uuid,
  category_id uuid,
  travel_category_id uuid,
  foreign_category_id uuid,
  legacy_cash_result jsonb,
  uuid_cash_result jsonb,
  business_expense_result jsonb,
  renamed_business_expense_result jsonb,
  correction_result jsonb,
  typed_cash_out_result jsonb,
  event_mutation_rejected boolean not null default false,
  expense_mutation_rejected boolean not null default false
) on commit drop;

insert into sellertray_expense_category_fixture(
  tenant_id,other_tenant_id,owner_user_id,staff_user_id,other_owner_user_id
) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'expense-category-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_expense_category_fixture
union all
select staff_user_id,'expense-category-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_expense_category_fixture
union all
select other_owner_user_id,'expense-category-other-'||substr(other_owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_expense_category_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status,currency)
select tenant_id,'Expense Category Authority Test','expense-category-'||substr(tenant_id::text,1,8),'ECT','active','NGN'
from sellertray_expense_category_fixture
union all
select other_tenant_id,'Expense Category Other Test','expense-category-other-'||substr(other_tenant_id::text,1,8),'ECO','active','NGN'
from sellertray_expense_category_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in (
  (select tenant_id from sellertray_expense_category_fixture),
  (select other_tenant_id from sellertray_expense_category_fixture)
);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_expense_category_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_expense_category_fixture
union all
select other_tenant_id,other_owner_user_id,'owner' from sellertray_expense_category_fixture;

update sellertray_expense_category_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_expense_category_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

select extensions.ok(
  to_regclass('public.sellertray_expense_categories') is not null
  and to_regclass('public.sellertray_expense_category_events') is not null
  and to_regprocedure('public.get_sellertray_expense_categories(uuid,boolean)') is not null
  and to_regprocedure('public.manage_sellertray_expense_category(uuid,text,uuid,text)') is not null
  and to_regprocedure('public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,uuid,text,uuid)') is not null
  and to_regprocedure('public.record_sellertray_business_expense(uuid,uuid,text,uuid,uuid,uuid,numeric,text,text,text,uuid)') is not null,
  'Expense Category authority exposes one governed master and stable-ID write boundaries'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_expense_category_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_expense_category_fixture
set category_id=(public.manage_sellertray_expense_category(
  tenant_id,'create',null,'Delivery'
)->>'id')::uuid;
select extensions.ok((select category_id is not null from sellertray_expense_category_fixture),'Owner can create a governed Expense Category');

update sellertray_expense_category_fixture
set travel_category_id=(public.manage_sellertray_expense_category(
  tenant_id,'create',null,'Travel'
)->>'id')::uuid;
select extensions.ok((select travel_category_id is not null from sellertray_expense_category_fixture),'Owner can create another governed Expense Category');

select extensions.throws_ok(
  format(
    'select public.manage_sellertray_expense_category(%L::uuid,''create'',null,''  delivery  '')',
    (select tenant_id::text from sellertray_expense_category_fixture)
  ),
  '23505','An Expense Category with this name already exists',
  'Expense Category names are unique after governed normalization'
);

select extensions.ok(
  (public.get_sellertray_expense_categories((select tenant_id from sellertray_expense_category_fixture),false)->>'canManage')::boolean
  and jsonb_array_length(public.get_sellertray_expense_categories((select tenant_id from sellertray_expense_category_fixture),false)->'items')=2,
  'Owner reads the active merchant-scoped category master and management capability'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_expense_category_fixture),true);
select extensions.ok(
  not (public.get_sellertray_expense_categories((select tenant_id from sellertray_expense_category_fixture),false)->>'canManage')::boolean
  and jsonb_array_length(public.get_sellertray_expense_categories((select tenant_id from sellertray_expense_category_fixture),false)->'items')=2,
  'Staff can consume active Expense Categories without receiving management authority'
);
select extensions.throws_ok(
  format(
    'select public.get_sellertray_expense_categories(%L::uuid,true)',
    (select tenant_id::text from sellertray_expense_category_fixture)
  ),
  '42501','Only the Business Owner or Manager can review archived Expense Categories',
  'Staff cannot review archived Expense Categories'
);
select extensions.throws_ok(
  format(
    'select public.manage_sellertray_expense_category(%L::uuid,''create'',null,''Forbidden'')',
    (select tenant_id::text from sellertray_expense_category_fixture)
  ),
  '42501','Only the Business Owner or Manager can manage Expense Categories',
  'Staff cannot manage Expense Categories'
);

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_expense_category_fixture),true);
update sellertray_expense_category_fixture
set shift_id=(public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,1000,owner_user_id
)->>'shiftId')::uuid;

update sellertray_expense_category_fixture
set legacy_cash_result=public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'expense',50,'CAT-LEGACY-001','Legacy courier spend','Delivery',
  'expense-category:legacy-cash-001',owner_user_id
);
select extensions.ok(
  exists(
    select 1
    from public.sellertray_shift_cash_movements m,sellertray_expense_category_fixture f
    where m.id=(f.legacy_cash_result->>'movementId')::uuid
      and m.expense_category_id=f.category_id
      and m.expense_category='Delivery'
  ),
  'Legacy text writes remain compatible only by resolving an existing active category to stable identity'
);

update sellertray_expense_category_fixture
set uuid_cash_result=public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'expense',50,'CAT-UUID-001','UUID courier spend',category_id,
  'expense-category:uuid-cash-001',owner_user_id
);
select extensions.ok(
  exists(
    select 1
    from public.sellertray_shift_cash_movements m,sellertray_expense_category_fixture f
    where m.id=(f.uuid_cash_result->>'movementId')::uuid
      and m.expense_category_id=f.category_id
      and m.expense_category='Delivery'
  ),
  'Cashier Expense writes persist stable category identity plus immutable label snapshot'
);

update sellertray_expense_category_fixture
set business_expense_result=public.record_sellertray_business_expense(
  tenant_id,branch_id,'cash',null,shift_id,category_id,25,'CAT-BEXP-001','Management courier spend',
  'expense-category:business-001',owner_user_id
);
select extensions.ok(
  exists(
    select 1
    from public.sellertray_business_expenses e,sellertray_expense_category_fixture f
    where e.id=(f.business_expense_result->>'expenseId')::uuid
      and e.expense_category_id=f.category_id
      and e.expense_category='Delivery'
  ),
  'Business Expense writes persist the same stable category identity and snapshot'
);

select extensions.ok(
  exists(
    select 1
    from sellertray_expense_category_fixture f,
      jsonb_array_elements(public.get_sellertray_money_operation_options(f.tenant_id,f.branch_id)->'expenseCategories') c
    where c->>'id'=f.category_id::text and c->>'name'='Delivery'
  ),
  'Money operation options expose the shared active category identity to clients'
);

select extensions.is(
  public.manage_sellertray_expense_category(
    (select tenant_id from sellertray_expense_category_fixture),'rename',
    (select category_id from sellertray_expense_category_fixture),'Logistics'
  )->>'name',
  'Logistics','Owner can rename the governed Expense Category'
);

select extensions.is(
  (
    select count(*)::integer
    from sellertray_expense_category_fixture f
    join public.sellertray_shift_cash_movements m
      on m.id in ((f.legacy_cash_result->>'movementId')::uuid,(f.uuid_cash_result->>'movementId')::uuid)
    where m.expense_category='Delivery'
  )
  +
  (
    select count(*)::integer
    from sellertray_expense_category_fixture f
    join public.sellertray_business_expenses e
      on e.id=(f.business_expense_result->>'expenseId')::uuid
    where e.expense_category='Delivery'
  ),
  3,'Category rename never rewrites historical transaction snapshots'
);

update sellertray_expense_category_fixture
set renamed_business_expense_result=public.record_sellertray_business_expense(
  tenant_id,branch_id,'cash',null,shift_id,category_id,25,'CAT-BEXP-002','Management logistics spend',
  'expense-category:business-002',owner_user_id
);
select extensions.ok(
  exists(
    select 1
    from public.sellertray_business_expenses e,sellertray_expense_category_fixture f
    where e.id=(f.renamed_business_expense_result->>'expenseId')::uuid
      and e.expense_category_id=f.category_id
      and e.expense_category='Logistics'
  ),
  'New transactions resolve the current category name while keeping the same stable identity'
);

select extensions.ok(
  not (public.manage_sellertray_expense_category(
    (select tenant_id from sellertray_expense_category_fixture),'archive',
    (select category_id from sellertray_expense_category_fixture),null
  )->>'isActive')::boolean,
  'Owner can archive a governed Expense Category without rewriting history'
);

select extensions.ok(
  not exists(
    select 1
    from sellertray_expense_category_fixture f,
      jsonb_array_elements(public.get_sellertray_expense_categories(f.tenant_id,false)->'items') c
    where c->>'id'=f.category_id::text
  ),
  'Archived Expense Categories disappear from active selectors'
);

select extensions.throws_ok(
  format(
    'select public.record_sellertray_shift_cash_movement(%L::uuid,%L::uuid,''expense'',10,''CAT-ARCH-UUID'',''Archived UUID'',%L::uuid,''expense-category:archived-uuid'',%L::uuid)',
    (select tenant_id::text from sellertray_expense_category_fixture),
    (select shift_id::text from sellertray_expense_category_fixture),
    (select category_id::text from sellertray_expense_category_fixture),
    (select owner_user_id::text from sellertray_expense_category_fixture)
  ),
  '23514','Choose an active Expense Category for this Business',
  'Archived category identity is rejected for new cashier expenses'
);

select extensions.throws_ok(
  format(
    'select public.record_sellertray_shift_cash_movement(%L::uuid,%L::uuid,''expense'',10,''CAT-ARCH-TEXT'',''Archived text'',''Logistics'',''expense-category:archived-text'',%L::uuid)',
    (select tenant_id::text from sellertray_expense_category_fixture),
    (select shift_id::text from sellertray_expense_category_fixture),
    (select owner_user_id::text from sellertray_expense_category_fixture)
  ),
  '23514','Choose an active Expense Category for this Business',
  'Legacy free text cannot manufacture or reuse an archived category'
);

select extensions.is(
  public.record_sellertray_shift_cash_movement(
    (select tenant_id from sellertray_expense_category_fixture),
    (select shift_id from sellertray_expense_category_fixture),
    'expense',50,'CAT-UUID-001','UUID courier spend',
    (select category_id from sellertray_expense_category_fixture),
    'expense-category:uuid-cash-001',
    (select owner_user_id from sellertray_expense_category_fixture)
  )->>'idempotentReplay',
  'true','Exact stable-ID retry remains idempotent even after the category is archived'
);

select extensions.throws_ok(
  format(
    'select public.record_sellertray_shift_cash_movement(%L::uuid,%L::uuid,''expense'',50,''CAT-UUID-001'',''UUID courier spend'',%L::uuid,''expense-category:uuid-cash-001'',%L::uuid)',
    (select tenant_id::text from sellertray_expense_category_fixture),
    (select shift_id::text from sellertray_expense_category_fixture),
    (select travel_category_id::text from sellertray_expense_category_fixture),
    (select owner_user_id::text from sellertray_expense_category_fixture)
  ),
  '23505','Cash activity retry identity is already used for different facts',
  'Stable command identity cannot be replayed with a different Expense Category'
);

with x as (
  insert into public.sellertray_expense_categories(
    tenant_id,name,is_active,created_by_user_id,updated_by_user_id
  )
  select other_tenant_id,'Foreign Category',true,other_owner_user_id,other_owner_user_id
  from sellertray_expense_category_fixture
  returning id
)
update sellertray_expense_category_fixture set foreign_category_id=(select id from x);

select extensions.throws_ok(
  format(
    'select public.record_sellertray_business_expense(%L::uuid,%L::uuid,''cash'',null,%L::uuid,%L::uuid,10,''CAT-XTENANT'',''Cross Business category'',''expense-category:cross-tenant'',%L::uuid)',
    (select tenant_id::text from sellertray_expense_category_fixture),
    (select branch_id::text from sellertray_expense_category_fixture),
    (select shift_id::text from sellertray_expense_category_fixture),
    (select foreign_category_id::text from sellertray_expense_category_fixture),
    (select owner_user_id::text from sellertray_expense_category_fixture)
  ),
  '23514','Choose an active Expense Category for this Business',
  'Another Business category identity is rejected at the shared authority boundary'
);

select extensions.ok(
  (public.manage_sellertray_expense_category(
    (select tenant_id from sellertray_expense_category_fixture),'reactivate',
    (select category_id from sellertray_expense_category_fixture),null
  )->>'isActive')::boolean,
  'Archived Expense Category can be explicitly reactivated'
);

update sellertray_expense_category_fixture
set correction_result=public.correct_sellertray_shift_cash_movement(
  tenant_id,shift_id,(uuid_cash_result->>'movementId')::uuid,
  'replace','Correct expense amount','expense-category:correction-001',
  'expense',40,'CAT-UUID-001-R','Corrected courier spend',category_id,owner_user_id
);
select extensions.ok(
  exists(
    select 1
    from public.sellertray_shift_cash_movement_corrections c
    join public.sellertray_shift_cash_movements m
      on m.tenant_id=c.tenant_id and m.id=c.replacement_movement_id
    join sellertray_expense_category_fixture f
      on f.tenant_id=c.tenant_id
    where c.original_movement_id=(f.uuid_cash_result->>'movementId')::uuid
      and m.expense_category_id=f.category_id
      and m.expense_category='Logistics'
  ),
  'Expense correction selects stable identity and snapshots the current category label'
);

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_expense_category_events e,sellertray_expense_category_fixture f
    where e.tenant_id=f.tenant_id
      and e.category_id=f.category_id
      and e.action in ('create','rename','archive','reactivate')
  ),
  4,'Expense Category lifecycle is fully audited'
);

do $$
begin
  begin
    update public.sellertray_expense_category_events
    set new_name='Tampered'
    where tenant_id=(select tenant_id from sellertray_expense_category_fixture)
      and category_id=(select category_id from sellertray_expense_category_fixture)
      and action='create';
  exception when sqlstate '55000' then
    update sellertray_expense_category_fixture set event_mutation_rejected=true;
  end;
end
$$;
select extensions.ok((select event_mutation_rejected from sellertray_expense_category_fixture),'Expense Category audit history is immutable');

do $$
begin
  begin
    update public.sellertray_business_expenses
    set expense_category_id=(select travel_category_id from sellertray_expense_category_fixture)
    where tenant_id=(select tenant_id from sellertray_expense_category_fixture)
      and id=((select business_expense_result->>'expenseId' from sellertray_expense_category_fixture))::uuid;
  exception when sqlstate '55000' then
    update sellertray_expense_category_fixture set expense_mutation_rejected=true;
  end;
end
$$;
select extensions.ok((select expense_mutation_rejected from sellertray_expense_category_fixture),'Posted Business Expense category identity remains immutable');

update sellertray_expense_category_fixture
set typed_cash_out_result=public.record_sellertray_typed_cash_out(
  tenant_id,shift_id,'owner_withdrawal',null,10,'CAT-DRAW-001','Owner withdrawal stays typed Cash Out',
  'expense-category:typed-cash-out',owner_user_id
);
select extensions.ok(
  exists(
    select 1
    from public.sellertray_shift_cash_movements m
    join public.sellertray_cash_movement_classifications c
      on c.tenant_id=m.tenant_id and c.movement_id=m.id
    join sellertray_expense_category_fixture f on f.tenant_id=m.tenant_id
    where m.id=(f.typed_cash_out_result->>'movementId')::uuid
      and m.expense_category_id is null
      and m.expense_category is null
      and c.activity_classification='owner_withdrawal'
  ),
  'Typed Cash Out remains separate from Expense Category authority'
);

select * from extensions.finish();
rollback;