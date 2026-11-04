begin;

-- C2 native Branch obligations share the immutable obligation table but do
-- not use the C1 single Business subscription-line billing reader.
-- Keep both historical billing centers scoped to the C1 commercial_order type.
-- A dedicated Branch settlement read model will consume Branch obligations.
create or replace function public.get_sellertray_installment_billing_states_for_tenant(
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
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Installment billing access requires an Owner or Manager' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_installment_billing_state(p_tenant_id,o.id)
    order by o.created_at,o.id
  ),'[]'::jsonb)
  into v_result
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.obligation_scope='commercial_order';

  return v_result;
end;
$$;

create or replace function public.get_sellertray_installment_billing_states_for_admin(
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

  select coalesce(jsonb_agg(
    public.get_sellertray_installment_billing_state(p_tenant_id,o.id)
    order by o.created_at,o.id
  ),'[]'::jsonb)
  into v_result
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.obligation_scope='commercial_order';

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_installment_billing_states_for_tenant(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_billing_states_for_tenant(uuid,uuid)
  to service_role;

revoke all on function public.get_sellertray_installment_billing_states_for_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_billing_states_for_admin(uuid,uuid)
  to service_role;

commit;
