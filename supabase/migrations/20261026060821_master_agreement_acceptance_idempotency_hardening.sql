create or replace function public.accept_sellertray_master_agreement(
  p_tenant_id uuid,
  p_agreement_version_id uuid,
  p_accepted_legal_name text,
  p_request_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_name text:=btrim(coalesce(p_accepted_legal_name,''));
  v_evidence jsonb:=coalesce(p_request_evidence,'{}'::jsonb);
  v_current_id uuid;
  v_version public.sellertray_master_agreement_versions%rowtype;
  v_existing public.sellertray_master_agreement_acceptances%rowtype;
  v_id uuid;
begin
  if p_tenant_id is null or p_agreement_version_id is null or p_command_id is null or p_actor_user_id is null then
    raise exception 'Business, Master Agreement version, command and accepting user are required' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 200 or jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Authorised representative legal name and acceptance evidence are required' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));

  select a.* into v_existing
  from public.sellertray_master_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_existing.agreement_version_id<>p_agreement_version_id
       or v_existing.accepted_by_user_id<>p_actor_user_id
       or v_existing.accepted_legal_name<>v_name
       or v_existing.acceptance_method<>'merchant_web_authenticated'
       or v_existing.request_evidence is distinct from v_evidence then
      raise exception 'Master Agreement acceptance command is already used for different acceptance facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role='owner' then
    null;
  elsif v_role='manager' and public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
  ) then
    null;
  else
    raise exception 'You are not authorised to accept the SellerTray Master Agreement' using errcode='42501';
  end if;

  v_current_id:=public.resolve_sellertray_master_agreement_version_id(now());
  if v_current_id is null then
    raise exception 'SellerTray Master Agreement is not yet published' using errcode='23514';
  end if;
  if p_agreement_version_id<>v_current_id then
    raise exception 'Only the current SellerTray Master Agreement version can be accepted' using errcode='23514';
  end if;

  select v.* into strict v_version
  from public.sellertray_master_agreement_versions v
  where v.id=v_current_id;

  select a.* into v_existing
  from public.sellertray_master_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.agreement_version_id=v_current_id;

  if found then
    return v_existing.id;
  end if;

  insert into public.sellertray_master_agreement_acceptances(
    tenant_id,agreement_version_id,agreement_version_code,agreement_content_sha256,
    accepted_by_user_id,accepted_legal_name,accepted_role,acceptance_method,
    request_evidence,command_id,accepted_at,created_at
  ) values (
    p_tenant_id,v_version.id,v_version.version_code,v_version.content_sha256,
    p_actor_user_id,v_name,v_role,'merchant_web_authenticated',
    v_evidence,p_command_id,now(),now()
  )
  on conflict (tenant_id,agreement_version_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  select a.* into strict v_existing
  from public.sellertray_master_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.agreement_version_id=v_current_id;

  return v_existing.id;
end;
$$;

revoke all on function public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid)
  to service_role;
