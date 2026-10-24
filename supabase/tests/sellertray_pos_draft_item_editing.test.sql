begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

select extensions.ok(
  to_regprocedure('public.update_sellertray_pos_draft_items(uuid,uuid,jsonb)') is not null,
  'governed POS draft item edit command exists'
);

select extensions.ok(
  has_function_privilege('authenticated','public.update_sellertray_pos_draft_items(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.update_sellertray_pos_draft_items(uuid,uuid,jsonb)','EXECUTE'),
  'signed-in merchants can call the draft edit command and anonymous callers cannot'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_sellertray_pos_draft_items'
      and p.prosecdef=true
      and lower(pg_get_functiondef(p.oid)) like '%auth.uid%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
  ),
  'draft editing binds the current actor and respects subscription write access'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_sellertray_pos_draft_items'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_operate_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_orders%'
  ),
  'draft editing requires Branch operating access and Manage orders capability'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_sellertray_pos_draft_items'
      and lower(pg_get_functiondef(p.oid)) like '%source<>''pos''%'
      and lower(pg_get_functiondef(p.oid)) like '%status<>''draft''%'
      and lower(pg_get_functiondef(p.oid)) like '%payment_status<>''unpaid''%'
  ),
  'only unpaid POS drafts can be edited'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_sellertray_pos_draft_items'
      and lower(pg_get_functiondef(p.oid)) like '%order_payments%'
      and lower(pg_get_functiondef(p.oid)) like '%order_financial_documents%'
      and lower(pg_get_functiondef(p.oid)) like '%inventory_movements%'
  ),
  'payment, financial-document or stock activity freezes order-line editing'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_sellertray_pos_draft_items'
      and lower(pg_get_functiondef(p.oid)) like '%catalog_item_uoms%'
      and lower(pg_get_functiondef(p.oid)) like '%selling_price%'
      and lower(pg_get_functiondef(p.oid)) like '%conversion_factor%'
      and lower(pg_get_functiondef(p.oid)) like '%allow_fractional%'
  ),
  'draft editing revalidates current selling UOM, price, conversion and fractional policy'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='update_sellertray_pos_draft_items'
      and lower(pg_get_functiondef(p.oid)) like '%submit each current draft item exactly once%'
      and lower(pg_get_functiondef(p.oid)) like '%a draft sale must keep at least one item%'
  ),
  'draft editing cannot omit unknown current lines or remove the whole sale silently'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='audit_sellertray_order_item_commercial_change'
      and lower(pg_get_functiondef(p.oid)) like '%selected_uom%'
      and lower(pg_get_functiondef(p.oid)) like '%conversion_factor%'
      and lower(pg_get_functiondef(p.oid)) like '%stock_quantity%'
  ),
  'commercial order-line audit snapshots UOM and Stock UOM consequences'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='audit_sellertray_order_item_commercial_change'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_current_audit_actor%'
      and lower(pg_get_functiondef(p.oid)) like '%order_item_updated%'
  ),
  'order-line edit audit preserves governed actor attribution and update history'
);

select * from extensions.finish();
rollback;
