begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(33);

create temp table sellertray_cash_shift_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  branch_two_id uuid,
  location_id uuid,
  register_id uuid,
  stock_uom_id uuid,
  shift_id uuid,
  second_shift_id uuid,
  order_id uuid,
  open_result jsonb,
  movement_result jsonb,
  movement_replay jsonb,
  close_result jsonb,
  review_result jsonb,
  duplicate_open_rejected boolean not null default false,
  conflict_rejected boolean not null default false,
  variance_note_rejected boolean not null default false,
  closed_movement_rejected boolean not null default false,
  staff_review_rejected boolean not null default false,
  cross_branch_rejected boolean not null default false,
  terminal_update_rejected boolean not null default false,
  movement_update_rejected boolean not null default false
) on commit drop;

insert into sellertray_cash_shift_fixture(
  tenant_id,owner_user_id,manager_user_id,staff_user_id,product_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'shift-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_cash_shift_fixture
union all
select manager_user_id,'shift-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_cash_shift_fixture
union all
select staff_user_id,'shift-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_cash_shift_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Cash Shift Test','sellertray-cash-shift-'||substr(tenant_id::text,1,8),'CST','active'
from sellertray_cash_shift_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_cash_shift_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_cash_shift_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_cash_shift_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_cash_shift_fixture;

insert into public.sellertray_expense_categories(
  tenant_id,name,is_active,created_by_user_id,updated_by_user_id
)
select f.tenant_id,v.name,true,f.owner_user_id,f.owner_user_id
from sellertray_cash_shift_fixture f
cross join (values ('Delivery'),('General')) v(name);

update sellertray_cash_shift_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'SHIFT2','Second Shift Branch',false,true
from sellertray_cash_shift_fixture;

update sellertray_cash_shift_fixture f
set branch_two_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='SHIFT2';

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_user_id,true
from sellertray_cash_shift_fixture;

update sellertray_cash_shift_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

update sellertray_cash_shift_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Shift Test Product','SHIFT-PRODUCT',100,true,'Each',false
from sellertray_cash_shift_fixture;

update sellertray_cash_shift_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',20,'Each',20,1,
  'opening_stock','SHIFT-OPENING','shift:opening',
  now(),owner_user_id,'Opening stock for cashier shift test','{}'::jsonb,null
)
from sellertray_cash_shift_fixture;

select extensions.ok(
  exists(
    select 1 from public.sellertray_registers r
    where r.tenant_id=(select tenant_id from sellertray_cash_shift_fixture)
      and r.branch_id=(select branch_id from sellertray_cash_shift_fixture)
      and r.is_default=true and r.name='Main Register'
  ),
  'each branch has a default Main Register'
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_registers r
    where r.tenant_id=(select tenant_id from sellertray_cash_shift_fixture)
      and r.branch_id=(select branch_two_id from sellertray_cash_shift_fixture)
      and r.is_default=true
  ),
  'new branches automatically receive a default register'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_cash_shift_fixture),
    (select staff_user_id from sellertray_cash_shift_fixture),
    'can_open_shift'
  ),
  'Staff can open their own cashier shift by role default'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_cash_shift_fixture),
    (select staff_user_id from sellertray_cash_shift_fixture),
    'can_record_expense'
  ),
  'Staff can record governed drawer expenses by role default'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_cash_shift_fixture),
    (select staff_user_id from sellertray_cash_shift_fixture),
    'can_review_shift'
  ),
  'Staff does not receive shift-review authority by role alone'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_cash_shift_fixture),
    (select manager_user_id from sellertray_cash_shift_fixture),
    'can_review_shift'
  ),
  'Manager has cashier shift review authority by role'
);

update sellertray_cash_shift_fixture
set open_result=public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,1000,staff_user_id
);
update sellertray_cash_shift_fixture
set shift_id=(open_result->>'shiftId')::uuid;

select extensions.is(
  (select open_result->>'status' from sellertray_cash_shift_fixture),
  'open','cashier shift opens explicitly'
);

select extensions.is(
  (select (open_result->>'expectedCash')::numeric from sellertray_cash_shift_fixture),
  1000::numeric,'opening cash is the first expected-cash position'
);

update sellertray_cash_shift_fixture
set open_result=public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,1000,staff_user_id
);

select extensions.is(
  (select open_result->>'idempotentReplay' from sellertray_cash_shift_fixture),
  'true','same cashier shift open retry returns the existing shift'
);

