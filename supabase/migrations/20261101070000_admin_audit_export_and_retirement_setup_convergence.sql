-- Close the remaining PR #176 Admin review gaps without changing OA5/C2 sequence.
-- 1) Audit CSV export requires the distinct admin.audit.export capability.
-- 2) Business retirement releases active setup capacity while retaining setup history.

-- Keep the capability registry aligned with the governed Admin capability model.
-- This is deliberately additive: preserve the pre-existing OA2/OA4 capabilities while
-- registering the Admin read/action and audit capabilities introduced by this convergence.
alter table public.platform_admin_capability_grant_versions
  drop constraint if exists platform_admin_capability_code_check;
alter table public.platform_admin_capability_grant_versions
  add constraint platform_admin_capability_code_check check (
    capability_code in (
      'admin.pricing.manage',
      'admin.payments.reconcile',
      'admin.installments.manage',
      'admin.branch_setup.manage',
      'admin.agreements.publish',
      'admin.merchants.read',
      'admin.merchants.retire',
      'admin.merchants.act',
      'admin.payments.read',
      'admin.payments.act',
      'admin.audit.read',
      'admin.audit.export'
    )
  );

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

  -- Audit read remains available to the existing Admin/Support read personas.
  -- Export is a separate, higher-impact capability. Because the explorer can span
  -- multiple Businesses, export requires the platform-wide capability rather than
  -- inferring scope from a free-text Business filter.
  if coalesce(p_export, false)
     and not public.platform_admin_has_capability(
       p_actor_user_id,
       'admin.audit.export',
       null,
       now()
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
  'Service-only bounded ProcessEdge Admin audit explorer. CSV export additionally requires the platform-wide admin.audit.export capability.';

create or replace function public.retire_sellertray_tenant_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_reason text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_tenant public.tenants%rowtype;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_member_count integer:=0;
  v_branch_count integer:=0;
  v_invitation_count integer:=0;
  v_setup_appointments_cancelled integer:=0;
  v_setup_reschedules_withdrawn integer:=0;
  v_setup record;
begin
  if p_actor_user_id is null or p_tenant_id is null or p_command_id is null then
    raise exception 'Actor, Business and command id are required' using errcode='22023';
  end if;
  if v_reason is null or char_length(v_reason)<8 or char_length(v_reason)>500 then
    raise exception 'Retirement reason must be between 8 and 500 characters' using errcode='22023';
  end if;
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.merchants.retire',p_tenant_id,now()
  ) then
    raise exception 'Business retirement capability required' using errcode='42501';
  end if;

  select * into v_tenant
  from public.tenants t
  where t.id=p_tenant_id
  for update;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  if v_tenant.retired_at is not null then
    if v_tenant.retirement_command_id=p_command_id then
      return jsonb_build_object(
        'tenantId',v_tenant.id,'name',v_tenant.name,'retiredAt',v_tenant.retired_at,
        'alreadyRetired',true,'commandId',v_tenant.retirement_command_id
      );
    end if;
    raise exception 'Business is already retired' using errcode='55000';
  end if;

  if exists(
    select 1 from public.tenants t
    where t.retirement_command_id=p_command_id and t.id<>p_tenant_id
  ) then
    raise exception 'Retirement command id was already used' using errcode='23505';
  end if;

  select count(*)::integer into v_member_count
  from public.tenant_members tm where tm.tenant_id=p_tenant_id;
  select count(*)::integer into v_branch_count
  from public.branches b where b.tenant_id=p_tenant_id and b.is_active;
  select count(*)::integer into v_invitation_count
  from public.tenant_invitations i where i.tenant_id=p_tenant_id and i.status='pending';

  -- Release any live setup reservation before retiring the Business. Appointment
  -- rows are retained; one immutable cancellation event records the prior state.
  for v_setup in
    select a.id,a.tenant_id,a.commercial_order_id,a.branch_id,a.status
    from public.sellertray_commercial_setup_appointments a
    where a.tenant_id=p_tenant_id
      and a.status in ('scheduled','in_progress')
    order by a.id
    for update
  loop
    insert into public.sellertray_commercial_setup_appointment_events(
      appointment_id,tenant_id,commercial_order_id,branch_id,command_id,
      event_type,actor_user_id,actor_kind,reason,details
    )
    values(
      v_setup.id,v_setup.tenant_id,v_setup.commercial_order_id,v_setup.branch_id,gen_random_uuid(),
      'cancelled',p_actor_user_id,'platform','Business retired: '||v_reason,
      jsonb_build_object(
        'source','business_retirement',
        'retirementCommandId',p_command_id,
        'previousStatus',v_setup.status
      )
    );

    update public.sellertray_commercial_setup_appointments
    set status='cancelled',cancelled_at=coalesce(cancelled_at,now()),updated_at=now()
    where id=v_setup.id;

    v_setup_appointments_cancelled:=v_setup_appointments_cancelled+1;
  end loop;

  update public.sellertray_setup_reschedule_requests
  set status='withdrawn',
      resolved_by_user_id=p_actor_user_id,
      resolution_note='Business retired: '||v_reason,
      resolved_at=now()
  where tenant_id=p_tenant_id
    and status='pending';
  get diagnostics v_setup_reschedules_withdrawn = row_count;

  insert into public.sellertray_membership_events(
    tenant_id,event_type,subject_user_id,subject_email,previous_role,new_role,
    actor_user_id,actor_kind,reason,command_id,detail
  )
  select
    tm.tenant_id,'member_removed',tm.user_id,u.email,tm.role,null,
    p_actor_user_id,'platform_admin',v_reason,null,
    jsonb_build_object('source','business_retirement','retirementCommandId',p_command_id)
  from public.tenant_members tm
  left join auth.users u on u.id=tm.user_id
  where tm.tenant_id=p_tenant_id;

  insert into public.sellertray_membership_events(
    tenant_id,event_type,subject_email,invitation_id,actor_user_id,actor_kind,
    reason,command_id,detail
  )
  select
    i.tenant_id,'invitation_cancelled',i.email,i.id,p_actor_user_id,'platform_admin',
    v_reason,null,
    jsonb_build_object('source','business_retirement','retirementCommandId',p_command_id)
  from public.tenant_invitations i
  where i.tenant_id=p_tenant_id and i.status='pending';

  update public.tenant_invitations
  set status='cancelled',updated_at=now()
  where tenant_id=p_tenant_id and status='pending';

  delete from public.tenant_members where tenant_id=p_tenant_id;

  update public.branches
  set is_active=false,updated_at=now()
  where tenant_id=p_tenant_id and is_active;

  update public.tenant_subscriptions
  set status='cancelled',cancel_at_period_end=false,updated_at=now()
  where tenant_id=p_tenant_id and status<>'cancelled';

  update public.tenant_whatsapp_connections
  set connection_status='disconnected',webhook_subscription_status='unknown',
      updated_by_user_id=p_actor_user_id,updated_at=now()
  where tenant_id=p_tenant_id and connection_status<>'disconnected';

  update public.tenants
  set retired_at=now(),retirement_reason=v_reason,retired_by_user_id=p_actor_user_id,
      retirement_command_id=p_command_id,subscription_status='cancelled',
      whatsapp_connection_status='not_connected',updated_at=now()
  where id=p_tenant_id;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,p_tenant_id,'tenant_retired',
    jsonb_build_object(
      'reason',v_reason,'commandId',p_command_id,'businessName',v_tenant.name,
      'membersRevoked',v_member_count,'activeBranchesDeactivated',v_branch_count,
      'pendingInvitationsCancelled',v_invitation_count,
      'setupAppointmentsCancelled',v_setup_appointments_cancelled,
      'pendingSetupReschedulesWithdrawn',v_setup_reschedules_withdrawn,
      'commercialAndLegalHistoryPreserved',true,'authUsersPreserved',true,
      'setupHistoryPreserved',true
    )
  );

  return jsonb_build_object(
    'tenantId',p_tenant_id,'name',v_tenant.name,
    'retiredAt',(select retired_at from public.tenants where id=p_tenant_id),
    'membersRevoked',v_member_count,'activeBranchesDeactivated',v_branch_count,
    'pendingInvitationsCancelled',v_invitation_count,
    'setupAppointmentsCancelled',v_setup_appointments_cancelled,
    'pendingSetupReschedulesWithdrawn',v_setup_reschedules_withdrawn,
    'alreadyRetired',false,'commandId',p_command_id
  );
end;
$function$;

revoke execute on function public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid)
  to service_role;

comment on function public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid) is
  'Service-only governed Business retirement. Releases active setup reservations and preserves commercial, legal, setup and audit history.';
