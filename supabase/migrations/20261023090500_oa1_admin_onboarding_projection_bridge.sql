begin;

-- Keep ProcessEdge Admin on the same derived onboarding truth consumed by
-- Merchant Web and Mobile. The existing C1B admin onboarding payload remains
-- backward compatible; OA1 adds one read-only onboardingState object.
create or replace function public.get_sellertray_commercial_onboarding_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_existing jsonb;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  v_existing := public.get_sellertray_commercial_onboarding_admin_impl(
    p_actor_user_id,
    p_tenant_id
  );

  return v_existing || jsonb_build_object(
    'onboardingState', public.derive_sellertray_onboarding_state(p_tenant_id)
  );
end;
$$;

revoke all on function public.get_sellertray_commercial_onboarding_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_onboarding_admin(uuid,uuid)
  to service_role;

commit;
