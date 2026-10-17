begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

select extensions.ok(
  to_regprocedure('public.update_sellertray_pos_draft_items(uuid,uuid,jsonb)') is not null,
  'POS draft edit command exists'
);
select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_sellertray_pos_draft_items'
      and lower(pg_get_functiondef(p.oid)) like '%catalogitemid%'
      and lower(pg_get_functiondef(p.oid)) like '%uomid%'
      and lower(pg_get_functiondef(p.oid)) like '%insert into public.order_items%'
  ),
  'resumed POS draft command can add governed Product and Unit lines'
);
select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_sellertray_pos_draft_items'
      and lower(pg_get_functiondef(p.oid)) like '%submit each current draft item exactly once%'
  ),
  'existing draft lines must still be submitted exactly once'
);
select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_sellertray_pos_draft_items'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_orders%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'resumed POS draft additions preserve subscription, Branch and order capability authority'
);
select extensions.ok(
  has_function_privilege('authenticated','public.update_sellertray_pos_draft_items(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.update_sellertray_pos_draft_items(uuid,uuid,jsonb)','EXECUTE'),
  'draft edit command remains authenticated-only'
);

select * from extensions.finish();
rollback;
