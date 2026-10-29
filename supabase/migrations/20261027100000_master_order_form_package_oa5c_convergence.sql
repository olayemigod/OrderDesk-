begin;

-- Converge the approved Master Agreement -> Order Form -> Agreement Package model
-- onto the current OA5C universal-Master authority. This is additive: the
-- existing universal Master Agreement tables and all legacy C1A agreement rows
-- remain unchanged.

alter table public.platform_admin_capability_grant_versions
  drop constraint if exists platform_admin_capability_code_check,
  add constraint platform_admin_capability_code_check
  check (capability_code = any (array[
    'admin.pricing.manage'::text,
    'admin.payments.reconcile'::text,
    'admin.installments.manage'::text,
    'admin.branch_setup.manage'::text,
    'admin.agreements.publish'::text,
    'admin.order_forms.issue'::text
  ]));

create table public.sellertray_commercial_order_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  installment_obligation_id uuid,
  order_form_template_version_id uuid not null references public.sellertray_commercial_agreement_template_versions(id) on delete restrict,
  template_version_code text not null,
  template_content_sha256 text not null,
  order_form_reference text not null,
  rendered_content text not null,
  commercial_snapshot jsonb not null,
  commercial_snapshot_sha256 text not null,
  content_sha256 text not null,
  supersedes_order_form_id uuid,
  issued_by_user_id uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,order_form_reference),
  constraint sellertray_order_forms_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_order_forms_installment_same_order
    foreign key (tenant_id,commercial_order_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,id) on delete restrict,
  constraint sellertray_order_forms_supersedes_same_tenant
    foreign key (tenant_id,supersedes_order_form_id)
    references public.sellertray_commercial_order_forms(tenant_id,id) on delete restrict,
  constraint sellertray_order_forms_template_version_check check (char_length(btrim(template_version_code)) between 1 and 64),
  constraint sellertray_order_forms_template_hash_check check (template_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_order_forms_reference_check check (char_length(btrim(order_form_reference)) between 1 and 128),
  constraint sellertray_order_forms_content_check check (char_length(rendered_content) between 1 and 300000),
  constraint sellertray_order_forms_snapshot_check check (jsonb_typeof(commercial_snapshot)='object'),
  constraint sellertray_order_forms_snapshot_hash_check check (commercial_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_order_forms_hash_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_order_forms_time_check check (issued_at <= created_at + interval '5 minutes')
);

create unique index sellertray_order_forms_supersedes_key
  on public.sellertray_commercial_order_forms(supersedes_order_form_id)
  where supersedes_order_form_id is not null;
create index sellertray_order_forms_order_idx
  on public.sellertray_commercial_order_forms(tenant_id,commercial_order_id,issued_at desc);
create index sellertray_order_forms_obligation_idx
  on public.sellertray_commercial_order_forms(tenant_id,installment_obligation_id)
  where installment_obligation_id is not null;
create index sellertray_order_forms_template_idx
  on public.sellertray_commercial_order_forms(order_form_template_version_id);
create index sellertray_order_forms_issuer_idx
  on public.sellertray_commercial_order_forms(issued_by_user_id);

create table public.sellertray_agreement_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  master_agreement_version_id uuid not null references public.sellertray_master_agreement_versions(id) on delete restrict,
  master_content_sha256 text not null,
  order_form_id uuid not null,
  order_form_content_sha256 text not null,
  order_form_commercial_snapshot_sha256 text not null,
  manifest_schema_version integer not null default 1,
  manifest jsonb not null,
  package_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,master_agreement_version_id,order_form_id),
  unique (package_fingerprint),
  constraint sellertray_agreement_packages_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_agreement_packages_form_same_tenant
    foreign key (tenant_id,order_form_id)
    references public.sellertray_commercial_order_forms(tenant_id,id) on delete restrict,
  constraint sellertray_agreement_packages_master_hash_check check (master_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_agreement_packages_form_hash_check check (order_form_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_agreement_packages_snapshot_hash_check check (order_form_commercial_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_agreement_packages_fingerprint_check check (package_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sellertray_agreement_packages_manifest_version_check check (manifest_schema_version=1),
  constraint sellertray_agreement_packages_manifest_check check (jsonb_typeof(manifest)='object')
);

create index sellertray_package_order_idx
  on public.sellertray_agreement_packages(tenant_id,commercial_order_id,created_at desc);
create index sellertray_package_order_form_idx
  on public.sellertray_agreement_packages(tenant_id,order_form_id);
create index sellertray_package_master_version_idx
  on public.sellertray_agreement_packages(master_agreement_version_id);

create table public.sellertray_order_form_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_form_id uuid not null,
  agreement_package_id uuid not null,
  order_form_content_sha256 text not null,
  package_fingerprint text not null,
  confirmed_by_user_id uuid not null references auth.users(id) on delete restrict,
  confirmed_legal_name text not null,
  confirmed_role text not null,
  confirmation_method text not null default 'merchant_web_authenticated',
  request_evidence jsonb not null default '{}'::jsonb,
  command_id uuid not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,order_form_id),
  unique (tenant_id,command_id),
  constraint sellertray_order_form_confirmations_form_same_tenant
    foreign key (tenant_id,order_form_id)
    references public.sellertray_commercial_order_forms(tenant_id,id) on delete restrict,
  constraint sellertray_order_form_confirmations_package_same_tenant
    foreign key (tenant_id,agreement_package_id)
    references public.sellertray_agreement_packages(tenant_id,id) on delete restrict,
  constraint sellertray_order_form_confirmations_hash_check check (order_form_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_order_form_confirmations_fingerprint_check check (package_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sellertray_order_form_confirmations_name_check check (char_length(btrim(confirmed_legal_name)) between 1 and 200),
  constraint sellertray_order_form_confirmations_role_check check (confirmed_role in ('owner','manager')),
  constraint sellertray_order_form_confirmations_method_check check (confirmation_method='merchant_web_authenticated'),
  constraint sellertray_order_form_confirmations_evidence_check check (jsonb_typeof(request_evidence)='object'),
  constraint sellertray_order_form_confirmations_time_check check (confirmed_at <= created_at + interval '5 minutes')
);

create index sellertray_order_form_confirmations_actor_idx
  on public.sellertray_order_form_confirmations(confirmed_by_user_id,confirmed_at desc);
create index sellertray_order_form_confirmations_package_idx
  on public.sellertray_order_form_confirmations(tenant_id,agreement_package_id);

create or replace function public.prepare_sellertray_commercial_order_form()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_previous public.sellertray_commercial_order_forms%rowtype;
  v_snapshot jsonb;
  v_document jsonb;
begin
  select t.* into strict v_template
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=new.order_form_template_version_id;

  if v_template.agreement_family not in ('subscription_order','installment_agreement') then
    raise exception 'Order Forms require a subscription-order or installment-agreement template' using errcode='23514';
  end if;
  if (v_template.agreement_family='installment_agreement')<>(new.installment_obligation_id is not null) then
    raise exception 'Installment Order Forms must bind the exact installment obligation' using errcode='23514';
  end if;

  v_snapshot := public.build_sellertray_commercial_agreement_snapshot(
    new.tenant_id,new.commercial_order_id,new.installment_obligation_id
  );

  new.template_version_code := v_template.version_code;
  new.template_content_sha256 := v_template.content_sha256;
  new.order_form_reference := btrim(new.order_form_reference);
  new.rendered_content := v_template.content_body;
  new.commercial_snapshot := v_snapshot;
  new.commercial_snapshot_sha256 := encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  v_document := jsonb_build_object(
    'schemaVersion',1,
    'reference',new.order_form_reference,
    'template',jsonb_build_object(
      'versionId',v_template.id,
      'versionCode',v_template.version_code,
      'contentSha256',v_template.content_sha256
    ),
    'commercialSnapshot',v_snapshot
  );
  new.content_sha256 := encode(extensions.digest(convert_to(v_document::text,'UTF8'),'sha256'),'hex');
  new.issued_at := coalesce(new.issued_at,now());
  new.created_at := coalesce(new.created_at,now());

  if v_template.effective_from>new.issued_at then
    raise exception 'Order Form template is not effective at the issue time' using errcode='23514';
  end if;

  if new.supersedes_order_form_id is not null then
    select f.* into strict v_previous
    from public.sellertray_commercial_order_forms f
    where f.tenant_id=new.tenant_id and f.id=new.supersedes_order_form_id
    for share;
    if v_previous.commercial_order_id<>new.commercial_order_id
       or v_previous.installment_obligation_id is distinct from new.installment_obligation_id then
      raise exception 'Replacement Order Form must preserve the original commercial subject' using errcode='23514';
    end if;
    if exists (
      select 1 from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=new.tenant_id and replacement.supersedes_order_form_id=v_previous.id
    ) then
      raise exception 'The selected Order Form has already been superseded' using errcode='23505';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_sellertray_commercial_order_form() from public,anon,authenticated;
create trigger prepare_sellertray_commercial_order_form
before insert on public.sellertray_commercial_order_forms
for each row execute function public.prepare_sellertray_commercial_order_form();

create or replace function public.prepare_sellertray_agreement_package()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_master public.sellertray_master_agreement_versions%rowtype;
begin
  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=new.tenant_id and f.id=new.order_form_id;
  select m.* into strict v_master
  from public.sellertray_master_agreement_versions m
  where m.id=new.master_agreement_version_id;

  new.commercial_order_id := v_form.commercial_order_id;
  new.master_content_sha256 := v_master.content_sha256;
  new.order_form_content_sha256 := v_form.content_sha256;
  new.order_form_commercial_snapshot_sha256 := v_form.commercial_snapshot_sha256;
  new.manifest_schema_version := 1;
  new.manifest := jsonb_build_object(
    'schemaVersion',1,
    'tenantId',new.tenant_id,
    'commercialOrderId',v_form.commercial_order_id,
    'masterAgreement',jsonb_build_object(
      'versionId',v_master.id,
      'versionCode',v_master.version_code,
      'contentSha256',v_master.content_sha256
    ),
    'orderForm',jsonb_build_object(
      'id',v_form.id,
      'reference',v_form.order_form_reference,
      'templateVersionId',v_form.order_form_template_version_id,
      'templateVersionCode',v_form.template_version_code,
      'contentSha256',v_form.content_sha256,
      'commercialSnapshotSha256',v_form.commercial_snapshot_sha256
    )
  );
  new.package_fingerprint := encode(extensions.digest(convert_to(new.manifest::text,'UTF8'),'sha256'),'hex');
  new.created_at := coalesce(new.created_at,now());
  return new;
end;
$$;
revoke all on function public.prepare_sellertray_agreement_package() from public,anon,authenticated;
create trigger prepare_sellertray_agreement_package
before insert on public.sellertray_agreement_packages
for each row execute function public.prepare_sellertray_agreement_package();

create or replace function public.prepare_sellertray_order_form_confirmation()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare v_package public.sellertray_agreement_packages%rowtype;
begin
  select p.* into strict v_package
  from public.sellertray_agreement_packages p
  where p.tenant_id=new.tenant_id and p.id=new.agreement_package_id;
  if v_package.order_form_id<>new.order_form_id then
    raise exception 'Order Form confirmation must bind its exact Agreement Package' using errcode='23514';
  end if;
  new.order_form_content_sha256 := v_package.order_form_content_sha256;
  new.package_fingerprint := v_package.package_fingerprint;
  new.confirmed_legal_name := btrim(new.confirmed_legal_name);
  new.confirmed_at := coalesce(new.confirmed_at,now());
  new.created_at := coalesce(new.created_at,now());
  return new;
end;
$$;
revoke all on function public.prepare_sellertray_order_form_confirmation() from public,anon,authenticated;
create trigger prepare_sellertray_order_form_confirmation
before insert on public.sellertray_order_form_confirmations
for each row execute function public.prepare_sellertray_order_form_confirmation();

create trigger prevent_sellertray_commercial_order_form_mutation
before update or delete on public.sellertray_commercial_order_forms
for each row execute function public.prevent_sellertray_commercial_history_mutation();
create trigger prevent_sellertray_agreement_package_mutation
before update or delete on public.sellertray_agreement_packages
for each row execute function public.prevent_sellertray_commercial_history_mutation();
create trigger prevent_sellertray_order_form_confirmation_mutation
before update or delete on public.sellertray_order_form_confirmations
for each row execute function public.prevent_sellertray_commercial_history_mutation();

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
  v_reference text := btrim(coalesce(p_order_form_reference,''));
  v_reason text := btrim(coalesce(p_reason,''));
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
    'orderFormReference',v_reference,
    'supersedesOrderFormId',p_supersedes_order_form_id,
    'reason',v_reason
  ));
  return v_id;
end;
$$;
revoke all on function public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,uuid,text,uuid)
  to service_role;

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
  v_master public.sellertray_master_agreement_versions%rowtype;
  v_id uuid;
