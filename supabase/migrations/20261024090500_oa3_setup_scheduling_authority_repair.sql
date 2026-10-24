begin;

-- OA3 authority repair.
-- Purchased Branch setup remains the readiness subject even when the Branch is
-- not yet active. Scheduling itself is the new setup-completion authority, so a
-- new readiness fact must be backed by the immutable completed appointment event.
-- Database superusers retain only the unavoidable migration/test-fixture escape
-- hatch they already possess through direct table access; SellerTray runtime roles
-- (including service_role) remain subject to the completed-appointment guard.

create or replace function public.assert_sellertray_setup_subject(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not exists (
    select 1
    from public.sellertray_commercial_order_price_snapshots s
    join public.branches b on b.id=s.branch_id and b.tenant_id=s.tenant_id
    where s.tenant_id=p_tenant_id
      and s.commercial_order_id=p_commercial_order_id
      and s.line_type='branch_setup'
      and s.branch_id=p_branch_id
  ) then
    raise exception 'Branch is not part of this governed SellerTray setup purchase' using errcode='23514';
  end if;
end;
$$;

revoke all on function public.assert_sellertray_setup_subject(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_sellertray_setup_subject(uuid,uuid,uuid) to service_role;

create or replace function public.mark_sellertray_commercial_branch_setup_ready(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_branch_id uuid,
  p_command_id uuid,
  p_evidence jsonb,
  p_reason text,
  p_ready_at timestamptz,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_evidence jsonb := coalesce(p_evidence,'{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.sellertray_commercial_branch_setup_readiness%rowtype;
  v_id uuid;
  v_superuser_session boolean := false;
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_branch_id is null
     or p_command_id is null or p_ready_at is null or p_actor_user_id is null then
    raise exception 'Business, commercial order, Branch, command, setup time and actor are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Setup readiness evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_reason) not between 1 and 1000 then
    raise exception 'Setup readiness reason is required' using errcode='22023';
  end if;
  if p_ready_at>now()+interval '5 minutes' then
    raise exception 'Setup readiness time cannot be in the future' using errcode='22023';
  end if;
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.branch_setup.manage',p_tenant_id,now()) then
    raise exception 'Branch setup management capability required' using errcode='42501';
  end if;

  perform public.assert_sellertray_setup_subject(p_tenant_id,p_commercial_order_id,p_branch_id);

  -- Preserve idempotent replay of readiness facts that already existed before
  -- OA3. Only creation of a new readiness fact requires appointment completion.
  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id
      and r.commercial_order_id=p_commercial_order_id
      and r.branch_id=p_branch_id;
  end if;

  if found then
    if v_existing.commercial_order_id<>p_commercial_order_id
       or v_existing.branch_id<>p_branch_id
       or v_existing.evidence is distinct from v_evidence
       or v_existing.actor_user_id<>p_actor_user_id
       or v_existing.reason<>v_reason
       or v_existing.ready_at<>p_ready_at then
      raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  select coalesce(r.rolsuper,false) into v_superuser_session
  from pg_catalog.pg_roles r
  where r.rolname=session_user;

  if not v_superuser_session and not exists (
    select 1
    from public.sellertray_commercial_setup_appointment_events e
    join public.sellertray_commercial_setup_appointments a
      on a.id=e.appointment_id
     and a.tenant_id=e.tenant_id
     and a.commercial_order_id=e.commercial_order_id
     and a.branch_id=e.branch_id
    where e.tenant_id=p_tenant_id
      and e.commercial_order_id=p_commercial_order_id
      and e.branch_id=p_branch_id
      and e.command_id=p_command_id
      and e.event_type='completed'
      and e.actor_user_id=p_actor_user_id
      and a.status='completed'
  ) then
    raise exception 'Branch setup readiness must come from a completed governed setup appointment' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_branch_setup_readiness(
    tenant_id,commercial_order_id,branch_id,command_id,evidence,
    actor_user_id,reason,ready_at,recorded_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_branch_id,p_command_id,v_evidence,
    p_actor_user_id,v_reason,p_ready_at,now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select r.* into v_existing
  from public.sellertray_commercial_branch_setup_readiness r
  where r.tenant_id=p_tenant_id and r.command_id=p_command_id;

  if not found then
    select r.* into strict v_existing
    from public.sellertray_commercial_branch_setup_readiness r
    where r.tenant_id=p_tenant_id and r.commercial_order_id=p_commercial_order_id and r.branch_id=p_branch_id;
  end if;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.branch_id<>p_branch_id
     or v_existing.evidence is distinct from v_evidence
     or v_existing.actor_user_id<>p_actor_user_id
     or v_existing.reason<>v_reason
     or v_existing.ready_at<>p_ready_at then
    raise exception 'SellerTray setup readiness is already recorded with different facts' using errcode='23505';
  end if;
  return v_existing.id;
end;
$$;

revoke all on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid) to service_role;

comment on function public.mark_sellertray_commercial_branch_setup_ready(uuid,uuid,uuid,uuid,jsonb,text,timestamptz,uuid)
  is 'OA3 readiness fact writer. Existing facts replay idempotently; every new SellerTray runtime fact must be backed by the matching immutable completed setup appointment event. Only an actual database-superuser session retains migration/test-fixture authority.';

commit;
