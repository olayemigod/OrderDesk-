begin;
select plan(8);

select has_function('public','sellertray_report_center',array['uuid','integer'],'report center command exists');
select function_lang_is('public','sellertray_report_center',array['uuid','integer'],'plpgsql','report center remains a governed plpgsql command');
select function_returns('public','sellertray_report_center',array['uuid','integer'],'jsonb','report center retains its read model contract');

select ok(
  position('sellertray_user_has_capability' in pg_get_functiondef('public.sellertray_report_center(uuid,integer)'::regprocedure))>0,
  'report center delegates authority to the centralized capability evaluator'
);
select ok(
  position('can_view_reports' in pg_get_functiondef('public.sellertray_report_center(uuid,integer)'::regprocedure))>0,
  'report center requires can_view_reports'
);
select ok(
  position('owner' in lower(pg_get_functiondef('public.sellertray_report_center(uuid,integer)'::regprocedure)))=0,
  'report center no longer embeds Owner role authorization'
);
select ok(
  position('manager' in lower(pg_get_functiondef('public.sellertray_report_center(uuid,integer)'::regprocedure)))=0,
  'report center no longer embeds Manager role authorization'
);
select ok(
  has_function_privilege('authenticated','public.sellertray_report_center(uuid,integer)','EXECUTE'),
  'authenticated users may invoke the report command and are authorized inside it'
);

select * from finish();
rollback;
