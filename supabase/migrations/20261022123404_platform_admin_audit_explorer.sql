-- Additive read model; legacy feed and immutable audit records are unchanged.
create index if not exists platform_admin_audit_explorer_created_idx on public.platform_admin_audit (created_at desc, id desc);
create index if not exists platform_admin_audit_explorer_tenant_idx on public.platform_admin_audit (tenant_id, created_at desc, id desc);
create index if not exists platform_admin_audit_explorer_action_idx on public.platform_admin_audit (action, created_at desc, id desc);

create or replace function public.platform_admin_audit_explorer(
  p_actor_user_id uuid, p_tenant_id uuid default null,
  p_event text default null, p_actor text default null, p_search text default null,
  p_from timestamptz default null, p_to timestamptz default null,
  p_after_created_at timestamptz default null, p_after_id uuid default null,
  p_limit integer default 50, p_export boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := case when coalesce(p_export, false) then 1000 else least(100, greatest(1, coalesce(p_limit, 50))) end;
  v_rows jsonb;
  v_items jsonb;
  v_last jsonb;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_actor_user_id and role in ('admin', 'support')) then
    raise exception 'Platform administrator access required' using errcode = '42501';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) or (p_from is not null and p_to is not null and p_from >= p_to)
     or char_length(p_event) > 120 or char_length(p_actor) > 254 or char_length(p_search) > 200 then
    raise exception 'Invalid audit filters or cursor' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt" desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select a.id, a.tenant_id as "tenantId", t.name as "tenantName", a.action, a.detail,
      a.created_at as "createdAt", a.actor_user_id as "actorUserId", coalesce(u.email, '') as "actorEmail"
    from public.platform_admin_audit a
    left join public.tenants t on t.id = a.tenant_id
    left join auth.users u on u.id = a.actor_user_id
    where (p_tenant_id is null or a.tenant_id = p_tenant_id)
      and (nullif(btrim(p_event), '') is null or a.action = btrim(p_event))
      and (nullif(btrim(p_actor), '') is null or strpos(lower(coalesce(u.email, '') || ' ' || a.actor_user_id::text), lower(btrim(p_actor))) > 0)
      and (nullif(btrim(p_search), '') is null or strpos(lower(a.action || ' ' || coalesce(t.name, '') || ' ' || coalesce(a.tenant_id::text, '') || ' ' || coalesce(u.email, '') || ' ' || a.detail::text), lower(btrim(p_search))) > 0)
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
      and (coalesce(p_export, false) or p_after_created_at is null or (a.created_at, a.id) < (p_after_created_at, p_after_id))
    order by a.created_at desc, a.id desc limit v_limit + 1
  ) x;
  select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) into v_items
    from jsonb_array_elements(v_rows) with ordinality where ordinality <= v_limit;
  v_last := v_items -> (jsonb_array_length(v_items) - 1);
  return jsonb_build_object('items', v_items, 'hasMore', jsonb_array_length(v_rows) > v_limit,
    'nextCursor', case when not coalesce(p_export, false) and jsonb_array_length(v_rows) > v_limit then
      jsonb_build_object('afterCreatedAt', v_last->>'createdAt', 'afterId', v_last->>'id') else null end,
    'limit', v_limit);
end;
$$;
revoke all on function public.platform_admin_audit_explorer(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,boolean) from public, anon, authenticated;
grant execute on function public.platform_admin_audit_explorer(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,boolean) to service_role;
