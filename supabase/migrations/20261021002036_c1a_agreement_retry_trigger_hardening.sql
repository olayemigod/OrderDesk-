begin;

-- Let an already-governed agreement reference reach the issuance command's
-- ON CONFLICT/idempotency comparison. The unique tenant/reference key still
-- blocks direct duplicate persistence, while the governed command decides
-- whether the retry is identical or conflicts with different contractual facts.

create or replace function public.prepare_sellertray_commercial_agreement()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_previous public.sellertray_commercial_agreements%rowtype;
begin
  select t.* into strict v_template
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=new.template_version_id;

  new.agreement_family := v_template.agreement_family;
  new.template_version_code := v_template.version_code;
  new.template_content_sha256 := v_template.content_sha256;
  new.agreement_reference := btrim(new.agreement_reference);
  new.content_sha256 := encode(extensions.digest(new.rendered_content,'sha256'),'hex');
  new.issued_at := coalesce(new.issued_at,now());
  new.created_at := coalesce(new.created_at,now());

  if v_template.effective_from>new.issued_at then
    raise exception 'SellerTray agreement template is not effective at the issue time' using errcode='23514';
  end if;

  if new.agreement_family='installment_agreement' and new.installment_obligation_id is null then
    raise exception 'SellerTray installment agreement requires an installment obligation' using errcode='23514';
  elsif new.agreement_family<>'installment_agreement' and new.installment_obligation_id is not null then
    raise exception 'Only an installment agreement may bind an installment obligation' using errcode='23514';
  end if;

  -- A repeated governed reference is not accepted here; it is merely allowed to
  -- reach the unique-key arbiter. issue_sellertray_commercial_agreement then
  -- compares every immutable contractual fact before returning the existing ID.
  if exists (
    select 1
    from public.sellertray_commercial_agreements a
    where a.tenant_id=new.tenant_id
      and a.agreement_reference=new.agreement_reference
  ) then
    return new;
  end if;

  if new.supersedes_agreement_id is not null then
    select a.* into strict v_previous
    from public.sellertray_commercial_agreements a
    where a.tenant_id=new.tenant_id and a.id=new.supersedes_agreement_id
    for update;

    if v_previous.commercial_order_id<>new.commercial_order_id
       or v_previous.agreement_family<>new.agreement_family
       or v_previous.installment_obligation_id is distinct from new.installment_obligation_id then
      raise exception 'Replacement agreement must preserve the original commercial subject'
        using errcode='23514';
    end if;
    if exists (
      select 1 from public.sellertray_commercial_agreements a
      where a.supersedes_agreement_id=v_previous.id
    ) then
      raise exception 'SellerTray agreement has already been replaced' using errcode='23505';
    end if;
  elsif exists (
    select 1
    from public.sellertray_commercial_agreements a
    where a.tenant_id=new.tenant_id
      and a.commercial_order_id=new.commercial_order_id
      and a.agreement_family=new.agreement_family
      and a.installment_obligation_id is not distinct from new.installment_obligation_id
      and not exists (
        select 1 from public.sellertray_commercial_agreements r
        where r.supersedes_agreement_id=a.id
      )
  ) then
    raise exception 'Existing SellerTray agreement must be explicitly superseded' using errcode='23505';
  end if;

  return new;
end;
$$;

revoke all on function public.prepare_sellertray_commercial_agreement()
  from public,anon,authenticated;

-- A committed acceptance command is historical evidence. Exact retries must
-- return that committed result before later role changes or agreement
-- supersession are re-evaluated. Different facts using the same command still
-- fail closed.
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

  select a.* into v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if found then
    if v_existing.agreement_id<>p_agreement_id
       or v_existing.accepted_by_user_id<>p_actor_user_id
       or v_existing.accepted_legal_name<>v_name
       or v_existing.request_evidence is distinct from v_evidence then
      raise exception 'Agreement acceptance command is already used for different facts' using errcode='23505';
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
  on conflict (tenant_id,command_id) do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select a.* into strict v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if v_existing.agreement_id<>v_agreement.id
     or v_existing.accepted_by_user_id<>p_actor_user_id
     or v_existing.accepted_legal_name<>v_name
     or v_existing.accepted_role<>v_role
     or v_existing.request_evidence is distinct from v_evidence then
    raise exception 'Agreement acceptance command is already used for different facts' using errcode='23505';
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