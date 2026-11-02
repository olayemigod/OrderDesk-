begin;

select plan(3);

select ok(
  has_table_privilege('service_role', 'public.sellertray_agreement_package_processing', 'SELECT'),
  'service_role can read internal agreement package processing state'
);

select ok(
  not has_table_privilege('authenticated', 'public.sellertray_agreement_package_processing', 'SELECT'),
  'authenticated clients cannot read internal agreement package processing state'
);

select ok(
  not has_table_privilege('anon', 'public.sellertray_agreement_package_processing', 'SELECT'),
  'anonymous clients cannot read internal agreement package processing state'
);

select * from finish();
rollback;