do $$
begin
  begin
    perform public.open_sellertray_cash_shift(
      (select tenant_id from sellertray_cash_shift_fixture),
      (select branch_id from sellertray_cash_shift_fixture),
      (select register_id from sellertray_cash_shift_fixture),
      1100,
      (select staff_user_id from sellertray_cash_shift_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_cash_shift_fixture set duplicate_open_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select duplicate_open_rejected from sellertray_cash_shift_fixture),
  'a conflicting second open request is rejected'
);

update sellertray_cash_shift_fixture
set movement_result=public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'cash_in',200,'FLOAT-001','Additional till float',null,staff_user_id
);

select extensions.is(
  (select (movement_result->>'expectedCash')::numeric from sellertray_cash_shift_fixture),
  1200::numeric,'cash in increases expected cash'
);

update sellertray_cash_shift_fixture
set movement_replay=public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'cash_in',200,'FLOAT-001','Additional till float',null,staff_user_id
);

select extensions.is(
  (select movement_replay->>'idempotentReplay' from sellertray_cash_shift_fixture),
  'true','same cash movement reference retries idempotently'
);

select public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'expense',50,'EXP-001','Courier cash payment','Delivery',staff_user_id
)
from sellertray_cash_shift_fixture;

select public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'cash_out',100,'CASHOUT-001','Cash removed for safe drop',null,staff_user_id
)
from sellertray_cash_shift_fixture;

do $$
begin
  begin
    perform public.record_sellertray_shift_cash_movement(
      (select tenant_id from sellertray_cash_shift_fixture),
      (select shift_id from sellertray_cash_shift_fixture),
      'cash_in',250,'FLOAT-001','Different retry facts',null,
      (select staff_user_id from sellertray_cash_shift_fixture)
    );
  exception when sqlstate '23505' then
    update sellertray_cash_shift_fixture set conflict_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select conflict_rejected from sellertray_cash_shift_fixture),
  'reusing a cash reference with conflicting facts is rejected'
);

update sellertray_cash_shift_fixture
set order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Shift-linked counter sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',stock_uom_id,
    'quantity',2
  ))
);

set local request.jwt.claim.role='service_role';

select public.complete_sellertray_pos_cash_sale(tenant_id,order_id,staff_user_id)
from sellertray_cash_shift_fixture;

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_shift_cash_sales s
    where s.tenant_id=(select tenant_id from sellertray_cash_shift_fixture)
      and s.shift_id=(select shift_id from sellertray_cash_shift_fixture)
  ),
  1,'confirmed POS cash is captured into the cashier open shift'
);

select extensions.is(
  (
    select s.amount
    from public.sellertray_shift_cash_sales s
    where s.shift_id=(select shift_id from sellertray_cash_shift_fixture)
  ),
  200::numeric,'shift cash sale uses the exact shared payment amount'
);

