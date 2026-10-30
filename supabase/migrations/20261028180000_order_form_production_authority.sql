begin;

-- Production Order Form template authority.
--
-- Historical commercial agreement templates are immutable evidence. Existing rows
-- therefore remain explicitly QA-scoped; a production Order Form template must be
-- published as a new immutable version through the governed Admin publication
-- boundary. Production lifecycle orchestration, manual issuance, Agreement Package
-- creation and OA5C evidence all fail closed when that authority is absent.

alter table public.sellertray_commercial_agreement_template_versions
  add column publication_scope text not null default 'qa',
  add column production_authorized_at timestamptz,
  add column production_authorized_by_user_id uuid references auth.users(id) on delete restrict,
  add column production_authorization_reason text;

alter table public.sellertray_commercial_agreement_template_versions
  add constraint sellertray_commercial_agreement_template_publication_scope_check
    check (publication_scope in ('qa','production')),
  add constraint sellertray_commercial_agreement_template_production_authority_check
    check (
      (
        publication_scope='qa'
        and production_authorized_at is null
        and production_authorized_by_user_id is null
        and production_authorization_reason is null
      )
      or
      (
        publication_scope='production'
        and production_authorized_at is not null
        and production_authorized_by_user_id is not null
        and production_authorization_reason is not null
        and production_authorization_reason=btrim(production_authorization_reason)
        and char_length(production_authorization_reason) between 6 and 1000
      )
    );

create index sellertray_commercial_agreement_template_production_resolution_idx
  on public.sellertray_commercial_agreement_template_versions(
    agreement_family,effective_from desc,published_at desc,id desc
  )
  where publication_scope='production';

comment on column public.sellertray_commercial_agreement_template_versions.publication_scope is
  'Immutable template provenance. qa rows are never eligible for a production merchant Order Form; production rows require explicit governed publication authority.';
comment on column public.sellertray_commercial_agreement_template_versions.production_authorized_at is
  'Timestamp at which this exact immutable template version was authorized for production merchant Order Form use.';
comment on column public.sellertray_commercial_agreement_template_versions.production_authorized_by_user_id is
  'Platform administrator who authorized this exact immutable template version for production merchant use.';
comment on column public.sellertray_commercial_agreement_template_versions.production_authorization_reason is
  'Auditable reason recorded by the governed Admin publication command for production authorization.';

-- Keep the generic template publisher QA-scoped. It remains useful for fixtures,
-- compatibility evidence and non-production template work, but it cannot mint
-- production merchant authority merely by using a production-looking title.
create or replace function public.publish_sellertray_order_form_template_admin(
  p_agreement_family text,
  p_version_code text,
  p_title text,
  p_content_body text,
  p_effective_from timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_family text:=lower(btrim(coalesce(p_agreement_family,'')));
  v_version text:=btrim(coalesce(p_version_code,''));
  v_title text:=btrim(coalesce(p_title,''));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_hash text:=encode(extensions.digest(coalesce(p_content_body,''),'sha256'),'hex');
  v_id uuid;
  v_existing public.sellertray_commercial_agreement_template_versions%rowtype;
  v_created boolean:=false;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.order_forms.publish',null,now()
  ) then
    raise exception 'Order Form template publication capability required' using errcode='42501';
  end if;
  if v_family not in ('subscription_order','installment_agreement') then
    raise exception 'Only SellerTray Order Form template families may be published here' using errcode='23514';
  end if;
  if p_effective_from is null then
    raise exception 'Order Form template effective time is required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Order Form template publication reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  insert into public.sellertray_commercial_agreement_template_versions(
    agreement_family,version_code,title,content_body,content_sha256,
    effective_from,published_by_user_id,published_at,
    publication_scope,production_authorized_at,production_authorized_by_user_id,
    production_authorization_reason
  ) values (
    v_family,v_version,v_title,coalesce(p_content_body,''),v_hash,
    p_effective_from,p_actor_user_id,now(),
    'production',now(),p_actor_user_id,v_reason
  )
  on conflict (agreement_family,version_code) do nothing
  returning id into v_id;

  if v_id is not null then
    v_created:=true;
  else
    select t.* into strict v_existing
    from public.sellertray_commercial_agreement_template_versions t
    where t.agreement_family=v_family
      and t.version_code=v_version;

    if v_existing.publication_scope<>'production' then
      raise exception 'Existing Order Form template version is not production-authorized; publish a new immutable version code' using errcode='23505';
    end if;
    if v_existing.title is distinct from v_title
       or v_existing.content_sha256 is distinct from v_hash
       or v_existing.effective_from is distinct from p_effective_from
       or v_existing.production_authorized_by_user_id is distinct from p_actor_user_id
       or v_existing.production_authorization_reason is distinct from v_reason then
      raise exception 'Production Order Form template version already exists with different immutable facts' using errcode='23505';
    end if;
    v_id:=v_existing.id;
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,null,'sellertray_order_form_template_published',jsonb_build_object(
    'templateVersionId',v_id,
    'agreementFamily',v_family,
    'versionCode',v_version,
    'effectiveFrom',p_effective_from,
    'publicationScope','production',
    'idempotentReplay',not v_created,
    'reason',v_reason
  ));
  return v_id;
