begin;

-- Legacy tests/imports may insert historical return rows directly. Before the
-- receivable-first authority existed, a populated original_payment_id meant a
-- paid return/refund; a missing payment reference meant an unpaid reversal.
-- Normalize only rows that do not already carry an explicit settlement split.
create or replace function public.normalize_sale_return_settlement_compatibility()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if coalesce(new.amount,0)>0
     and coalesce(new.receivable_reduction,0)=0
     and coalesce(new.refund_amount,0)=0 then
    if new.original_payment_id is null then
      new.receivable_reduction:=new.amount;
      new.refund_amount:=0;
    else
      new.receivable_reduction:=0;
      new.refund_amount:=new.amount;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_sale_return_settlement_compatibility()
  from public,anon,authenticated,service_role;

drop trigger if exists normalize_sale_return_settlement_compatibility on public.sale_returns;
create trigger normalize_sale_return_settlement_compatibility
before insert on public.sale_returns
for each row execute function public.normalize_sale_return_settlement_compatibility();

-- Preserve the legacy response aliases used by tax/receipt callers while the
-- modern command exposes clearer returnedSubtotal/returnedTax terminology.
create or replace function public.return_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_items jsonb,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  v_result:=public.return_sellertray_pos_sale(
    p_tenant_id,p_order_id,p_actor_user_id,p_reason,p_items,p_command_id,'cash'
  );
  return v_result||jsonb_build_object(
    'refundedSubtotal',v_result->'returnedSubtotal',
    'refundedTax',v_result->'returnedTax'
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text,jsonb,text)
  to service_role;

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
  v_branch_id uuid;
  v_result jsonb;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Business, sale and operator are required' using errcode='22023';
  end if;
  select o.branch_id into v_branch_id
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id;
  if not found or v_branch_id is null then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to return sales from this Branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_refund_sale') then
    raise exception 'You do not have permission to complete sale returns' using errcode='42501';
  end if;

  v_result:=public.apply_sellertray_pos_cash_return_internal(
    p_tenant_id,p_order_id,p_actor_user_id,p_reason
  );
  return v_result||jsonb_build_object(
    'refundedSubtotal',v_result->'returnedSubtotal',
    'refundedTax',v_result->'returnedTax'
  );
end;
$$;

revoke all on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.return_sellertray_pos_cash_sale(uuid,uuid,uuid,text)
  to service_role;

commit;
