begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid='public.order_items'::regclass
      and tgname='guard_invoiced_order_items'
      and not tgisinternal
  ),
  'order item lifecycle guard remains attached to all line-item mutations'
);

select extensions.ok(
  position('v_order.status in (''draft'',''needs_review'')' in pg_get_functiondef(
    'public.guard_invoiced_order_items()'::regprocedure
  )) > 0
  and position('v_order.status = ''accepted''' in pg_get_functiondef(
    'public.guard_invoiced_order_items()'::regprocedure
  )) > 0,
  'draft/review editing and explicit accepted-unpaid amendment path are preserved'
);

select extensions.ok(
  position('amount_paid' in pg_get_functiondef('public.guard_invoiced_order_items()'::regprocedure)) > 0
  and position('fulfillment_status' in pg_get_functiondef('public.guard_invoiced_order_items()'::regprocedure)) > 0
  and position('pending_verification' in pg_get_functiondef('public.guard_invoiced_order_items()'::regprocedure)) > 0
  and position('confirmed' in pg_get_functiondef('public.guard_invoiced_order_items()'::regprocedure)) > 0,
  'accepted order amendments remain gated by payment and fulfilment state'
);

select extensions.ok(
  position('v_has_invoice' in pg_get_functiondef('public.guard_invoiced_order_items()'::regprocedure)) = 0
  and position('cannot be changed after processing, completion, cancellation, or rejection' in pg_get_functiondef(
    'public.guard_invoiced_order_items()'::regprocedure
  )) > 0,
  'line-item integrity no longer depends on invoice existence and post-acceptance terminal states are immutable'
);

select * from extensions.finish();
rollback;