end;
$$;

comment on function public.publish_sellertray_order_form_template_admin(text,text,text,text,timestamptz,text,uuid) is
  'Governed Admin publication command for immutable production-authorized SellerTray Order Form template versions. Historical QA versions cannot be promoted in place.';

create or replace function public.issue_sellertray_commercial_order_form_admin(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid,
  p_template_version_id uuid,
  p_order_form_reference text,
  p_supersedes_order_form_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_existing public.sellertray_commercial_order_forms%rowtype;
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_reference text := btrim(coalesce(p_order_form_reference,''));
  v_reason text := btrim(coalesce(p_reason,''));
  v_expected_family text;
begin
  if p_actor_user_id is null or not public.platform_admin_has_capability(
    p_actor_user_id,'admin.order_forms.issue',p_tenant_id,now()
  ) then
    raise exception 'Order Form issuance capability required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_commercial_order_id is null or p_template_version_id is null then
    raise exception 'Business, commercial order and Order Form template are required' using errcode='22023';
  end if;
  if char_length(v_reference) not between 1 and 128 then
    raise exception 'Order Form reference is required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Order Form issuance reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  v_expected_family:=case when p_installment_obligation_id is null
    then 'subscription_order' else 'installment_agreement' end;

  select t.* into v_template
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=p_template_version_id;

  if not found
     or v_template.agreement_family<>v_expected_family
     or v_template.publication_scope<>'production'
     or v_template.production_authorized_at is null
     or v_template.production_authorized_by_user_id is null
     or nullif(btrim(v_template.production_authorization_reason),'') is null
     or v_template.effective_from>now()
     or v_template.production_authorized_at>now() then
    raise exception 'Order Form template is not production-authorized for this commercial order' using errcode='23514';
  end if;

  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);
  perform pg_advisory_xact_lock(hashtextextended('sellertray-order-form:'||p_tenant_id::text||':'||v_reference,0));

  select f.* into v_existing
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.order_form_reference=v_reference;
  if found then
    if v_existing.commercial_order_id<>p_commercial_order_id
       or v_existing.installment_obligation_id is distinct from p_installment_obligation_id
       or v_existing.order_form_template_version_id<>p_template_version_id
       or v_existing.supersedes_order_form_id is distinct from p_supersedes_order_form_id
       or v_existing.issued_by_user_id<>p_actor_user_id then
      raise exception 'Order Form reference is already used for different contractual facts' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  if p_supersedes_order_form_id is null and exists (
    select 1 from public.sellertray_commercial_order_forms f
    where f.tenant_id=p_tenant_id and f.commercial_order_id=p_commercial_order_id
      and f.installment_obligation_id is not distinct from p_installment_obligation_id
      and not exists (
        select 1 from public.sellertray_commercial_order_forms r
        where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id
      )
  ) then
    raise exception 'Existing SellerTray Order Form must be explicitly superseded' using errcode='23505';
  end if;

  insert into public.sellertray_commercial_order_forms(
    tenant_id,commercial_order_id,installment_obligation_id,order_form_template_version_id,
    template_version_code,template_content_sha256,order_form_reference,rendered_content,
    commercial_snapshot,commercial_snapshot_sha256,content_sha256,supersedes_order_form_id,
    issued_by_user_id
  ) values (
    p_tenant_id,p_commercial_order_id,p_installment_obligation_id,p_template_version_id,
    'pending',repeat('0',64),v_reference,'pending','{}'::jsonb,repeat('0',64),repeat('0',64),
    p_supersedes_order_form_id,p_actor_user_id
  ) returning id into v_id;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,p_tenant_id,'sellertray_order_form_issued',jsonb_build_object(
    'orderFormId',v_id,
    'commercialOrderId',p_commercial_order_id,
    'installmentObligationId',p_installment_obligation_id,
    'templateVersionId',p_template_version_id,
    'templatePublicationScope','production',
    'orderFormReference',v_reference,
    'supersedesOrderFormId',p_supersedes_order_form_id,
    'reason',v_reason
  ));
  return v_id;
