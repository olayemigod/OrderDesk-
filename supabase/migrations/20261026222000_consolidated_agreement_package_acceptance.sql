begin;

-- SellerTray consolidated agreement package acceptance.
--
-- The universal Master Agreement remains Business + Master version authority.
-- Merchant-specific commercial truth remains the existing immutable C1A
-- commercial agreement / Order Form authority. This migration composes those
-- two existing facts into one merchant review/acceptance command without
-- creating a second legal or commercial source of truth.

create or replace function public.get_sellertray_consolidated_agreement_package(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_master jsonb;
  v_commercial public.sellertray_commercial_agreements%rowtype;
  v_commercial_acceptance public.sellertray_commercial_agreement_acceptances%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_can_accept boolean := false;
  v_role text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role is null then
    raise exception 'You do not belong to this business' using errcode='42501';
  end if;

  v_can_accept := v_role='owner' or (
    v_role='manager' and public.sellertray_user_has_capability(
      p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
    )
  );

  v_master := public.get_sellertray_master_agreement_state(p_tenant_id,now());

  -- The applicable merchant-specific instrument is the newest unsuperseded
  -- subscription order. It carries the canonical governed C1 commercial
  -- snapshot (plan, Branch, price, tax and installment facts). Historical C1A
  -- agreement families remain immutable evidence but are not reintroduced as
  -- separate checkboxes in the consolidated merchant experience.
  select a.* into v_commercial
  from public.sellertray_commercial_agreements a
  where a.tenant_id=p_tenant_id
    and a.agreement_family='subscription_order'
    and not exists (
      select 1
      from public.sellertray_commercial_agreements r
      where r.tenant_id=a.tenant_id and r.supersedes_agreement_id=a.id
    )
  order by a.issued_at desc,a.created_at desc,a.id desc
  limit 1;

  if v_commercial.id is not null then
    select ca.* into v_commercial_acceptance
    from public.sellertray_commercial_agreement_acceptances ca
    where ca.tenant_id=p_tenant_id and ca.agreement_id=v_commercial.id;

    select o.* into v_order
    from public.sellertray_commercial_orders o
    where o.tenant_id=p_tenant_id and o.id=v_commercial.commercial_order_id;
  end if;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'canAccept',v_can_accept,
    'master',v_master,
    'commercialInstrument',case when v_commercial.id is null then null else jsonb_build_object(
      'agreementId',v_commercial.id,
      'agreementReference',v_commercial.agreement_reference,
      'agreementFamily',v_commercial.agreement_family,
      'templateVersionId',v_commercial.template_version_id,
      'templateVersionCode',v_commercial.template_version_code,
      'templateContentSha256',v_commercial.template_content_sha256,
      'contentSha256',v_commercial.content_sha256,
      'renderedContent',v_commercial.rendered_content,
      'commercialSnapshot',v_commercial.commercial_snapshot,
      'commercialOrderId',v_commercial.commercial_order_id,
      'orderReference',v_order.order_reference,
      'issuedAt',v_commercial.issued_at,
      'accepted',v_commercial_acceptance.id is not null,
      'acceptance',case when v_commercial_acceptance.id is null then null else jsonb_build_object(
        'id',v_commercial_acceptance.id,
        'acceptedByUserId',v_commercial_acceptance.accepted_by_user_id,
        'acceptedLegalName',v_commercial_acceptance.accepted_legal_name,
        'acceptedRole',v_commercial_acceptance.accepted_role,
        'acceptedAt',v_commercial_acceptance.accepted_at,
        'contentSha256',v_commercial_acceptance.agreement_content_sha256
      ) end
    ) end,
    'acceptanceRequired',
      coalesce((v_master->>'acceptanceRequired')::boolean,false)
      or (v_commercial.id is not null and v_commercial_acceptance.id is null),
    'packageReady',coalesce((v_master->>'published')::boolean,false)
  );
end;
$$;

