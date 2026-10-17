update public.subscription_plans
set name = 'SellerTray Business',
    updated_at = now()
where code = 'business'
  and name is distinct from 'SellerTray Business';

create or replace function public.guard_orderdesk_subscription_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  if not public.orderdesk_subscription_can_write(v_tenant_id) then
    raise exception 'SellerTray subscription is read-only. Renew or reactivate the business to make changes.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.list_orderdesk_team(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  members_json jsonb;
  invitations_json jsonb := '[]'::jsonb;
begin
  select tm.role into actor_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = p_actor_user_id;

  if actor_role is null then
    raise exception 'You are not a member of this SellerTray business'
      using errcode = '42501';
  end if;

  update public.tenant_invitations ti
  set status = 'expired',
      updated_at = now()
  where ti.tenant_id = p_tenant_id
    and ti.status = 'pending'
    and ti.expires_at <= now();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId', x.user_id,
        'email', x.email,
        'role', x.role,
        'joinedAt', x.created_at
      )
      order by case x.role when 'owner' then 1 when 'manager' then 2 else 3 end, x.created_at
    ),
    '[]'::jsonb
  )
  into members_json
  from (
    select tm.user_id, coalesce(u.email, '') as email, tm.role, tm.created_at
    from public.tenant_members tm
    left join auth.users u on u.id = tm.user_id
    where tm.tenant_id = p_tenant_id
  ) x;

  if actor_role in ('owner', 'manager') then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'email', x.email,
          'role', x.role,
          'status', x.status,
          'expiresAt', x.expires_at,
          'createdAt', x.created_at
        )
        order by x.created_at desc
      ),
      '[]'::jsonb
    )
    into invitations_json
    from (
      select ti.id, ti.email, ti.role, ti.status, ti.expires_at, ti.created_at
      from public.tenant_invitations ti
      where ti.tenant_id = p_tenant_id
        and ti.status = 'pending'
    ) x;
  end if;

  return jsonb_build_object(
    'actorRole', actor_role,
    'members', members_json,
    'invitations', invitations_json
  );
end;
$$;
