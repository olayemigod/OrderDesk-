begin;

create or replace function public.platform_admin_setup_scheduling_center(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'canManage',true,
    'canManagePlatformMasters',public.platform_admin_has_capability(
      p_actor_user_id,'admin.branch_setup.manage',null,now()
    ),
    'serviceAreas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'code',a.code,'name',a.name,'active',a.active
      ) order by a.name)
      from public.sellertray_setup_service_areas a
    ),'[]'::jsonb),
    'workers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',w.id,
        'code',w.worker_code,
        'name',w.display_name,
        'active',w.active,
        'maxConcurrentSetups',w.max_concurrent_setups,
        'travelBufferMinutes',w.travel_buffer_minutes,
        'serviceAreaIds',coalesce((
          select jsonb_agg(c.service_area_id order by c.service_area_id)
          from public.sellertray_setup_worker_service_areas c
          where c.worker_id=w.id
        ),'[]'::jsonb)
      ) order by w.display_name)
      from public.sellertray_setup_workers w
    ),'[]'::jsonb),
    'branchAreas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'branchId',b.id,
        'branchCode',b.code,
        'branchName',b.name,
        'serviceAreaId',ba.service_area_id
      ) order by b.name)
      from public.branches b
      left join public.sellertray_setup_branch_service_areas ba
        on ba.tenant_id=b.tenant_id and ba.branch_id=b.id
      where b.tenant_id=p_tenant_id and b.is_active
    ),'[]'::jsonb),
    'appointments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'commercialOrderId',a.commercial_order_id,
        'branchId',a.branch_id,
        'branchName',b.name,
        'workerId',a.worker_id,
        'workerName',w.display_name,
        'serviceAreaId',a.service_area_id,
        'serviceAreaName',sa.name,
        'scheduledStartAt',a.scheduled_start_at,
        'scheduledEndAt',a.scheduled_end_at,
        'status',a.status,
        'merchantNote',a.merchant_note,
        'internalNote',a.internal_note,
        'createdAt',a.created_at,
        'completedAt',a.completed_at
      ) order by a.scheduled_start_at desc)
      from public.sellertray_commercial_setup_appointments a
      join public.branches b on b.id=a.branch_id
      join public.sellertray_setup_workers w on w.id=a.worker_id
      join public.sellertray_setup_service_areas sa on sa.id=a.service_area_id
      where a.tenant_id=p_tenant_id
    ),'[]'::jsonb),
    'pendingRequests',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,
        'appointmentId',r.appointment_id,
        'branchId',r.branch_id,
        'requestedStartAt',r.requested_start_at,
        'requestedEndAt',r.requested_end_at,
        'merchantNote',r.merchant_note,
        'requestedAt',r.requested_at,
        'requestedByUserId',r.requested_by_user_id
      ) order by r.requested_at)
      from public.sellertray_setup_reschedule_requests r
      where r.tenant_id=p_tenant_id and r.status='pending'
    ),'[]'::jsonb),
    'setupSubjects',coalesce((
      select jsonb_agg(jsonb_build_object(
        'commercialOrderId',s.commercial_order_id,
        'branchId',s.branch_id,
        'branchCode',b.code,
        'branchName',b.name,
        'ready',rr.id is not null,
        'readyAt',rr.ready_at,
        'serviceAreaId',ba.service_area_id
      ) order by s.line_no)
      from public.sellertray_commercial_order_price_snapshots s
      join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
      left join public.sellertray_commercial_branch_setup_readiness rr
        on rr.tenant_id=s.tenant_id
       and rr.commercial_order_id=s.commercial_order_id
       and rr.branch_id=s.branch_id
      left join public.sellertray_setup_branch_service_areas ba
        on ba.tenant_id=s.tenant_id and ba.branch_id=s.branch_id
      where s.tenant_id=p_tenant_id and s.line_type='branch_setup'
    ),'[]'::jsonb),
    'generatedAt',now()
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.platform_admin_setup_scheduling_center(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_admin_setup_scheduling_center(uuid,uuid) to service_role;

comment on function public.platform_admin_setup_scheduling_center(uuid,uuid)
  is 'OA3 Admin scheduling projection. Tenant-scoped setup managers can schedule their Business; canManagePlatformMasters separately indicates ProcessEdge-global workforce/service-area edit authority.';

commit;
