begin;

-- The original four-argument return RPC predated partial-item and receivable-aware
-- settlement. Keep it only as a compatibility adapter so no caller can bypass the
-- governed return authority or its Manager/Owner monetary-refund rule.
create or replace function public.return_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_items jsonb;
  v_command_id text;
begin
  select jsonb_agg(jsonb_build_object(
    'orderItemId',oi.id,
    'quantity',greatest(oi.quantity-coalesce(x.returned_quantity,0),0)
  ) order by oi.id)
  into v_items
  from public.order_items oi
  left join lateral (
    select coalesce(sum(sri.quantity),0)::numeric(18,6) returned_quantity
    from public.sale_return_items sri
    where sri.tenant_id=oi.tenant_id and sri.order_item_id=oi.id
  ) x on true
  where oi.tenant_id=p_tenant_id
    and oi.order_id=p_order_id
    and oi.quantity-coalesce(x.returned_quantity,0)>0;

  if v_items is null or jsonb_array_length(v_items)=0 then
    raise exception 'This counter sale has no remaining returnable quantity' using errcode='23514';
  end if;

  v_command_id:='legacy-return:'||p_order_id::text||':'||
    pg_catalog.md5(pg_catalog.concat_ws('|',p_actor_user_id::text,coalesce(p_reason,''),clock_timestamp()::text));

  return public.return_sellertray_pos_sale(
    p_tenant_id,
    p_order_id,
    p_actor_user_id,
    p_reason,
    v_items,
    v_command_id,
    'cash',
    null
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  to service_role;

commit;
