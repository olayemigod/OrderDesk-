begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(2);

select extensions.ok(
  position('for update' in lower(pg_get_functiondef('public.guard_sellertray_profile_grant_mutation()'::regprocedure)))>0,
  'Entitlement grant mutation locks parent versions before checking draft status'
);

select extensions.ok(
  position('order by v.id' in lower(pg_get_functiondef('public.guard_sellertray_profile_grant_mutation()'::regprocedure)))>0,
  'Entitlement grant parent locks are acquired in deterministic order when a grant moves between drafts'
);

select * from extensions.finish();
rollback;
