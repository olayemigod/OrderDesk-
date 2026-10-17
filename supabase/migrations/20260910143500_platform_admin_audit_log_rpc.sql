create or replace function public.platform_admin_audit_log(
  p_actor_user_id uuid,
  p_tenant_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_events jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id = p_actor_user_id;

  if v_role is null then
    raise exception 'Platform administrator access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select
      a.id,
      a.tenant_id as "tenantId",
      t.name as "tenantName",
      a.action,
      a.detail,
      a.created_at as "createdAt",
      coalesce(u.email, '') as "actorEmail"
    from public.platform_admin_audit a
    left join public.tenants t on t.id = a.tenant_id
    left join auth.users u on u.id = a.actor_user_id
    where p_tenant_id is null or a.tenant_id = p_tenant_id
    order by a.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object('events', v_events);
end;
$$;

revoke all on function public.platform_admin_audit_log(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.platform_admin_audit_log(uuid, uuid, integer) to service_role;
