begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(1);

select extensions.ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'merchant_notifications'
      and policyname = 'merchant_notifications_member_read'
  ),
  'legacy tenant-wide merchant notification read policy is absent'
);

select * from extensions.finish();
rollback;
