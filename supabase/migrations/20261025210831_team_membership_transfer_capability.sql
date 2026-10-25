-- Capability-gate SellerTray Business ownership transfer without rewriting the already-applied
-- membership-governance migration. Platform Admins retain current access through the existing
-- platform_admin_has_capability fallback while future explicit grants/denials and tenant scope
-- can govern this sensitive mutation.

create or replace function public.platform_admin_transfer_tenant_ownership(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_target_email text,
  p_reason text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_target_email text := lower(trim(coalesce(p_target_email, '')));
  target_user_id uuid;
  target_previous_role text;
  owner_count integer;
  previous_owners jsonb;
  existing_event record;
  result jsonb;
begin
  if p_command_id is null then
    raise exception 'command_id is required' using errcode = '22023';
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required for ownership transfer' using errcode = '22023';
  end if;

  if not public.platform_admin_has_capability(
    p_actor_user_id,
    'admin.merchant_ownership.transfer',
    p_tenant_id
  ) then
    raise exception 'Platform Admin ownership-transfer capability is required' using errcode = '42501';
  end if;

  perform 1 from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  select e.* into existing_event
  from public.sellertray_membership_events e
  where e.tenant_id = p_tenant_id
    and e.command_id = p_command_id
    and e.event_type = 'ownership_transferred'
  limit 1;

  if existing_event.id is not null then
    return existing_event.detail || jsonb_build_object(
      'eventId', existing_event.id,
      'commandId', p_command_id,
      'idempotent', true
    );
  end if;

  if normalized_target_email = '' or position('@' in normalized_target_email) <= 1 then
    raise exception 'A valid target email is required' using errcode = '22023';
  end if;

  select u.id into target_user_id
  from auth.users u
  where lower(u.email) = normalized_target_email
  limit 1;

  if target_user_id is null then
    raise exception 'Target SellerTray identity not found' using errcode = 'P0002';
  end if;

  select tm.role into target_previous_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', tm.user_id,
    'email', lower(u.email),
    'role', tm.role
  ) order by lower(u.email)), '[]'::jsonb)
  into previous_owners
  from public.tenant_members tm
  left join auth.users u on u.id = tm.user_id
  where tm.tenant_id = p_tenant_id and tm.role = 'owner';

  update public.tenant_members
  set role = 'manager'
  where tenant_id = p_tenant_id
    and role = 'owner'
    and user_id <> target_user_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (p_tenant_id, target_user_id, 'owner')
  on conflict (tenant_id, user_id)
  do update set role = excluded.role;

  select count(*) into owner_count
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.role = 'owner';

  if owner_count <> 1 then
    raise exception 'Ownership transfer did not converge to exactly one Owner' using errcode = '23514';
  end if;

  result := jsonb_build_object(
    'tenantId', p_tenant_id,
    'targetUserId', target_user_id,
    'targetEmail', normalized_target_email,
    'targetPreviousRole', target_previous_role,
    'previousOwners', previous_owners,
    'newOwnerCount', owner_count,
    'reason', trim(p_reason),
    'capability', 'admin.merchant_ownership.transfer'
  );

  insert into public.sellertray_membership_events (
    tenant_id,
    event_type,
    subject_user_id,
    subject_email,
    previous_role,
    new_role,
    actor_user_id,
    actor_kind,
    reason,
    command_id,
    detail
  ) values (
    p_tenant_id,
    'ownership_transferred',
    target_user_id,
    normalized_target_email,
    target_previous_role,
    'owner',
    p_actor_user_id,
    'platform_admin',
    trim(p_reason),
    p_command_id,
    result
  );

  insert into public.platform_admin_audit (
    actor_user_id,
    tenant_id,
    action,
    detail
  ) values (
    p_actor_user_id,
    p_tenant_id,
    'team.ownership_transfer',
    result || jsonb_build_object('commandId', p_command_id)
  );

  return result || jsonb_build_object('commandId', p_command_id, 'idempotent', false);
end;
$$;

revoke all on function public.platform_admin_transfer_tenant_ownership(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.platform_admin_transfer_tenant_ownership(uuid, uuid, text, text, uuid)
  to service_role;