end;
$$;

comment on function public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,uuid,text,uuid) is
  'Governed Admin Order Form issuance. Production merchant Order Forms can only be issued from an explicitly production-authorized immutable template version of the correct compatibility family.';

create or replace function public.create_sellertray_agreement_package(
  p_tenant_id uuid,
  p_order_form_id uuid,
  p_master_agreement_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_master public.sellertray_master_agreement_versions%rowtype;
  v_expected_family text;
  v_id uuid;
begin
  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.id=p_order_form_id;

  v_expected_family:=case when v_form.installment_obligation_id is null
    then 'subscription_order' else 'installment_agreement' end;

  select t.* into v_template
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=v_form.order_form_template_version_id;

  if not found
     or v_template.agreement_family<>v_expected_family
     or v_template.publication_scope<>'production'
     or v_template.production_authorized_at is null
     or v_template.production_authorized_by_user_id is null
     or nullif(btrim(v_template.production_authorization_reason),'') is null
     or v_template.effective_from>v_form.issued_at
     or v_template.production_authorized_at>v_form.issued_at
     or v_template.version_code<>v_form.template_version_code
     or v_template.content_sha256<>v_form.template_content_sha256 then
    raise exception 'Agreement Package requires an Order Form sourced from an exact production-authorized template version' using errcode='23514';
  end if;

  select m.* into strict v_master
  from public.sellertray_master_agreement_versions m
  where m.id=p_master_agreement_version_id;

  insert into public.sellertray_agreement_packages(
    tenant_id,commercial_order_id,master_agreement_version_id,master_content_sha256,
    order_form_id,order_form_content_sha256,order_form_commercial_snapshot_sha256,
    manifest_schema_version,manifest,package_fingerprint
  ) values (
    p_tenant_id,v_form.commercial_order_id,v_master.id,v_master.content_sha256,
    v_form.id,v_form.content_sha256,v_form.commercial_snapshot_sha256,
    1,'{}'::jsonb,repeat('0',64)
  )
  on conflict (tenant_id,master_agreement_version_id,order_form_id) do nothing
  returning id into v_id;
  if v_id is not null then return v_id; end if;

  select p.id into strict v_id
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id
    and p.master_agreement_version_id=v_master.id
    and p.order_form_id=v_form.id;
  return v_id;
end;
$$;

comment on function public.create_sellertray_agreement_package(uuid,uuid,uuid) is
  'Creates/reuses an immutable Agreement Package only when the exact Order Form snapshot originates from an explicitly production-authorized template version of the correct compatibility family.';

create or replace function public.ensure_sellertray_agreement_package_for_commercial_order(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_package public.sellertray_agreement_packages%rowtype;
  v_master_id uuid;
  v_family text;
  v_reference text;
  v_created_form boolean := false;
  v_created_package boolean := false;
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_actor_user_id is null then
    raise exception 'Business, commercial order and orchestration actor are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sellertray-agreement-orchestration:'||p_tenant_id::text||':'||p_commercial_order_id::text,0));
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);
  select o.* into strict v_order from public.sellertray_commercial_orders o where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;
  if p_installment_obligation_id is not null then
    select io.* into strict v_obligation from public.sellertray_commercial_installment_obligations io where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id and io.id=p_installment_obligation_id;
    v_family := 'installment_agreement';
  else
    v_family := 'subscription_order';
  end if;

  select f.* into v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.commercial_order_id=p_commercial_order_id
    and f.installment_obligation_id is not distinct from p_installment_obligation_id
    and not exists (select 1 from public.sellertray_commercial_order_forms replacement where replacement.tenant_id=f.tenant_id and replacement.supersedes_order_form_id=f.id)
  order by f.issued_at desc,f.id desc limit 1;

  if found then
    select t.* into v_template
    from public.sellertray_commercial_agreement_template_versions t
    where t.id=v_form.order_form_template_version_id;

    if not found
       or v_template.agreement_family<>v_family
       or v_template.publication_scope<>'production'
       or v_template.production_authorized_at is null
       or v_template.production_authorized_by_user_id is null
       or nullif(btrim(v_template.production_authorization_reason),'') is null
       or v_template.effective_from>v_form.issued_at
       or v_template.production_authorized_at>v_form.issued_at
       or v_template.version_code<>v_form.template_version_code
       or v_template.content_sha256<>v_form.template_content_sha256 then
      return jsonb_build_object(
        'status','order_form_template_not_production_authorized',
        'ready',false,
        'tenantId',p_tenant_id,
        'commercialOrderId',p_commercial_order_id,
        'installmentObligationId',p_installment_obligation_id,
        'orderFormFamily',v_family,
        'orderFormId',v_form.id,
        'agreementPackageId',null,
        'masterAgreementVersionId',public.resolve_sellertray_master_agreement_version_id(now())
      );
    end if;
  else
    select t.* into v_template
    from public.sellertray_commercial_agreement_template_versions t
    where t.agreement_family=v_family
      and t.publication_scope='production'
      and t.production_authorized_at is not null
      and t.production_authorized_by_user_id is not null
      and nullif(btrim(t.production_authorization_reason),'') is not null
      and t.effective_from<=now()
      and t.production_authorized_at<=now()
    order by t.effective_from desc,t.published_at desc,t.id desc limit 1;
    if not found then
      return jsonb_build_object('status','production_order_form_template_missing','ready',false,'tenantId',p_tenant_id,'commercialOrderId',p_commercial_order_id,'installmentObligationId',p_installment_obligation_id,'orderFormFamily',v_family,'orderFormId',null,'agreementPackageId',null,'masterAgreementVersionId',public.resolve_sellertray_master_agreement_version_id(now()));
    end if;
    v_reference := 'ST-OF-'||replace(p_commercial_order_id::text,'-','');
    insert into public.sellertray_commercial_order_forms(
      tenant_id,commercial_order_id,installment_obligation_id,order_form_template_version_id,
      template_version_code,template_content_sha256,order_form_reference,rendered_content,
      commercial_snapshot,commercial_snapshot_sha256,content_sha256,supersedes_order_form_id,
      issued_by_user_id
    ) values (
      p_tenant_id,p_commercial_order_id,p_installment_obligation_id,v_template.id,
      'pending',repeat('0',64),v_reference,'pending','{}'::jsonb,repeat('0',64),repeat('0',64),null,p_actor_user_id
    ) returning * into v_form;
    v_created_form := true;
  end if;

  v_master_id := public.resolve_sellertray_master_agreement_version_id(now());
  if v_master_id is null then
    return jsonb_build_object('status','master_agreement_missing','ready',false,'tenantId',p_tenant_id,'commercialOrderId',p_commercial_order_id,'installmentObligationId',p_installment_obligation_id,'orderFormId',v_form.id,'orderFormCreated',v_created_form,'agreementPackageId',null,'masterAgreementVersionId',null);
  end if;
  select p.* into v_package from public.sellertray_agreement_packages p where p.tenant_id=p_tenant_id and p.master_agreement_version_id=v_master_id and p.order_form_id=v_form.id;
  if not found then
    perform public.create_sellertray_agreement_package(p_tenant_id,v_form.id,v_master_id);
    select p.* into strict v_package from public.sellertray_agreement_packages p where p.tenant_id=p_tenant_id and p.master_agreement_version_id=v_master_id and p.order_form_id=v_form.id;
    v_created_package := true;
  end if;
  return jsonb_build_object('status','ready_for_review','ready',true,'tenantId',p_tenant_id,'commercialOrderId',p_commercial_order_id,'installmentObligationId',p_installment_obligation_id,'orderFormId',v_form.id,'orderFormCreated',v_created_form,'agreementPackageId',v_package.id,'agreementPackageCreated',v_created_package,'masterAgreementVersionId',v_master_id,'packageFingerprint',v_package.package_fingerprint);