begin
  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.id=p_order_form_id;
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
revoke all on function public.create_sellertray_agreement_package(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_sellertray_agreement_package(uuid,uuid,uuid) to service_role;

create or replace function public.confirm_sellertray_agreement_package(
  p_tenant_id uuid,
  p_order_form_id uuid,
  p_confirmed_legal_name text,
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
  v_role text;
  v_name text := btrim(coalesce(p_confirmed_legal_name,''));
  v_evidence jsonb := coalesce(p_request_evidence,'{}'::jsonb);
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_master public.sellertray_master_agreement_versions%rowtype;
  v_package public.sellertray_agreement_packages%rowtype;
  v_master_acceptance public.sellertray_master_agreement_acceptances%rowtype;
  v_confirmation public.sellertray_order_form_confirmations%rowtype;
  v_command_confirmation public.sellertray_order_form_confirmations%rowtype;
  v_master_acceptance_created boolean := false;
  v_master_id uuid;
begin
  if p_tenant_id is null or p_order_form_id is null or p_actor_user_id is null or p_command_id is null then
    raise exception 'Business, Order Form, representative and command are required' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 200 or jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Valid representative name and confirmation evidence are required' using errcode='22023';
  end if;
  if coalesce((v_evidence->>'authority_confirmed')::boolean,false) is not true then
    raise exception 'Confirm your authority before continuing' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sellertray-package-command:'||p_tenant_id::text||':'||p_command_id::text,0));

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role='owner' then null;
  elsif v_role='manager' and public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
  ) then null;
  else
    raise exception 'You are not authorised to confirm SellerTray purchases' using errcode='42501';
  end if;

  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.id=p_order_form_id
  for share;
  if exists (
    select 1 from public.sellertray_commercial_order_forms replacement
    where replacement.tenant_id=p_tenant_id and replacement.supersedes_order_form_id=v_form.id
  ) then
    raise exception 'This Order Form has been replaced and cannot be confirmed' using errcode='23514';
  end if;

  v_master_id := public.resolve_sellertray_master_agreement_version_id(now());
  if v_master_id is null then
    raise exception 'SellerTray Master Agreement is not yet published' using errcode='23514';
  end if;
  select m.* into strict v_master
  from public.sellertray_master_agreement_versions m
  where m.id=v_master_id;

  perform public.create_sellertray_agreement_package(p_tenant_id,v_form.id,v_master.id);
  select p.* into strict v_package
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id
    and p.master_agreement_version_id=v_master.id
    and p.order_form_id=v_form.id;

  select a.* into v_master_acceptance
  from public.sellertray_master_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.agreement_version_id=v_master.id;
  if not found then
    perform public.accept_sellertray_master_agreement(
      p_tenant_id,
      v_master.id,
      v_name,
      v_evidence || jsonb_build_object(
        'acceptance_component','master_agreement',
        'agreement_package_id',v_package.id,
        'package_fingerprint',v_package.package_fingerprint,
        'order_form_id',v_form.id,
        'order_form_content_sha256',v_form.content_sha256
      ),
      p_command_id,
      p_actor_user_id
    );
    v_master_acceptance_created := true;
    select a.* into strict v_master_acceptance
    from public.sellertray_master_agreement_acceptances a
    where a.tenant_id=p_tenant_id and a.agreement_version_id=v_master.id;
  end if;

  select c.* into v_command_confirmation
  from public.sellertray_order_form_confirmations c
  where c.tenant_id=p_tenant_id and c.command_id=p_command_id;
  if found and v_command_confirmation.order_form_id<>v_form.id then
    raise exception 'Purchase confirmation command is already used for a different Order Form' using errcode='23505';
  end if;

  select c.* into v_confirmation
  from public.sellertray_order_form_confirmations c
  where c.tenant_id=p_tenant_id and c.order_form_id=v_form.id;

  if not found then
    insert into public.sellertray_order_form_confirmations(
      tenant_id,order_form_id,agreement_package_id,order_form_content_sha256,package_fingerprint,
      confirmed_by_user_id,confirmed_legal_name,confirmed_role,confirmation_method,
      request_evidence,command_id
    ) values (
      p_tenant_id,v_form.id,v_package.id,v_form.content_sha256,v_package.package_fingerprint,
      p_actor_user_id,v_name,v_role,'merchant_web_authenticated',
      v_evidence || jsonb_build_object(
        'acceptance_component','order_form_confirmation',
        'master_agreement_version_id',v_master.id,
        'agreement_package_id',v_package.id,
        'package_fingerprint',v_package.package_fingerprint
      ),
      p_command_id
    ) returning * into v_confirmation;
  elsif v_command_confirmation.id is not null and (
    v_confirmation.id<>v_command_confirmation.id
    or v_confirmation.confirmed_by_user_id<>p_actor_user_id
    or v_confirmation.confirmed_legal_name<>v_name
    or v_confirmation.confirmed_role<>v_role
  ) then
    raise exception 'Purchase confirmation command is already used for different facts' using errcode='23505';
  end if;

  return jsonb_build_object(
    'masterAcceptanceId',v_master_acceptance.id,
    'masterAcceptanceCreated',v_master_acceptance_created,
    'orderFormConfirmationId',v_confirmation.id,
    'orderFormConfirmationCreated',v_confirmation.command_id=p_command_id,
    'agreementPackageId',v_package.id,
    'packageFingerprint',v_package.package_fingerprint,
    'masterAgreementVersionId',v_master.id,
    'orderFormId',v_form.id
  );
end;
$$;
revoke all on function public.confirm_sellertray_agreement_package(uuid,uuid,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_agreement_package(uuid,uuid,text,jsonb,uuid,uuid)
  to service_role;

create or replace function public.get_sellertray_agreement_package_center(
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
  v_forms jsonb;
  v_legacy jsonb;
begin
  v_master := public.get_sellertray_master_agreement_center(p_tenant_id,p_actor_user_id);

  select coalesce(jsonb_agg(row_value order by is_current desc,issued_at desc,form_id),'[]'::jsonb)
  into v_forms
  from (
    select f.id form_id,f.issued_at,
      not exists (
        select 1 from public.sellertray_commercial_order_forms r
        where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id
      ) is_current,
      jsonb_build_object(
        'id',f.id,
        'reference',f.order_form_reference,
        'title',t.title,
        'templateVersion',f.template_version_code,
        'templateContentSha256',f.template_content_sha256,
        'renderedContent',f.rendered_content,
        'contentSha256',f.content_sha256,
        'commercialSnapshot',f.commercial_snapshot,
        'commercialSnapshotSha256',f.commercial_snapshot_sha256,
        'commercialOrderId',f.commercial_order_id,
        'installmentObligationId',f.installment_obligation_id,
        'supersedesOrderFormId',f.supersedes_order_form_id,
        'isCurrent',not exists (
          select 1 from public.sellertray_commercial_order_forms r
          where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id
        ),
        'issuedAt',f.issued_at,
        'confirmation',case when c.id is null then null else jsonb_build_object(
          'id',c.id,
          'confirmedAt',c.confirmed_at,
          'confirmedLegalName',c.confirmed_legal_name,
          'confirmedRole',c.confirmed_role,
          'confirmedByCurrentUser',c.confirmed_by_user_id=p_actor_user_id,
          'packageFingerprint',c.package_fingerprint
        ) end
      ) row_value
    from public.sellertray_commercial_order_forms f
    join public.sellertray_commercial_agreement_template_versions t
      on t.id=f.order_form_template_version_id
    left join public.sellertray_order_form_confirmations c
      on c.tenant_id=f.tenant_id and c.order_form_id=f.id
    where f.tenant_id=p_tenant_id
  ) projected;

  v_legacy := public.get_sellertray_commercial_agreement_center(p_tenant_id,p_actor_user_id)->'agreements';

  return v_master || jsonb_build_object(
    'masterAgreement',case when v_master->'currentVersion' is null then null else
      (v_master->'currentVersion') || jsonb_build_object('acceptance',v_master->'acceptance') end,
    'masterAcceptanceRequired',coalesce((v_master->>'acceptanceRequired')::boolean,false),
    'orderForms',v_forms,
    'legacyAgreements',coalesce(v_legacy,'[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_sellertray_agreement_package_center(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_agreement_package_center(uuid,uuid) to service_role;

create or replace function public.get_sellertray_order_forms_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_master jsonb;
  v_forms jsonb;
  v_can_issue boolean;
begin
  v_master := public.get_sellertray_master_agreement_admin(p_actor_user_id,p_tenant_id);
  v_can_issue := p_tenant_id is not null and public.platform_admin_has_capability(
    p_actor_user_id,'admin.order_forms.issue',p_tenant_id,now()
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,
    'reference',f.order_form_reference,
    'commercialOrderId',f.commercial_order_id,
    'installmentObligationId',f.installment_obligation_id,
    'templateVersionId',f.order_form_template_version_id,
    'templateVersionCode',f.template_version_code,
    'contentSha256',f.content_sha256,
    'commercialSnapshotSha256',f.commercial_snapshot_sha256,
    'supersedesOrderFormId',f.supersedes_order_form_id,
    'issuedAt',f.issued_at,
    'confirmed',c.id is not null,
    'confirmedAt',c.confirmed_at,
    'packageFingerprint',c.package_fingerprint
  ) order by f.issued_at desc,f.id desc),'[]'::jsonb)
  into v_forms
  from public.sellertray_commercial_order_forms f
  left join public.sellertray_order_form_confirmations c
    on c.tenant_id=f.tenant_id and c.order_form_id=f.id
  where p_tenant_id is not null and f.tenant_id=p_tenant_id;

  return v_master || jsonb_build_object(
    'canIssueOrderForms',v_can_issue,
    'orderForms',v_forms
  );
end;
$$;
revoke all on function public.get_sellertray_order_forms_admin(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_order_forms_admin(uuid,uuid) to service_role;

create or replace function public.sellertray_installment_contract_accepted_at(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns timestamptz
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_has_current_order_form boolean:=false;
  v_order_form_confirmed_at timestamptz;
  v_master_accepted_at timestamptz;
  v_legacy_accepted_at timestamptz;
begin
  select exists (
    select 1
    from public.sellertray_commercial_order_forms f
    where f.tenant_id=p_tenant_id
      and f.commercial_order_id=p_commercial_order_id
      and f.installment_obligation_id is not distinct from p_installment_obligation_id
      and not exists (
        select 1 from public.sellertray_commercial_order_forms r
        where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id
      )
  ) into v_has_current_order_form;

  if v_has_current_order_form then
    select c.confirmed_at into v_order_form_confirmed_at
    from public.sellertray_commercial_order_forms f
    join public.sellertray_order_form_confirmations c
      on c.tenant_id=f.tenant_id and c.order_form_id=f.id
    where f.tenant_id=p_tenant_id
      and f.commercial_order_id=p_commercial_order_id
      and f.installment_obligation_id is not distinct from p_installment_obligation_id
      and not exists (
        select 1 from public.sellertray_commercial_order_forms r
        where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id
      )
    order by c.confirmed_at desc
    limit 1;

    v_master_accepted_at := public.sellertray_master_agreement_accepted_at(p_tenant_id,now());
    if v_order_form_confirmed_at is null or v_master_accepted_at is null then
      return null;
    end if;
    return greatest(v_order_form_confirmed_at,v_master_accepted_at);
  end if;

  select ac.accepted_at into v_legacy_accepted_at
  from public.sellertray_commercial_agreements a
  join public.sellertray_commercial_agreement_acceptances ac
    on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
  where a.tenant_id=p_tenant_id
    and a.commercial_order_id=p_commercial_order_id
    and a.installment_obligation_id=p_installment_obligation_id
    and a.agreement_family='installment_agreement'
    and not exists (
      select 1 from public.sellertray_commercial_agreements r
      where r.tenant_id=a.tenant_id and r.supersedes_agreement_id=a.id
    )
  order by ac.accepted_at desc
  limit 1;
  return v_legacy_accepted_at;
end;
$$;
revoke all on function public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellertray_installment_contract_accepted_at(uuid,uuid,uuid) to service_role;

create or replace function public.sellertray_installment_agreement_is_accepted(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.sellertray_installment_contract_accepted_at(
    p_tenant_id,p_commercial_order_id,p_installment_obligation_id
  ) is not null
$$;
revoke all on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid) to service_role;

create or replace function public.reconcile_sellertray_installment_entitlement(
  p_tenant_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_snapshot public.sellertray_installment_contract_snapshots%rowtype;
  v_subscription public.tenant_subscriptions%rowtype;
  v_existing_provisional public.sellertray_commercial_entitlement_events%rowtype;
  v_existing_full public.sellertray_commercial_entitlement_events%rowtype;
  v_plan_code text;
  v_billing_cycle text;
  v_agreement_accepted_at timestamptz;
  v_setup_required integer:=0;
  v_setup_ready integer:=0;
  v_setup_ready_at timestamptz;
  v_settlement jsonb;
  v_qualifying_settled boolean:=false;
  v_fully_settled boolean:=false;
  v_settlement_at timestamptz;
  v_activation_at timestamptz;
  v_provisional_until timestamptz;
  v_full_until timestamptz;
  v_provisional_id uuid;
  v_full_id uuid;
  v_runtime_owned boolean:=false;
begin
  perform public.lock_sellertray_commercial_order(io.tenant_id,io.commercial_order_id)
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.id=p_installment_obligation_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;
  select s.* into strict v_snapshot
  from public.sellertray_installment_contract_snapshots s
  where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;
  select s.plan_code,s.billing_cycle into strict v_plan_code,v_billing_cycle
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='subscription';

  v_agreement_accepted_at:=public.sellertray_installment_contract_accepted_at(
    p_tenant_id,v_order.id,v_obligation.id
  );
  select count(*)::integer,count(r.id)::integer,max(r.ready_at)
  into v_setup_required,v_setup_ready,v_setup_ready_at
  from public.sellertray_commercial_order_price_snapshots s
  left join public.sellertray_commercial_branch_setup_readiness r
    on r.tenant_id=s.tenant_id and r.commercial_order_id=s.commercial_order_id and r.branch_id=s.branch_id
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='branch_setup';

  v_settlement:=public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  v_fully_settled:=coalesce((v_settlement->>'outstandingAmount')::numeric,0)<0.005;
  select coalesce(bool_and((x->>'remainingAmount')::numeric<0.005),false)
  into v_qualifying_settled
  from jsonb_array_elements(coalesce(v_settlement->'schedule','[]'::jsonb)) x
  where (x->>'sequenceNo')::integer<=v_snapshot.qualifying_settlement_sequence;
  select max(event_at) into v_settlement_at
  from (
    select a.approved_at event_at from public.sellertray_commercial_adjustments a
      where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order.id
    union all
    select pc.paid_at from public.sellertray_commercial_installment_payment_confirmations pc
      where pc.tenant_id=p_tenant_id and pc.commercial_order_id=v_order.id
    union all
    select dp.paid_at from public.sellertray_commercial_direct_payment_confirmations dp
      where dp.tenant_id=p_tenant_id and dp.commercial_order_id=v_order.id
  ) settlement_fact;
  select e.* into v_existing_provisional
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.provisional_activated'
  order by e.recorded_at desc limit 1;
  select e.* into v_existing_full
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id
    and e.event_type='installment.full_entitlement_released'
  order by e.recorded_at desc limit 1;

  if v_agreement_accepted_at is null
     or v_setup_required=0
     or v_setup_ready<v_setup_required
     or not v_qualifying_settled
     or v_settlement_at is null then
    return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
  end if;

  if v_existing_provisional.id is not null then
    v_activation_at:=v_existing_provisional.effective_from;
    v_provisional_id:=v_existing_provisional.id;
  else
    v_activation_at:=greatest(
      v_agreement_accepted_at,
      coalesce(v_setup_ready_at,v_agreement_accepted_at),
      v_settlement_at
    );
  end if;

  if v_billing_cycle='monthly' then
    v_full_until:=v_activation_at+interval '1 month';
  elsif v_billing_cycle='yearly' then
    v_full_until:=v_activation_at+interval '12 months';
  else
    raise exception 'Unsupported SellerTray billing cycle for entitlement reconciliation' using errcode='23514';
  end if;

  if v_snapshot.provisional_entitlement_months>0 then
    v_provisional_until:=least(
      v_activation_at+make_interval(months=>v_snapshot.provisional_entitlement_months),v_full_until
    );
    if v_existing_provisional.id is null then
      v_provisional_id:=public.append_sellertray_commercial_entitlement_event(
        p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
        'installment.provisional_activated','oa2:provisional:'||v_obligation.id::text,
        v_activation_at,v_provisional_until,
        jsonb_build_object(
          'template_code',v_snapshot.template_code,
          'template_version',v_snapshot.template_version,
          'provisional_months',v_snapshot.provisional_entitlement_months,
          'qualifying_settlement_sequence',v_snapshot.qualifying_settlement_sequence,
          'activation_at',v_activation_at,
          'full_term_until',v_full_until,
          'master_agreement_version_id',public.resolve_sellertray_master_agreement_version_id(v_activation_at)
        ),
        null,'Governed SellerTray installment provisional entitlement'
      );
    end if;
  elsif not v_fully_settled then
    return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
  end if;

  if v_fully_settled then
    if v_existing_full.id is not null then
      v_full_id:=v_existing_full.id;
    else
      v_full_id:=public.append_sellertray_commercial_entitlement_event(
        p_tenant_id,v_plan_code,v_order.id,v_obligation.id,
        'installment.full_entitlement_released','oa2:full:'||v_obligation.id::text,
        v_activation_at,v_full_until,
        jsonb_build_object(
          'template_code',v_snapshot.template_code,
          'template_version',v_snapshot.template_version,
          'billing_cycle',v_billing_cycle,
          'activation_at',v_activation_at,
          'settled_amount',v_settlement->>'netAmountDue',
          'master_agreement_version_id',public.resolve_sellertray_master_agreement_version_id(now())
        ),
        null,'Governed SellerTray full-settlement entitlement release'
      );
    end if;
  end if;

  select s.* into strict v_subscription
  from public.tenant_subscriptions s
  where s.tenant_id=p_tenant_id
  for update;
  if v_subscription.current_period_start is not null and v_subscription.current_period_end is not null then
    select exists(
      select 1 from public.sellertray_commercial_entitlement_events e
      where e.tenant_id=p_tenant_id
        and e.commercial_order_id=v_order.id
        and e.effective_from=v_subscription.current_period_start
        and e.effective_until=v_subscription.current_period_end
        and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')
    ) into v_runtime_owned;
  end if;
  if v_subscription.status<>'trial' and not v_runtime_owned
     and (v_subscription.current_period_start is not null
       or v_subscription.current_period_end is not null
       or v_subscription.status<>'active') then
    raise exception 'Existing SellerTray runtime subscription is not owned by this commercial installment order'
      using errcode='23505';
  end if;

  update public.tenant_subscriptions
  set plan_code=v_plan_code,
      status='active',
      current_period_start=v_activation_at,
      current_period_end=case when v_full_id is not null then v_full_until else v_provisional_until end,
      grace_ends_at=null,
      cancel_at_period_end=false,
      updated_at=now()
  where tenant_id=p_tenant_id;
  return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
end;
$$;

alter table public.sellertray_commercial_order_forms enable row level security;
alter table public.sellertray_agreement_packages enable row level security;
alter table public.sellertray_order_form_confirmations enable row level security;
revoke all on table public.sellertray_commercial_order_forms from public,anon,authenticated;
revoke all on table public.sellertray_agreement_packages from public,anon,authenticated;
revoke all on table public.sellertray_order_form_confirmations from public,anon,authenticated;
grant all on table public.sellertray_commercial_order_forms to service_role;
grant all on table public.sellertray_agreement_packages to service_role;
grant all on table public.sellertray_order_form_confirmations to service_role;

commit;
