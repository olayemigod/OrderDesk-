begin;

-- PR #176 OA5 pre-C2 review convergence.
-- 1. Honor explicit admin.audit.read assignments without silently removing the
--    existing Admin/Support read workflow while capability migration is in flight.
-- 2. Serialize new setup reservations against Business retirement and reject
--    retired Businesses without making Branch activation a setup prerequisite.

create or replace function public.platform_admin_audit_explorer(
  p_actor_user_id uuid,
  p_business text default null,
  p_event text default null,
  p_actor text default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50,
  p_export boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_as_of timestamptz := now();
  v_has_read_assignment boolean := false;
  v_limit integer := case
    when coalesce(p_export, false) then 1000
    else least(100, greatest(1, coalesce(p_limit, 50)))
  end;
  v_rows jsonb;
  v_items jsonb;
  v_last jsonb;
begin
  if not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = p_actor_user_id
      and pa.role in ('admin', 'support')
  ) then
    raise exception 'Platform administrator access required' using errcode = '42501';
  end if;

  -- Preserve the existing Admin/Support audit-read workflow only while no
  -- explicit platform-scoped admin.audit.read assignment exists. Once an
  -- effective assignment exists, the canonical capability resolver is
  -- authoritative, so an explicit denial fails closed.
  select exists (
    select 1
    from public.platform_admin_capability_grant_versions g
    where g.grantee_user_id = p_actor_user_id
      and g.capability_code = 'admin.audit.read'
      and g.scope_kind = 'platform'
      and g.effective_from <= v_as_of
      and (g.effective_until is null or g.effective_until > v_as_of)
  )
  into v_has_read_assignment;

  if v_has_read_assignment
     and not public.platform_admin_has_capability(
       p_actor_user_id,
       'admin.audit.read',
       null,
       v_as_of
     ) then
    raise exception 'Audit read capability required' using errcode = '42501';
  end if;

  -- Export is intentionally separate from read authority.
  if coalesce(p_export, false)
     and not public.platform_admin_has_capability(
       p_actor_user_id,
       'admin.audit.export',
       null,
       v_as_of
     ) then
    raise exception 'Audit export capability required' using errcode = '42501';
  end if;

  if (p_after_created_at is null) <> (p_after_id is null)
     or (p_from is not null and p_to is not null and p_from >= p_to)
     or char_length(p_business) > 200
     or char_length(p_event) > 120
     or char_length(p_actor) > 254
     or char_length(p_search) > 200 then
    raise exception 'Invalid audit filters or cursor' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x."createdAt" desc, x.id desc),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      a.id,
      a.tenant_id as "tenantId",
      t.name as "tenantName",
      a.action,
      a.detail,
      a.created_at as "createdAt",
      a.actor_user_id as "actorUserId",
      coalesce(u.email, '') as "actorEmail"
    from public.platform_admin_audit a
    left join public.tenants t on t.id = a.tenant_id
    left join auth.users u on u.id = a.actor_user_id
    where (
        nullif(btrim(p_business), '') is null
        or strpos(
          lower(coalesce(t.name, '') || ' ' || coalesce(a.tenant_id::text, '')),
          lower(btrim(p_business))
        ) > 0
      )
      and (nullif(btrim(p_event), '') is null or a.action = btrim(p_event))
      and (
        nullif(btrim(p_actor), '') is null
        or strpos(
          lower(coalesce(u.email, '') || ' ' || a.actor_user_id::text),
          lower(btrim(p_actor))
        ) > 0
      )
      and (
        nullif(btrim(p_search), '') is null
        or strpos(
          lower(
            a.action || ' ' ||
            coalesce(t.name, '') || ' ' ||
            coalesce(a.tenant_id::text, '') || ' ' ||
            coalesce(u.email, '') || ' ' ||
            a.actor_user_id::text || ' ' ||
            a.detail::text
          ),
          lower(btrim(p_search))
        ) > 0
      )
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
      and (
        coalesce(p_export, false)
        or p_after_created_at is null
        or (a.created_at, a.id) < (p_after_created_at, p_after_id)
      )
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ) x;

  select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(v_rows) with ordinality
  where ordinality <= v_limit;

  v_last := v_items -> (jsonb_array_length(v_items) - 1);

  return jsonb_build_object(
    'items', v_items,
    'hasMore', jsonb_array_length(v_rows) > v_limit,
    'nextCursor', case
      when not coalesce(p_export, false) and jsonb_array_length(v_rows) > v_limit then
        jsonb_build_object(
          'afterCreatedAt', v_last->>'createdAt',
          'afterId', v_last->>'id'
        )
      else null
    end,
    'limit', v_limit,
    'generatedAt', now()
  );
end;
$function$;

revoke all on function public.platform_admin_audit_explorer(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,boolean)
  from public, anon, authenticated;
grant execute on function public.platform_admin_audit_explorer(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,boolean)
  to service_role;

comment on function public.platform_admin_audit_explorer(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,boolean) is
  'Service-only bounded ProcessEdge Admin audit explorer. Existing Admin/Support reads remain compatible only when no explicit platform admin.audit.read assignment exists; explicit denial fails closed. CSV export separately requires admin.audit.export.';

-- Keep assert_sellertray_setup_subject unchanged: purchased setup may legitimately
-- precede Branch activation, and existing readiness-command replay must not become
-- dependent on current Business lifecycle state. The new-reservation guard belongs
-- in platform_admin_schedule_branch_setup, where it can share the retirement lock.