end;
$$;

comment on function public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid) is
  'Zero-touch Agreement Package orchestration. Production merchant Order Forms resolve only from explicitly production-authorized immutable templates; legacy/QA current forms fail closed without mutation.';

-- OA5C v3 remains read-only evidence. Add exact template provenance as a mandatory
-- package gate and make malformed merchant authority evidence fail closed rather
-- than throwing a boolean-cast exception.
create or replace function public.platform_admin_verify_oa5c_production_test_business_proof(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_commercial_order_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_core jsonb;
  v_current_master_id uuid;
  v_current_master_hash text;

  v_order_form_count integer := 0;
  v_order_form public.sellertray_commercial_order_forms%rowtype;
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_expected_family text;
  v_order_form_template_authorized boolean := false;
  v_package_count integer := 0;
  v_package public.sellertray_agreement_packages%rowtype;
  v_confirmation_count integer := 0;
  v_confirmation public.sellertray_order_form_confirmations%rowtype;

  v_manifest_fingerprint text;
  v_order_form_ok boolean := false;
  v_manifest_ok boolean := false;
  v_confirmation_ok boolean := false;
  v_package_immutable_contracts_ok boolean := false;
  v_agreement_package_ok boolean := false;
  v_automated_evidence_passed boolean := false;
  v_gates jsonb;
begin
  v_core := public.platform_admin_verify_oa5c_real_merchant_proof(
    p_actor_user_id,
    p_tenant_id,
    p_commercial_order_id
  );

  v_current_master_id := public.resolve_sellertray_master_agreement_version_id(now());
  if v_current_master_id is not null then
    select m.content_sha256
      into v_current_master_hash
    from public.sellertray_master_agreement_versions m
    where m.id=v_current_master_id;
  end if;

  select count(*)::integer
    into v_order_form_count
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id
    and f.commercial_order_id=p_commercial_order_id
    and not exists (
      select 1
      from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=f.tenant_id
        and replacement.supersedes_order_form_id=f.id
    );

  select f.*
    into v_order_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id
    and f.commercial_order_id=p_commercial_order_id
    and not exists (
      select 1
      from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=f.tenant_id
        and replacement.supersedes_order_form_id=f.id
    )
  order by f.issued_at desc,f.id desc
  limit 1;

  v_order_form_ok := v_order_form_count=1
    and v_order_form.id is not null
    and v_order_form.tenant_id=p_tenant_id
    and v_order_form.commercial_order_id=p_commercial_order_id
    and nullif(btrim(v_order_form.order_form_reference),'') is not null
    and nullif(btrim(v_order_form.rendered_content),'') is not null
    and v_order_form.commercial_snapshot<>'{}'::jsonb
    and v_order_form.template_content_sha256 ~ '^[0-9a-f]{64}$'
    and v_order_form.commercial_snapshot_sha256 ~ '^[0-9a-f]{64}$'
    and v_order_form.content_sha256 ~ '^[0-9a-f]{64}$';

  if v_order_form.id is not null then
    v_expected_family:=case when v_order_form.installment_obligation_id is null
      then 'subscription_order' else 'installment_agreement' end;

    select t.* into v_template
    from public.sellertray_commercial_agreement_template_versions t
    where t.id=v_order_form.order_form_template_version_id;

    v_order_form_template_authorized := found
      and v_template.agreement_family=v_expected_family
      and v_template.publication_scope='production'
      and v_template.production_authorized_at is not null
      and v_template.production_authorized_by_user_id is not null
      and nullif(btrim(v_template.production_authorization_reason),'') is not null
      and v_template.effective_from<=v_order_form.issued_at
      and v_template.production_authorized_at<=v_order_form.issued_at
      and v_template.version_code=v_order_form.template_version_code
      and v_template.content_sha256=v_order_form.template_content_sha256;
  end if;

  if v_order_form_ok and v_order_form_template_authorized and v_current_master_id is not null then
    select count(*)::integer
      into v_package_count
    from public.sellertray_agreement_packages p
    where p.tenant_id=p_tenant_id
      and p.commercial_order_id=p_commercial_order_id
      and p.master_agreement_version_id=v_current_master_id
      and p.order_form_id=v_order_form.id;

    select p.*
      into v_package
    from public.sellertray_agreement_packages p
    where p.tenant_id=p_tenant_id
      and p.commercial_order_id=p_commercial_order_id
      and p.master_agreement_version_id=v_current_master_id
      and p.order_form_id=v_order_form.id
    order by p.created_at desc,p.id desc
    limit 1;

    if v_package.id is not null then
      v_manifest_fingerprint := encode(
        extensions.digest(convert_to(v_package.manifest::text,'UTF8'),'sha256'),
        'hex'
      );

      v_manifest_ok := v_package_count=1
        and v_package.master_content_sha256=v_current_master_hash
        and v_package.order_form_content_sha256=v_order_form.content_sha256
        and v_package.order_form_commercial_snapshot_sha256=v_order_form.commercial_snapshot_sha256
        and v_package.manifest_schema_version=1
        and v_package.package_fingerprint=v_manifest_fingerprint
        and v_package.manifest#>>'{schemaVersion}'='1'
        and v_package.manifest#>>'{tenantId}'=p_tenant_id::text
        and v_package.manifest#>>'{commercialOrderId}'=p_commercial_order_id::text
        and v_package.manifest#>>'{masterAgreement,versionId}'=v_current_master_id::text
        and v_package.manifest#>>'{masterAgreement,contentSha256}'=v_current_master_hash
        and v_package.manifest#>>'{orderForm,id}'=v_order_form.id::text
        and v_package.manifest#>>'{orderForm,reference}'=v_order_form.order_form_reference
        and v_package.manifest#>>'{orderForm,contentSha256}'=v_order_form.content_sha256
        and v_package.manifest#>>'{orderForm,commercialSnapshotSha256}'=v_order_form.commercial_snapshot_sha256;

      select count(*)::integer
        into v_confirmation_count
      from public.sellertray_order_form_confirmations c
      where c.tenant_id=p_tenant_id
        and c.order_form_id=v_order_form.id
        and c.agreement_package_id=v_package.id;

      select c.*
        into v_confirmation
      from public.sellertray_order_form_confirmations c
      where c.tenant_id=p_tenant_id
        and c.order_form_id=v_order_form.id
        and c.agreement_package_id=v_package.id
      order by c.confirmed_at desc,c.id desc
      limit 1;

      v_confirmation_ok := v_confirmation_count=1
        and v_confirmation.id is not null
        and v_confirmation.confirmed_by_user_id is not null
        and v_confirmation.confirmed_role in ('owner','manager')
        and nullif(btrim(v_confirmation.confirmed_legal_name),'') is not null
        and v_confirmation.confirmation_method='merchant_web_authenticated'
        and v_confirmation.request_evidence<>'{}'::jsonb
        and coalesce(v_confirmation.request_evidence->>'authority_confirmed','')='true'
        and v_confirmation.command_id is not null
        and v_confirmation.order_form_content_sha256=v_order_form.content_sha256
        and v_confirmation.package_fingerprint=v_package.package_fingerprint
        and v_confirmation.request_evidence->>'acceptance_component'='order_form_confirmation'
        and v_confirmation.request_evidence->>'master_agreement_version_id'=v_current_master_id::text
        and v_confirmation.request_evidence->>'agreement_package_id'=v_package.id::text
        and v_confirmation.request_evidence->>'package_fingerprint'=v_package.package_fingerprint;
    end if;
  end if;

  select count(*)=3
    into v_package_immutable_contracts_ok
  from (
    values
      ('sellertray_commercial_order_forms'::text),
      ('sellertray_agreement_packages'),
      ('sellertray_order_form_confirmations')
  ) expected(table_name)
  where exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname=expected.table_name
      and not t.tgisinternal
      and lower(pg_catalog.pg_get_triggerdef(t.oid)) like '%before%'
      and lower(pg_catalog.pg_get_triggerdef(t.oid)) like '%delete%'
      and lower(pg_catalog.pg_get_triggerdef(t.oid)) like '%update%'
  );

  v_agreement_package_ok := coalesce(
    v_order_form_ok
    and v_order_form_template_authorized
    and v_manifest_ok
    and v_confirmation_ok
    and v_package_immutable_contracts_ok,
    false
  );

  v_automated_evidence_passed := coalesce(
    (v_core->>'automatedEvidencePassed')::boolean
    and v_agreement_package_ok,
    false
  );

  v_gates := coalesce(v_core->'gates','{}'::jsonb)
    || jsonb_build_object(
      'agreementPackage',jsonb_build_object(
        'pass',v_agreement_package_ok,
        'currentMasterAgreementVersionId',v_current_master_id,
        'orderFormCount',v_order_form_count,
        'orderFormId',v_order_form.id,
        'orderFormReference',v_order_form.order_form_reference,
        'orderFormIntegrityValid',v_order_form_ok,
        'orderFormTemplateVersionId',v_order_form.order_form_template_version_id,
        'orderFormTemplatePublicationScope',v_template.publication_scope,
        'orderFormTemplateProductionAuthorizedAt',v_template.production_authorized_at,
        'orderFormTemplateProductionAuthorizedByUserId',v_template.production_authorized_by_user_id,
        'orderFormTemplateProductionAuthorized',v_order_form_template_authorized,
        'agreementPackageCount',v_package_count,
        'agreementPackageId',v_package.id,
        'packageFingerprint',v_package.package_fingerprint,
        'manifestIntegrityValid',v_manifest_ok,
        'orderFormConfirmationCount',v_confirmation_count,
        'orderFormConfirmationId',v_confirmation.id,
        'confirmationMethod',v_confirmation.confirmation_method,
        'confirmationIntegrityValid',v_confirmation_ok,
        'immutableHistoryContractsValid',v_package_immutable_contracts_ok
      )
    );

  return (
    v_core
      - 'proofVersion'
      - 'generatedAt'
      - 'automatedEvidencePassed'
      - 'acceptancePolicy'
      - 'gates'
      - 'remainingAcceptanceProof'
  ) || jsonb_build_object(
    'proofVersion','oa5c-v3',
    'generatedAt',now(),
    'automatedEvidencePassed',v_automated_evidence_passed,
    'oa5cAccepted',false,
    'proofSubject',jsonb_build_object(
      'kind','disposable_production_test_business',
      'productionPathRequired',true,
      'businessMayBeDisposedAfterProof',true,
      'lifecycleEvidenceMustRemainGoverned',true
    ),
    'acceptancePolicy',jsonb_build_object(
      'disposableProductionTestBusinessRequired',true,
      'singleBranchDefault',true,
      'productionPathRequired',true,
      'authenticatedMerchantAgreementActionRequired',true,
      'productionAuthorizedOrderFormTemplateRequired',true,
      'supportedPaymentFlowRequired',true,
      'directDatabasePaymentInsertionForbidden',true,
      'fabricatedLifecycleEvidenceForbidden',true,
      'manualSurfaceObservationRequired',true,
      'note','The controlled Business may be disposable, but OA5C must traverse the real governed production path. Merchant Agreement/Order Form actions, supported payment confirmation, setup/readiness, entitlement and audit evidence must not be manufactured by code.'
    ),
    'gates',v_gates,
    'remainingAcceptanceProof',case
      when v_automated_evidence_passed then jsonb_build_array(
        'Confirm the subject is the designated disposable production-test Business used for this controlled production-path proof.',
        'Confirm the Master Agreement acceptance and exact Order Form confirmation were performed by an authorised merchant representative through the authenticated Merchant Web surface.',
        'Independently confirm settlement came through the supported payment flow as a genuine controlled/test payment and was not inserted directly into the database.',
        'Observe the same active commercial, agreement, setup and entitlement outcome in Merchant Web.',
        'Observe the same active runtime and governed lifecycle notifications in Mobile.',
        'Record the controlled OA5C acceptance decision before C2 starts.'
      )
      else jsonb_build_array(
        'Resolve every failed automated gate before performing the controlled merchant-side and cross-surface acceptance run.'
      )
    end
  );
end;
$$;

comment on function public.platform_admin_verify_oa5c_production_test_business_proof(uuid,uuid,uuid) is
  'OA5C v3 read-only controlled production-test Business verifier. Composes the v2 lifecycle gates with exact current Master Agreement, production-authorized Order Form provenance, Agreement Package manifest/fingerprint, immutable package-history contracts and authenticated Order Form confirmation evidence. Never writes lifecycle truth.';

commit;
