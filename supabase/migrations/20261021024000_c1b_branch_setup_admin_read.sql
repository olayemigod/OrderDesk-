begin;

-- Admin Web needs exact Branch-setup subjects, not only aggregate readiness
-- counts. Keep the persistence service-only and expose a governed projection
-- that is authorized from platform_admins.
create or replace function public.get_sellertray_commercial_branch_setup_states_for_admin(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_result jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and administrator are required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  if not exists (select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'commercialOrderId',s.commercial_order_id,
    'installmentObligationId',io.id,
    'lineNo',s.line_no,
    'branchId',s.branch_id,
    'branchCode',b.code,
    'branchName',b.name,
    'description',s.description_snapshot,
    'currency',s.currency,
    'grossAmount',s.gross_amount,
    'ready',r.id is not null,
    'readinessId',r.id,
    'readyAt',r.ready_at,
    'reason',r.reason,
    'recordedByUserId',r.recorded_by_user_id,
    'recordedAt',r.recorded_at
  ) order by o.ordered_at,o.id,s.line_no),'[]'::jsonb)
  into v_result
  from public.sellertray_commercial_order_price_snapshots s
  join public.sellertray_commercial_orders o
    on o.tenant_id=s.tenant_id and o.id=s.commercial_order_id
  join public.branches b
    on b.tenant_id=s.tenant_id and b.id=s.branch_id
  left join public.sellertray_commercial_installment_obligations io
    on io.tenant_id=s.tenant_id and io.commercial_order_id=s.commercial_order_id
  left join public.sellertray_commercial_branch_setup_readiness r
    on r.tenant_id=s.tenant_id
   and r.commercial_order_id=s.commercial_order_id
   and r.branch_id=s.branch_id
  where s.tenant_id=p_tenant_id
    and s.line_type='branch_setup';

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)
  to service_role;

commit;