create or replace function public.platform_admin_schedule_branch_setup(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid,
  p_worker_id uuid,
  p_service_area_id uuid,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_merchant_note text,
  p_internal_note text,
  p_command_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_worker public.sellertray_setup_workers%rowtype;
  v_existing_event public.sellertray_commercial_setup_appointment_events%rowtype;
  v_appointment_id uuid;
  v_retired_at timestamptz;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_merchant_note text:=nullif(btrim(coalesce(p_merchant_note,'')),'');
  v_internal_note text:=nullif(btrim(coalesce(p_internal_note,'')),'');
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;
  if p_command_id is null or char_length(v_reason)<6 then
    raise exception 'Scheduling command and reason are required' using errcode='22023';
  end if;

  -- Preserve idempotent replay before lifecycle validation. Replaying a command
  -- that already created a reservation does not create new capacity after
  -- retirement and therefore does not need to reacquire setup eligibility.
  select e.*
  into v_existing_event
  from public.sellertray_commercial_setup_appointment_events e
  where e.command_id=p_command_id;

  if found then
    if v_existing_event.event_type<>'scheduled'
       or v_existing_event.tenant_id<>p_tenant_id
       or v_existing_event.commercial_order_id<>p_commercial_order_id
       or v_existing_event.branch_id<>p_branch_id then
      raise exception 'Setup scheduling command is already used for different facts' using errcode='23505';
    end if;
    return v_existing_event.appointment_id;
  end if;

  -- Retirement takes the same tenants row lock before cancelling reservations.
  -- This lock therefore serializes a new reservation with retirement:
  -- scheduling first => retirement subsequently cancels it;
  -- retirement first => scheduling observes retired_at and fails.
  select t.retired_at
  into v_retired_at
  from public.tenants t
  where t.id=p_tenant_id
  for update;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;
  if v_retired_at is not null then
    raise exception 'Retired Businesses cannot receive setup reservations' using errcode='23514';
  end if;

  perform public.assert_sellertray_setup_subject(
    p_tenant_id,
    p_commercial_order_id,
    p_branch_id
  );

  if exists(
    select 1
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id
      and r.commercial_order_id=p_commercial_order_id
      and r.branch_id=p_branch_id
  ) then
    raise exception 'Completed Branch setup cannot be scheduled again' using errcode='23514';
  end if;

  if not exists(
    select 1
    from public.sellertray_setup_branch_service_areas a
    where a.tenant_id=p_tenant_id
      and a.branch_id=p_branch_id
      and a.service_area_id=p_service_area_id
  ) then
    raise exception 'Branch is not assigned to the selected setup service area' using errcode='23514';
  end if;

  if exists(
    select 1
    from public.sellertray_commercial_setup_appointments a
    where a.tenant_id=p_tenant_id
      and a.commercial_order_id=p_commercial_order_id
      and a.branch_id=p_branch_id
      and a.status in ('scheduled','in_progress')
  ) then
    raise exception 'Branch setup already has an active appointment' using errcode='23505';
  end if;

  perform public.assert_sellertray_setup_capacity(
    p_worker_id,
    p_service_area_id,
    p_scheduled_start_at,
    p_scheduled_end_at,
    null
  );
  select w.*
  into strict v_worker
  from public.sellertray_setup_workers w
  where w.id=p_worker_id;

  insert into public.sellertray_commercial_setup_appointments(
    tenant_id,
    commercial_order_id,
    branch_id,
    worker_id,
    service_area_id,
    scheduled_start_at,
    scheduled_end_at,
    travel_buffer_minutes_snapshot,
    status,
    merchant_note,
    internal_note,
    created_by_user_id
  ) values (
    p_tenant_id,
    p_commercial_order_id,
    p_branch_id,
    p_worker_id,
    p_service_area_id,
    p_scheduled_start_at,
    p_scheduled_end_at,
    v_worker.travel_buffer_minutes,
    'scheduled',
    v_merchant_note,
    v_internal_note,
    p_actor_user_id
  )
  returning id into v_appointment_id;

  insert into public.sellertray_commercial_setup_appointment_events(
    appointment_id,
    tenant_id,
    commercial_order_id,
    branch_id,
    command_id,
    event_type,
    actor_user_id,
    actor_kind,
    reason,
    details
  ) values (
    v_appointment_id,
    p_tenant_id,
    p_commercial_order_id,
    p_branch_id,
    p_command_id,
    'scheduled',
    p_actor_user_id,
    'platform',
    v_reason,
    jsonb_build_object(
      'workerId',p_worker_id,
      'serviceAreaId',p_service_area_id,
      'scheduledStartAt',p_scheduled_start_at,
      'scheduledEndAt',p_scheduled_end_at,
      'merchantNote',v_merchant_note
    )
  );

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,
    p_tenant_id,
    'branch_setup_scheduled',
    jsonb_build_object(
      'appointmentId',v_appointment_id,
      'commercialOrderId',p_commercial_order_id,
      'branchId',p_branch_id,
      'commandId',p_command_id
    )
  );

  return v_appointment_id;
end;
$function$;

revoke all on function public.platform_admin_schedule_branch_setup(
  uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,text
) from public, anon, authenticated;
grant execute on function public.platform_admin_schedule_branch_setup(
  uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,text
) to service_role;

comment on function public.platform_admin_schedule_branch_setup(
  uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,uuid,text
) is
  'Service-only ProcessEdge setup scheduling authority. New reservations serialize on the Business row shared with retirement and reject retired Businesses while preserving idempotent command replay.';

commit;
