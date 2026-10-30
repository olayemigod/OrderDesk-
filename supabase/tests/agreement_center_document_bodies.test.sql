begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

select extensions.ok(
  position("'contentbody',v.content_body" in lower(pg_get_functiondef('public.get_sellertray_agreement_package_center(uuid,uuid)'::regprocedure))) > 0,
  'Agreement Center returns the immutable published Master Agreement body required for merchant review'
);

select extensions.ok(
  position("'renderedcontent',f.rendered_content" in lower(pg_get_functiondef('public.get_sellertray_agreement_package_center(uuid,uuid)'::regprocedure))) > 0,
  'Agreement Center returns the immutable rendered Order Form body required for package review'
);

select extensions.ok(
  position("coalesce(v_role,'') not in ('owner','manager')" in lower(pg_get_functiondef('public.get_sellertray_agreement_package_center(uuid,uuid)'::regprocedure))) > 0,
  'Agreement Center keeps the Business Owner/Manager access boundary while exposing document bodies'
);

select extensions.ok(
  position("sellertray_user_has_capability" in lower(pg_get_functiondef('public.get_sellertray_agreement_package_center(uuid,uuid)'::regprocedure))) > 0,
  'Agreement Center continues to derive acceptance authority from governed merchant capability'
);

select * from extensions.finish();
rollback;
