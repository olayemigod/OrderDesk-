begin;

-- Preserve strict command idempotency while also making the one-time legal
-- acceptance resilient to a client timeout/reload after the server committed.
-- A new command for the same immutable agreement may reuse the existing
-- acceptance only when the signer and legal acceptance facts are identical.

create or replace function public.accept_sellertray_commercial_agreement(
  p_tenant_id uuid,
  p_agreement_id uuid,
  p_accepted_legal_name text,
  p_request_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_agreement public.sellertray_commercial_agreements%rowtype;
  v_existing public.sellertray_commercial_agreement_acceptances%rowtype;
  v_id uuid;
  v_name text := btrim(coalesce(p_accepted_legal_name,''));
  v_evidence jsonb := coalesce(p_request_evidence,'{}'::jsonb);
begin
  if p_tenant_id is null or p_agreement_id is null or p_actor_user_id is null or p_command_id is null then
    raise exception 'Business, agreement, accepting user and command are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Agreement acceptance evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 200 then
    raise exception 'Enter the authorised representative legal name' using errcode='22023';
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
    raise exception 'You are not authorised to accept SellerTray commercial agreements' using errcode='42501';
  end if;

  select a.* into strict v_agreement
  from public.sellertray_commercial_agreements a
  where a.tenant_id=p_tenant_id and a.id=p_agreement_id;

  if exists (
    select 1 from public.sellertray_commercial_agreements r
    where r.tenant_id=p_tenant_id and r.supersedes_agreement_id=v_agreement.id
  ) then
    raise exception 'This SellerTray agreement has been replaced and cannot be accepted' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_agreement_acceptances(
    tenant_id,agreement_id,template_version_id,template_version_code,
    template_content_sha256,agreement_content_sha256,accepted_by_user_id,
    accepted_legal_name,accepted_role,acceptance_method,request_evidence,
    command_id,accepted_at,created_at
  ) values (
    p_tenant_id,v_agreement.id,v_agreement.template_version_id,v_agreement.template_version_code,
    v_agreement.template_content_sha256,v_agreement.content_sha256,p_actor_user_id,
    v_name,v_role,'merchant_web_authenticated',v_evidence,p_command_id,now(),now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  -- Reusing a command identity is only valid for an exact replay, including
  -- the request evidence attached to that command.
  select a.* into v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_existing.agreement_id<>v_agreement.id
       or v_existing.template_version_id<>v_agreement.template_version_id
       or v_existing.template_content_sha256<>v_agreement.template_content_sha256
       or v_existing.agreement_content_sha256<>v_agreement.content_sha256
       or v_existing.accepted_by_user_id<>p_actor_user_id
       or v_existing.accepted_legal_name<>v_name
       or v_existing.accepted_role<>v_role
       or v_existing.acceptance_method<>'merchant_web_authenticated'
       or v_existing.request_evidence is distinct from v_evidence then
      raise exception 'Agreement acceptance command is already used for different facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  -- A client may lose the successful response and retry after a reload with a
  -- new command ID. Because an agreement version can be accepted only once,
  -- return the existing acceptance when the legal signer facts are identical.
  select a.* into strict v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.agreement_id=v_agreement.id;

  if v_existing.template_version_id<>v_agreement.template_version_id
     or v_existing.template_content_sha256<>v_agreement.template_content_sha256
     or v_existing.agreement_content_sha256<>v_agreement.content_sha256
     or v_existing.accepted_by_user_id<>p_actor_user_id
     or v_existing.accepted_legal_name<>v_name
     or v_existing.accepted_role<>v_role
     or v_existing.acceptance_method<>'merchant_web_authenticated' then
    raise exception 'SellerTray agreement is already accepted with different acceptance facts'
      using errcode='23505';
  end if;

  return v_existing.id;
end;
$$;

revoke all on function public.accept_sellertray_commercial_agreement(
  uuid,uuid,text,jsonb,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.accept_sellertray_commercial_agreement(
  uuid,uuid,text,jsonb,uuid,uuid
) to service_role;

commit;
