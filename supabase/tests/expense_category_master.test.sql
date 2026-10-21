begin;
select plan(9);

select ok(
  to_regclass('public.sellertray_expense_categories') is not null,
  'Business Expense category master exists'
);
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.sellertray_expense_categories'::regclass),
  'Expense Category master has row-level security enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.sellertray_expense_categories', 'SELECT'),
  'authenticated clients cannot read the Expense Category table directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.sellertray_expense_categories', 'INSERT'),
  'authenticated clients cannot insert Expense Category rows directly'
);
select ok(
  to_regprocedure('public.get_sellertray_expense_category_list(uuid,boolean)') is not null,
  'governed Expense Category read RPC exists'
);
select ok(
  has_function_privilege('authenticated', 'public.get_sellertray_expense_category_list(uuid,boolean)', 'EXECUTE'),
  'authenticated members may use the governed Expense Category read RPC'
);
select ok(
  to_regprocedure('public.create_sellertray_expense_category(uuid,text)') is not null,
  'governed Expense Category create RPC exists'
);
select ok(
  has_function_privilege('authenticated', 'public.create_sellertray_expense_category(uuid,text)', 'EXECUTE'),
  'authenticated users reach Owner/Manager checks through the governed create RPC'
);
select ok(
  exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.sellertray_business_expenses'::regclass
      and t.tgname = 'enforce_sellertray_business_expense_category_master'
      and not t.tgisinternal
  ),
  'Business Expense inserts enforce the active Expense Category master'
);

select * from finish();
rollback;
