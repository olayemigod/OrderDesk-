begin;

create or replace function public.get_sellertray_whatsapp_management_route(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_connection public.tenant_whatsapp_connections%rowtype;
  v_branch_name text;
  v_branch_code text;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Only business Owners and Managers can review WhatsApp routing' using errcode='42501';
  end if;

  select * into v_connection
  from public.tenant_whatsapp_connections c
  where c.tenant_id=p_tenant_id
  limit 1;

  if not found then return null; end if;

  select b.name,b.code into v_branch_name,v_branch_code
  from public.branches b
  where b.tenant_id=p_tenant_id and b.id=v_connection.branch_id;

  return jsonb_build_object(
    'connectionId',v_connection.id,
    'connectionStatus',v_connection.connection_status,
    'branchId',v_connection.branch_id,
    'branchName',v_branch_name,
    'branchCode',v_branch_code,
    'displayPhoneNumber',v_connection.display_phone_number,
    'verifiedName',v_connection.verified_name,
    'connectedAt',v_connection.connected_at,
    'lastVerifiedAt',v_connection.last_verified_at,
    'updatedAt',v_connection.updated_at
  );
end;
$$;

revoke all on function public.get_sellertray_whatsapp_management_route(uuid)
  from public,anon;
grant execute on function public.get_sellertray_whatsapp_management_route(uuid)
  to authenticated;

commit;
