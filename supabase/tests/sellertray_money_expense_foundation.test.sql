begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(25);

create temp table sellertray_money_fixture (
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  other_owner_user_id uuid not null,
  branch_id uuid,
  register_id uuid,
  shift_id uuid,
  bank_id uuid,
  other_bank_id uuid,
  bank_deposit_result jsonb,
  owner_withdrawal_result jsonb,
  cash_expense_result jsonb,
  cash_expense_replay jsonb,
  bank_expense_result jsonb,
  cross_bank_rejected boolean not null default false,
  missing_bank_rejected boolean not null default false,
  staff_expense_rejected boolean not null default false,
  cross_bank_expense_rejected boolean not null default false,
  typed_correction_rejected boolean not null default false,
  immutable_expense_rejected boolean not null default false
) on commit drop;

insert into sellertray_money_fixture(
  tenant_id,other_tenant_id,owner_user_id,manager_user_id,staff_user_id,other_owner_user_id
) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'money-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_money_fixture
union all select manager_user_id,'money-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_money_fixture
union all select staff_user_id,'money-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_money_fixture
union all select other_owner_user_id,'money-other-'||substr(other_owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_money_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status,currency)
select tenant_id,'SellerTray Money Test','sellertray-money-'||substr(tenant_id::text,1,8),'MNY','active','NGN' from sellertray_money_fixture
union all
select other_tenant_id,'SellerTray Other Money Test','sellertray-money-other-'||substr(other_tenant_id::text,1,8),'MNO','active','NGN' from sellertray_money_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id in ((select tenant_id from sellertray_money_fixture),(select other_tenant_id from sellertray_money_fixture));

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_money_fixture
union all select tenant_id,manager_user_id,'manager' from sellertray_money_fixture
union all select tenant_id,staff_user_id,'staff' from sellertray_money_fixture
union all select other_tenant_id,other_owner_user_id,'owner' from sellertray_money_fixture;

insert into public.sellertray_expense_categories(
  tenant_id,name,is_active,created_by_user_id,updated_by_user_id
)
select f.tenant_id,v.name,true,f.owner_user_id,f.owner_user_id
from sellertray_money_fixture f
cross join (values ('Delivery'),('General'),('Operations'),('Utilities')) v(name);

update sellertray_money_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_user_id,true from sellertray_money_fixture;

update sellertray_money_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

insert into public.merchant_payment_methods(
  id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,configuration_status,
  bank_name,bank_account_name,bank_account_number,created_by_user_id,updated_by_user_id
)
select gen_random_uuid(),tenant_id,'bank_transfer','Main Business Bank',true,false,10,'live','ready',
  'Test Bank','SellerTray Money Test','1000000001',owner_user_id,owner_user_id
from sellertray_money_fixture;

update sellertray_money_fixture f
set bank_id=m.id
from public.merchant_payment_methods m
where m.tenant_id=f.tenant_id and m.display_name='Main Business Bank';

insert into public.merchant_payment_methods(
  id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,configuration_status,
  bank_name,bank_account_name,bank_account_number,created_by_user_id,updated_by_user_id
)
select gen_random_uuid(),other_tenant_id,'bank_transfer','Other Business Bank',true,false,10,'live','ready',
  'Other Bank','Other SellerTray Business','2000000002',other_owner_user_id,other_owner_user_id
from sellertray_money_fixture;

update sellertray_money_fixture f
set other_bank_id=m.id
from public.merchant_payment_methods m
where m.tenant_id=f.other_tenant_id and m.display_name='Other Business Bank';

update sellertray_money_fixture
set shift_id=(public.open_sellertray_cash_shift(tenant_id,branch_id,register_id,1000,staff_user_id)->>'shiftId')::uuid;

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_money_fixture),
    (select staff_user_id from sellertray_money_fixture),
    'can_record_cash_movement'
  ),
  'Staff retains ordinary governed cash-movement capability'
);

update sellertray_money_fixture
set bank_deposit_result=public.record_sellertray_typed_cash_out(
  tenant_id,shift_id,'bank_deposit',bank_id,100,'DEP-001','Deposit cash to Business bank',
  'money-test:bank-deposit-001',staff_user_id
);

select extensions.is(
  (select bank_deposit_result->>'cashOutType' from sellertray_money_fixture),
  'bank_deposit','Bank Deposit is returned as a typed Cash Out'
);

select extensions.is(
  (select t.expected_cash from public.sellertray_cash_shift_totals(
    (select tenant_id from sellertray_money_fixture),(select shift_id from sellertray_money_fixture)
  ) t),
  900::numeric,'Bank Deposit reduces expected drawer cash exactly once'
);

select extensions.is(
  (select count(*)::integer from public.sellertray_business_expenses e
    where e.tenant_id=(select tenant_id from sellertray_money_fixture)),
  0,'Bank Deposit does not create an operating Business Expense'
);

