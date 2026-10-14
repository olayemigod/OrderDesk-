begin;

-- Hosted QA previously skipped the historical purchasing foundation. The
-- tables/functions were restored through the tracked live migration with this
-- version. On a clean repository replay, the historical migration already
-- creates the schema, so this convergence only binds purchase reads to the
-- current shared branch authority.
create or replace function public.get_sellertray_purchase_orders(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_limit integer default 100
)
returns table(
  id uuid,
  reference text,
  status text,
  branch_id uuid,
  branch_name text,
  supplier_id uuid,
  supplier_name text,
  currency text,
  total_amount numeric,
  item_count bigint,
  expected_date date,
  created_at timestamptz,
  ordered_at timestamptz,
  received_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null then
    raise exception 'SellerTray business membership required' using errcode='42501';
  end if;

  if p_branch_id is not null
     and not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'SellerTray Branch access required' using errcode='42501';
  end if;

  if v_role='staff'
     and not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_receive_stock') then
    raise exception 'You do not have permission to receive stock' using errcode='42501';
  end if;

  return query
  select
    po.id,po.reference,po.status,po.branch_id,b.name,po.supplier_id,s.name,
    po.currency,po.total_amount,count(i.id),po.expected_date,po.created_at,
    po.ordered_at,po.received_at
  from public.sellertray_purchase_orders po
  join public.branches b
    on b.tenant_id=po.tenant_id and b.id=po.branch_id
  join public.sellertray_suppliers s
    on s.tenant_id=po.tenant_id and s.id=po.supplier_id
  left join public.sellertray_purchase_order_items i
    on i.tenant_id=po.tenant_id and i.purchase_order_id=po.id
  where po.tenant_id=p_tenant_id
    and (p_branch_id is null or po.branch_id=p_branch_id)
    and (
      v_role in ('owner','manager')
      or (
        po.status in ('ordered','partially_received')
        and public.sellertray_user_can_operate_branch(
          p_tenant_id,po.branch_id,v_user_id
        )
      )
    )
  group by po.id,b.name,s.name
  order by po.created_at desc,po.id desc
  limit greatest(1,least(coalesce(p_limit,100),500));
end;
$$;

revoke all on function public.get_sellertray_purchase_orders(uuid,uuid,integer)
  from public,anon;
grant execute on function public.get_sellertray_purchase_orders(uuid,uuid,integer)
  to authenticated;

commit;