select extensions.is(
  (
    select t.expected_cash
    from public.sellertray_cash_shift_totals(
      (select tenant_id from sellertray_cash_shift_fixture),
      (select shift_id from sellertray_cash_shift_fixture)
    ) t
  ),
  1250::numeric,'expected cash reconciles opening cash, POS cash, cash in, cash out and expenses'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_cash_shift_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.is(
  (
    select (public.get_sellertray_active_cash_shift(tenant_id,branch_id)->>'shiftId')::uuid
    from sellertray_cash_shift_fixture
  ),
  (select shift_id from sellertray_cash_shift_fixture),
  'mobile current-user read resolves the cashier own active branch shift'
);

select extensions.is(
  (
    select (public.get_sellertray_active_cash_shift(tenant_id,branch_id)->>'expenses')::numeric
    from sellertray_cash_shift_fixture
  ),
  50::numeric,'shift read exposes governed expense total'
);

do $$
begin
  begin
    perform public.review_sellertray_cash_shift(
      (select tenant_id from sellertray_cash_shift_fixture),
      (select shift_id from sellertray_cash_shift_fixture),
      'accepted',null,
      (select staff_user_id from sellertray_cash_shift_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_cash_shift_fixture set staff_review_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_review_rejected from sellertray_cash_shift_fixture),
  'Staff cannot self-review a cashier shift'
);

do $$
begin
  begin
    perform public.close_sellertray_cash_shift(
      (select tenant_id from sellertray_cash_shift_fixture),
      (select shift_id from sellertray_cash_shift_fixture),
      1260,null,
      (select staff_user_id from sellertray_cash_shift_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_cash_shift_fixture set variance_note_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select variance_note_rejected from sellertray_cash_shift_fixture),
  'non-zero closing variance requires an explanation'
);

update sellertray_cash_shift_fixture
set close_result=public.close_sellertray_cash_shift(
  tenant_id,shift_id,1260,'Drawer is ten naira over',staff_user_id
);

select extensions.is(
  (select close_result->>'status' from sellertray_cash_shift_fixture),
  'closed','authorised cashier can close their own shift'
);

select extensions.is(
  (select (close_result->>'expectedCash')::numeric from sellertray_cash_shift_fixture),
  1250::numeric,'close snapshots the reconciled expected cash'
);

select extensions.is(
  (select (close_result->>'variance')::numeric from sellertray_cash_shift_fixture),
  10::numeric,'close records declared-versus-expected cash variance'
);

do $$
begin
  begin
    perform public.record_sellertray_shift_cash_movement(
      (select tenant_id from sellertray_cash_shift_fixture),
      (select shift_id from sellertray_cash_shift_fixture),
      'expense',10,'EXP-LATE','Late expense','General',
      (select staff_user_id from sellertray_cash_shift_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_cash_shift_fixture set closed_movement_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select closed_movement_rejected from sellertray_cash_shift_fixture),
  'closed shifts reject later cash activity'
);

update sellertray_cash_shift_fixture
set review_result=public.review_sellertray_cash_shift(
  tenant_id,shift_id,'accepted','Variance reviewed with cashier',manager_user_id
);

select extensions.is(
  (select review_result->>'status' from sellertray_cash_shift_fixture),
  'reviewed','Manager can complete shift review'
);

select extensions.is(
  (
    select s.review_decision
    from public.sellertray_cash_shifts s
    where s.id=(select shift_id from sellertray_cash_shift_fixture)
  ),
  'accepted','manager review decision is preserved'
);

do $$
begin
  begin
    update public.sellertray_cash_shifts
    set declared_cash=9999
    where id=(select shift_id from sellertray_cash_shift_fixture);
  exception when sqlstate '55000' then
    update sellertray_cash_shift_fixture set terminal_update_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select terminal_update_rejected from sellertray_cash_shift_fixture),
  'reviewed shift cash facts are immutable'
);

do $$
begin
  begin
    update public.sellertray_shift_cash_movements
    set amount=9999
    where id=(
      select m.id
      from public.sellertray_shift_cash_movements m
      where m.shift_id=(select shift_id from sellertray_cash_shift_fixture)
      order by m.created_at,m.id
      limit 1
    );
  exception when sqlstate '55000' then
    update sellertray_cash_shift_fixture set movement_update_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select movement_update_rejected from sellertray_cash_shift_fixture),
  'posted cashier cash movement history is immutable'
);

update sellertray_cash_shift_fixture
set second_shift_id=(public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,500,staff_user_id
)->>'shiftId')::uuid;

select extensions.ok(
  (select second_shift_id is not null from sellertray_cash_shift_fixture),
  'cashier can open a new shift after the previous shift is closed and reviewed'
);

select extensions.ok(
  not public.set_sellertray_member_capability(
    (select tenant_id from sellertray_cash_shift_fixture),
    (select staff_user_id from sellertray_cash_shift_fixture),
    'can_record_expense',false,
    (select owner_user_id from sellertray_cash_shift_fixture)
  ),
  'Owner can explicitly revoke Staff expense authority'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_cash_shift_fixture),
    (select staff_user_id from sellertray_cash_shift_fixture),
    'can_record_expense'
  ),
  'explicit Staff expense revocation overrides role default'
);

do $$
begin
  begin
    perform public.open_sellertray_cash_shift(
      (select tenant_id from sellertray_cash_shift_fixture),
      (select branch_two_id from sellertray_cash_shift_fixture),
      (
        select r.id from public.sellertray_registers r
        where r.tenant_id=(select tenant_id from sellertray_cash_shift_fixture)
          and r.branch_id=(select branch_two_id from sellertray_cash_shift_fixture)
          and r.is_default=true
      ),
      0,
      (select staff_user_id from sellertray_cash_shift_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_cash_shift_fixture set cross_branch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cross_branch_rejected from sellertray_cash_shift_fixture),
  'cashier shift capability never bypasses Staff branch isolation'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated','public.open_sellertray_cash_shift(uuid,uuid,uuid,numeric,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.close_sellertray_cash_shift(uuid,uuid,numeric,text,uuid)','EXECUTE'
  ),
  'cashier mutation commands remain server-only'
);

select * from extensions.finish();
rollback;