select extensions.is(
  (select c.activity_classification from public.sellertray_cash_movement_classifications c
    where c.tenant_id=(select tenant_id from sellertray_money_fixture)
      and c.movement_id=((select bank_deposit_result->>'movementId' from sellertray_money_fixture))::uuid),
  'bank_deposit','Bank Deposit classification is immutable beside the cash ledger'
);

update sellertray_money_fixture
set owner_withdrawal_result=public.record_sellertray_typed_cash_out(
  tenant_id,shift_id,'owner_withdrawal',null,100,'DRAW-001','Owner cash withdrawal',
  'money-test:owner-withdrawal-001',staff_user_id
);

select extensions.is(
  (select t.expected_cash from public.sellertray_cash_shift_totals(
    (select tenant_id from sellertray_money_fixture),(select shift_id from sellertray_money_fixture)
  ) t),
  800::numeric,'Owner Withdrawal reduces expected drawer cash exactly once'
);

select extensions.is(
  (select count(*)::integer from public.sellertray_business_expenses e
    where e.tenant_id=(select tenant_id from sellertray_money_fixture)),
  0,'Owner Withdrawal is not an operating Business Expense'
);

select public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'expense',50,'CASHIER-EXP-001','Cashier courier spend','Delivery',
  'money-test:cashier-expense-001',staff_user_id
) from sellertray_money_fixture;

select extensions.is(
  (select t.expected_cash from public.sellertray_cash_shift_totals(
    (select tenant_id from sellertray_money_fixture),(select shift_id from sellertray_money_fixture)
  ) t),
  750::numeric,'Cashier Expense remains a shift expense and reduces the drawer once'
);

select extensions.is(
  (select count(*)::integer from public.sellertray_business_expenses e
    where e.tenant_id=(select tenant_id from sellertray_money_fixture)),
  0,'Cashier Expense remains separate from management-level Business Expense'
);

