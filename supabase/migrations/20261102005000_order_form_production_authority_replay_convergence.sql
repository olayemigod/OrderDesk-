begin;

-- Forward-only replay convergence for the hosted Order Form production-authority
-- contract. Production already carries this authority from the governed hosted
-- lineage; the active repository history lost the creating migration. Keep existing
-- installations unchanged while making a clean-schema replay equivalent to the
-- hosted contract before the OA5C v3 verifier is installed.

alter table public.sellertray_commercial_agreement_template_versions
  add column if not exists publication_scope text not null default 'qa',
  add column if not exists production_authorized_at timestamptz,
  add column if not exists production_authorized_by_user_id uuid references auth.users(id) on delete restrict,
  add column if not exists production_authorization_reason text;

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid='public.sellertray_commercial_agreement_template_versions'::regclass
      and c.contype='c'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%publication_scope%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%qa%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%production%'
      and pg_catalog.pg_get_constraintdef(c.oid) not ilike '%production_authorization_reason%'
  ) then
    alter table public.sellertray_commercial_agreement_template_versions
      add constraint sellertray_commercial_agreement_template_publication_scope_check
      check (publication_scope in ('qa','production'));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid='public.sellertray_commercial_agreement_template_versions'::regclass
      and c.contype='c'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%publication_scope%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%production_authorized_at%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%production_authorized_by_user_id%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%production_authorization_reason%'
  ) then
    alter table public.sellertray_commercial_agreement_template_versions
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
  end if;
end;
$block$;

create index if not exists sellertray_commercial_agreement_template_production_resolution_idx
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

-- Mirror the current hosted publication command. Historical QA rows are never
-- promoted in place; production authority is minted only on a new immutable version.
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
as $function$
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
$function$;

comment on function public.publish_sellertray_order_form_template_admin(text,text,text,text,timestamptz,text,uuid) is
  'Governed Admin publication command for immutable production-authorized SellerTray Order Form template versions. Historical QA versions cannot be promoted in place.';

-- Mirror the current hosted manual issuance boundary. Manual issuance stays an
-- internal Admin command; zero-touch lifecycle orchestration uses the service-role
-- package orchestration boundary below.
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
as $function$
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
$function$;

comment on function public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,uuid,text,uuid) is
  'Governed Admin Order Form issuance. Production merchant Order Forms can only be issued from an explicitly production-authorized immutable template version of the correct compatibility family.';

-- Mirror the current hosted zero-touch authority used by the production lifecycle.
-- It selects only a production-authorized template and fails closed on a legacy QA
-- current form without rewriting immutable history.
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
as $function$
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
$function$;

comment on function public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid) is
  'Zero-touch Agreement Package orchestration. Production merchant Order Forms resolve only from explicitly production-authorized immutable templates; legacy/QA current forms fail closed without mutation.';

-- Preserve the hosted execution boundaries on clean replay.
revoke all on function public.publish_sellertray_order_form_template_admin(text,text,text,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_order_form_template_admin(text,text,text,text,timestamptz,text,uuid) to service_role;

revoke all on function public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,uuid,text,uuid) from public,anon,authenticated,service_role;

revoke all on function public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid) to service_role;

commit;