revoke all on function public.get_sellertray_consolidated_agreement_package(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_consolidated_agreement_package(uuid,uuid)
  to service_role;

create or replace function public.accept_sellertray_consolidated_agreement_package(
  p_tenant_id uuid,
  p_master_agreement_version_id uuid,
  p_commercial_agreement_id uuid,
  p_accepted_legal_name text,
  p_request_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_master public.sellertray_master_agreement_versions%rowtype;
  v_commercial public.sellertray_commercial_agreements%rowtype;
  v_master_acceptance_id uuid;
  v_commercial_acceptance_id uuid;
  v_master_command_id uuid;
  v_commercial_command_id uuid;
  v_evidence jsonb := coalesce(p_request_evidence,'{}'::jsonb);
  v_package_evidence jsonb;
  v_current_master_id uuid;
begin
  if p_tenant_id is null or p_master_agreement_version_id is null
     or p_command_id is null or p_actor_user_id is null then
    raise exception 'Business, Master Agreement version, command and accepting user are required'
      using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Agreement package acceptance evidence must be an object' using errcode='22023';
  end if;

  v_current_master_id := public.resolve_sellertray_master_agreement_version_id(now());
  if v_current_master_id is null or v_current_master_id<>p_master_agreement_version_id then
    raise exception 'Only the current SellerTray Master Agreement package can be accepted'
      using errcode='23514';
  end if;

  select m.* into strict v_master
  from public.sellertray_master_agreement_versions m
  where m.id=p_master_agreement_version_id;

  if p_commercial_agreement_id is not null then
    select a.* into strict v_commercial
    from public.sellertray_commercial_agreements a
    where a.tenant_id=p_tenant_id and a.id=p_commercial_agreement_id;

    if v_commercial.agreement_family<>'subscription_order' then
      raise exception 'Consolidated package commercial instrument must be a Merchant Order Form / subscription order'
        using errcode='23514';
    end if;
    if exists (
      select 1 from public.sellertray_commercial_agreements r
      where r.tenant_id=p_tenant_id and r.supersedes_agreement_id=v_commercial.id
    ) then
      raise exception 'The selected Merchant Order Form has been superseded' using errcode='23514';
    end if;
  end if;

  -- Derive deterministic child commands from the one merchant action so replay
  -- remains safe while the two ledgers preserve independent command identity.
  v_master_command_id := extensions.uuid_generate_v5(
    '00000000-0000-0000-0000-000000000000'::uuid,
    p_command_id::text||':master'
  );
  v_commercial_command_id := extensions.uuid_generate_v5(
    '00000000-0000-0000-0000-000000000000'::uuid,
    p_command_id::text||':commercial'
  );

  v_package_evidence := v_evidence || jsonb_build_object(
    'package_command_id',p_command_id,
    'master_agreement_version_id',v_master.id,
    'master_agreement_version_code',v_master.version_code,
    'master_content_sha256',v_master.content_sha256,
    'commercial_agreement_id',v_commercial.id,
    'commercial_order_id',v_commercial.commercial_order_id,
    'commercial_template_version_id',v_commercial.template_version_id,
    'commercial_template_version_code',v_commercial.template_version_code,
    'commercial_content_sha256',v_commercial.content_sha256
  );

  -- If an applicable Merchant Order Form is present, accept that immutable
  -- commercial instrument first. The enclosing transaction guarantees that the
  -- merchant's single affirmative action cannot commit only half of the package.
  if v_commercial.id is not null then
    v_commercial_acceptance_id := public.accept_sellertray_commercial_agreement(
      p_tenant_id,
      v_commercial.id,
      p_accepted_legal_name,
      v_package_evidence || jsonb_build_object('acceptance_component','merchant_order_form'),
      v_commercial_command_id,
      p_actor_user_id
    );
  end if;

  -- Master acceptance remains one Business/version fact. For later orders under
  -- an already accepted Master this returns the existing Master acceptance while
  -- the new commercial instrument receives its own acceptance above.
  v_master_acceptance_id := public.accept_sellertray_master_agreement(
    p_tenant_id,
    v_master.id,
    p_accepted_legal_name,
    v_package_evidence || jsonb_build_object('acceptance_component','master_agreement'),
    v_master_command_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'packageCommandId',p_command_id,
    'masterAcceptanceId',v_master_acceptance_id,
    'commercialAcceptanceId',v_commercial_acceptance_id,
    'masterAgreementVersionId',v_master.id,
    'commercialAgreementId',v_commercial.id,
    'commercialOrderId',v_commercial.commercial_order_id
  );
end;
$$;

revoke all on function public.accept_sellertray_consolidated_agreement_package(
  uuid,uuid,uuid,text,jsonb,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.accept_sellertray_consolidated_agreement_package(
  uuid,uuid,uuid,text,jsonb,uuid,uuid
) to service_role;

commit;
