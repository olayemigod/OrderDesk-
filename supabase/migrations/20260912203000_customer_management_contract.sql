-- SellerTray Phase 1 customer-management contract.
-- Customer WhatsApp identity/phone remains server-managed; merchant UI may only
-- edit safe profile metadata through the governed role-aware RPC.

create or replace function public.update_sellertray_customer_profile(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_display_name text,
  p_email text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_display_name,'')),'');
  v_email text := nullif(lower(btrim(coalesce(p_email,''))),'');
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_customer_id is null then
    raise exception 'Business and customer are required' using errcode='22023';
  end if;
  if v_name is not null and char_length(v_name)>120 then
    raise exception 'Customer name is too long' using errcode='22023';
  end if;
  if v_email is not null and (
    char_length(v_email)>254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'Customer email is invalid' using errcode='22023';
  end if;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Owner or Manager access is required to edit customers' using errcode='42501';
  end if;

  update public.customers c
  set display_name=v_name,
      email=v_email,
      updated_at=now()
  where c.id=p_customer_id and c.tenant_id=p_tenant_id;

  if not found then
    raise exception 'Customer not found' using errcode='P0002';
  end if;
end;
$$;

revoke update on table public.customers from authenticated;
revoke all on function public.update_sellertray_customer_profile(uuid,uuid,text,text)
  from public,anon;
grant execute on function public.update_sellertray_customer_profile(uuid,uuid,text,text)
  to authenticated,service_role;
