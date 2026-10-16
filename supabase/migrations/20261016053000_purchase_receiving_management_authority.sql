begin;

create or replace function public.get_sellertray_purchase_receiving_authority(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_tenant_id is null or p_branch_id is null then
    return false;
  end if;

  return public.orderdesk_subscription_can_write(p_tenant_id)
    and public.sellertray_purchase_management_role(p_tenant_id,v_user_id)
    and public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id);
end;
$$;

revoke all on function public.get_sellertray_purchase_receiving_authority(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_purchase_receiving_authority(uuid,uuid)
  to authenticated;

create or replace function public.enforce_sellertray_purchase_receipt_management()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  -- Trusted service-role/database maintenance has no end-user auth.uid().
  -- Authenticated SellerTray purchase receiving must always be management-controlled.
  if v_user_id is not null
     and not public.sellertray_purchase_management_role(new.tenant_id,v_user_id) then
    raise exception 'Purchase Receiving is available to business management only' using errcode='42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_sellertray_purchase_receipt_management()
  from public,anon,authenticated;
grant execute on function public.enforce_sellertray_purchase_receipt_management()
  to service_role;

drop trigger if exists sellertray_purchase_receipts_management_guard
  on public.sellertray_purchase_receipts;
create trigger sellertray_purchase_receipts_management_guard
before insert on public.sellertray_purchase_receipts
for each row execute function public.enforce_sellertray_purchase_receipt_management();

commit;