do $$
begin
  begin
    perform public.record_sellertray_business_expense(
      (select tenant_id from sellertray_money_fixture),(select branch_id from sellertray_money_fixture),
      'cash',null,(select shift_id from sellertray_money_fixture),'General',20,'BEXP-STAFF-001','Staff must not create this',
      'money-test:staff-business-expense',(select staff_user_id from sellertray_money_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_money_fixture set staff_expense_rejected=true;
  end;
end
$$;
select extensions.ok((select staff_expense_rejected from sellertray_money_fixture),'Staff cannot create a Business Expense');

update sellertray_money_fixture
set cash_expense_result=public.record_sellertray_business_expense(
  tenant_id,branch_id,'cash',null,shift_id,'Operations',100,'BEXP-CASH-001','Management cash expense',
  'money-test:business-cash-001',manager_user_id
);

select extensions.is(
  (select t.expected_cash from public.sellertray_cash_shift_totals(
    (select tenant_id from sellertray_money_fixture),(select shift_id from sellertray_money_fixture)
  ) t),
  650::numeric,'Cash-funded Business Expense creates exactly one drawer effect'
);

select extensions.is(
  (select count(*)::integer from public.sellertray_business_expenses e
    where e.tenant_id=(select tenant_id from sellertray_money_fixture) and e.funding_source='cash'),
  1,'Cash-funded Business Expense creates one management expense record'
);

select extensions.is(
  (select count(*)::integer
   from public.sellertray_cash_movement_classifications c
   where c.tenant_id=(select tenant_id from sellertray_money_fixture)
     and c.business_expense_id=((select cash_expense_result->>'expenseId' from sellertray_money_fixture))::uuid),
  1,'Cash-funded Business Expense links to one cash-ledger effect'
);

update sellertray_money_fixture
set cash_expense_replay=public.record_sellertray_business_expense(
  tenant_id,branch_id,'cash',null,shift_id,'Operations',100,'BEXP-CASH-001','Management cash expense',
  'money-test:business-cash-001',manager_user_id
);

select extensions.is((select cash_expense_replay->>'idempotentReplay' from sellertray_money_fixture),'true','Business Expense command retries idempotently');
select extensions.is(
  (select count(*)::integer from public.sellertray_shift_cash_movements m
   join public.sellertray_cash_movement_classifications c on c.tenant_id=m.tenant_id and c.movement_id=m.id
   where c.tenant_id=(select tenant_id from sellertray_money_fixture)
     and c.business_expense_id=((select cash_expense_result->>'expenseId' from sellertray_money_fixture))::uuid),
  1,'Business Expense retry does not duplicate drawer movements'
);

update sellertray_money_fixture
set bank_expense_result=public.record_sellertray_business_expense(
  tenant_id,branch_id,'bank',bank_id,null,'Utilities',200,'BEXP-BANK-001','Internet subscription',
  'money-test:business-bank-001',owner_user_id
);

select extensions.is(
  (select t.expected_cash from public.sellertray_cash_shift_totals(
    (select tenant_id from sellertray_money_fixture),(select shift_id from sellertray_money_fixture)
  ) t),
  650::numeric,'Bank-funded Business Expense does not change drawer cash'
);

select extensions.is(
  (select count(*)::integer from public.sellertray_business_expenses e
    where e.tenant_id=(select tenant_id from sellertray_money_fixture) and e.funding_source='bank'),
  1,'Bank-funded Business Expense is recorded with management authority'
);

do $$
begin
  begin
    perform public.record_sellertray_typed_cash_out(
      (select tenant_id from sellertray_money_fixture),(select shift_id from sellertray_money_fixture),
      'bank_deposit',(select other_bank_id from sellertray_money_fixture),10,'DEP-XTENANT','Invalid destination',
      'money-test:cross-bank-deposit',(select staff_user_id from sellertray_money_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_money_fixture set cross_bank_rejected=true;
  end;
end
$$;
select extensions.ok((select cross_bank_rejected from sellertray_money_fixture),'Bank Deposit rejects another Business bank account');

do $$
begin
  begin
    perform public.record_sellertray_typed_cash_out(
      (select tenant_id from sellertray_money_fixture),(select shift_id from sellertray_money_fixture),
      'bank_deposit',null,10,'DEP-NOBANK','Missing destination',
      'money-test:missing-bank-deposit',(select staff_user_id from sellertray_money_fixture)
    );
  exception when sqlstate '22023' then
    update sellertray_money_fixture set missing_bank_rejected=true;
  end;
end
$$;
select extensions.ok((select missing_bank_rejected from sellertray_money_fixture),'Bank Deposit requires a destination Business bank account');

do $$
begin
  begin
    perform public.record_sellertray_business_expense(
      (select tenant_id from sellertray_money_fixture),(select branch_id from sellertray_money_fixture),
      'bank',(select other_bank_id from sellertray_money_fixture),null,'Utilities',20,'BEXP-XTENANT','Invalid bank expense',
      'money-test:cross-bank-expense',(select manager_user_id from sellertray_money_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_money_fixture set cross_bank_expense_rejected=true;
  end;
end
$$;
select extensions.ok((select cross_bank_expense_rejected from sellertray_money_fixture),'Business Expense rejects another Business bank account');

do $$
begin
  begin
    perform public.correct_sellertray_shift_cash_movement(
      (select tenant_id from sellertray_money_fixture),(select shift_id from sellertray_money_fixture),
      ((select owner_withdrawal_result->>'movementId' from sellertray_money_fixture))::uuid,
      'replace','Incorrect amount','money-test:typed-correction-type','expense',90,'DRAW-001-R','Invalid type change','General',
      (select manager_user_id from sellertray_money_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_money_fixture set typed_correction_rejected=true;
  end;
end
$$;
select extensions.ok((select typed_correction_rejected from sellertray_money_fixture),'Cash correction cannot turn typed Cash Out into an expense');

select public.correct_sellertray_shift_cash_movement(
  tenant_id,shift_id,(bank_deposit_result->>'movementId')::uuid,
  'replace','Deposit amount corrected','money-test:bank-deposit-correction','cash_out',80,'DEP-001-R','Corrected bank deposit',null,manager_user_id
) from sellertray_money_fixture;

select extensions.is(
  (select count(*)::integer
   from public.sellertray_cash_movement_classifications c
   join public.sellertray_shift_cash_movements m on m.tenant_id=c.tenant_id and m.id=c.movement_id
   where c.tenant_id=(select tenant_id from sellertray_money_fixture)
     and c.activity_classification='bank_deposit' and m.superseded_at is null),
  1,'Cash correction preserves Bank Deposit classification on the effective replacement'
);

select set_config('request.jwt.claim.sub',(select manager_user_id::text from sellertray_money_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
select extensions.is(
  (select (public.get_sellertray_business_expense_management_list(
    (select tenant_id from sellertray_money_fixture),(select branch_id from sellertray_money_fixture),'all',null,50,0
  )->>'totalAmount')::numeric),
  300::numeric,'Business Expense reporting excludes Bank Deposit, Owner Withdrawal and Cashier Expense'
);

do $$
begin
  begin
    update public.sellertray_business_expenses set amount=999
    where tenant_id=(select tenant_id from sellertray_money_fixture)
      and id=((select bank_expense_result->>'expenseId' from sellertray_money_fixture))::uuid;
  exception when sqlstate '55000' then
    update sellertray_money_fixture set immutable_expense_rejected=true;
  end;
end
$$;
select extensions.ok((select immutable_expense_rejected from sellertray_money_fixture),'Business Expense history is immutable');

select extensions.is(
  (select count(*)::integer from public.sellertray_shift_cash_movements m
   where m.tenant_id=(select tenant_id from sellertray_money_fixture)
     and m.shift_id=(select shift_id from sellertray_money_fixture)
     and m.superseded_at is null),
  4,'effective drawer ledger contains only the real cash effects, not bank-funded expense rows'
);

select * from extensions.finish();
rollback;