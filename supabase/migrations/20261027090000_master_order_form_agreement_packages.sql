begin;

-- Active SellerTray contracting model:
-- immutable Master Agreement version -> immutable Order Form -> deterministic package.
-- The earlier C1A tables are deliberately not updated or backfilled. They remain
-- legacy evidence and are consumed by the compatibility branch at the end.

create table public.sellertray_master_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  master_agreement_version_id uuid not null references public.sellertray_commercial_agreement_template_versions(id) on delete restrict,
  master_version_code text not null,
  master_content_sha256 text not null,
  accepted_by_user_id uuid not null references auth.users(id) on delete restrict,
  accepted_legal_name text not null,
  accepted_role text not null,
  acceptance_method text not null,
  request_evidence jsonb not null default '{}'::jsonb,
  command_id uuid not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,master_agreement_version_id),
  unique (tenant_id,command_id),
  constraint sellertray_master_acceptance_version_check check (char_length(btrim(master_version_code)) between 1 and 64),
  constraint sellertray_master_acceptance_hash_check check (master_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_master_acceptance_name_check check (char_length(btrim(accepted_legal_name)) between 1 and 200),
  constraint sellertray_master_acceptance_role_check check (accepted_role in ('owner','manager')),
  constraint sellertray_master_acceptance_method_check check (acceptance_method='merchant_web_authenticated'),
  constraint sellertray_master_acceptance_evidence_check check (jsonb_typeof(request_evidence)='object'),
  constraint sellertray_master_acceptance_time_check check (accepted_at <= created_at + interval '5 minutes')
);

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
  content_sha256 text not null,
  commercial_snapshot jsonb not null,
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
  constraint sellertray_order_forms_hash_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_order_forms_snapshot_check check (jsonb_typeof(commercial_snapshot)='object'),
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
create index sellertray_order_forms_installment_order_fk_idx
  on public.sellertray_commercial_order_forms(tenant_id,commercial_order_id,installment_obligation_id)
  where installment_obligation_id is not null;
create index sellertray_order_forms_supersedes_tenant_fk_idx
  on public.sellertray_commercial_order_forms(tenant_id,supersedes_order_form_id)
  where supersedes_order_form_id is not null;
create index sellertray_order_forms_template_idx
  on public.sellertray_commercial_order_forms(order_form_template_version_id);
create index sellertray_order_forms_issuer_idx
  on public.sellertray_commercial_order_forms(issued_by_user_id);

create table public.sellertray_agreement_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  master_agreement_version_id uuid not null references public.sellertray_commercial_agreement_template_versions(id) on delete restrict,
  master_content_sha256 text not null,
  order_form_id uuid not null,
  order_form_content_sha256 text not null,
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
  constraint sellertray_agreement_packages_fingerprint_check check (package_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sellertray_agreement_packages_manifest_version_check check (manifest_schema_version=1),
  constraint sellertray_agreement_packages_manifest_check check (jsonb_typeof(manifest)='object')
);

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
  confirmation_method text not null,
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

create index sellertray_master_acceptances_actor_idx
  on public.sellertray_master_agreement_acceptances(accepted_by_user_id,accepted_at desc);
create index sellertray_master_acceptances_version_idx
  on public.sellertray_master_agreement_acceptances(master_agreement_version_id);
create index sellertray_package_order_idx
  on public.sellertray_agreement_packages(tenant_id,commercial_order_id,created_at desc);
create index sellertray_package_order_form_fk_idx
  on public.sellertray_agreement_packages(tenant_id,order_form_id);
create index sellertray_package_master_version_idx
  on public.sellertray_agreement_packages(master_agreement_version_id);
create index sellertray_order_form_confirmations_actor_idx
  on public.sellertray_order_form_confirmations(confirmed_by_user_id,confirmed_at desc);
create index sellertray_order_form_confirmations_package_fk_idx
  on public.sellertray_order_form_confirmations(tenant_id,agreement_package_id);

create or replace function public.prepare_sellertray_master_agreement_acceptance()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare v_master public.sellertray_commercial_agreement_template_versions%rowtype;
begin
  select t.* into strict v_master
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=new.master_agreement_version_id and t.agreement_family='terms_of_service';
  new.master_version_code := v_master.version_code;
  new.master_content_sha256 := v_master.content_sha256;
  new.accepted_legal_name := btrim(new.accepted_legal_name);
  new.accepted_at := coalesce(new.accepted_at,now());
  new.created_at := coalesce(new.created_at,now());
  return new;
end;
$$;
revoke all on function public.prepare_sellertray_master_agreement_acceptance() from public,anon,authenticated;
create trigger prepare_sellertray_master_agreement_acceptance
before insert on public.sellertray_master_agreement_acceptances
for each row execute function public.prepare_sellertray_master_agreement_acceptance();

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
begin
  select t.* into strict v_template
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=new.order_form_template_version_id;

  if v_template.agreement_family not in ('subscription_order','installment_agreement') then
    raise exception 'Order Forms require a subscription or installment Order Form template' using errcode='23514';
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
  new.content_sha256 := encode(extensions.digest(new.rendered_content,'sha256'),'hex');
  new.commercial_snapshot := v_snapshot;
  new.issued_at := coalesce(new.issued_at,now());
  new.created_at := coalesce(new.created_at,now());

  if v_template.effective_from>new.issued_at then
    raise exception 'Order Form template is not effective at the issue time' using errcode='23514';
  end if;

  if new.supersedes_order_form_id is not null then
    select f.* into strict v_previous
    from public.sellertray_commercial_order_forms f
    where f.tenant_id=new.tenant_id and f.id=new.supersedes_order_form_id
    for update;
    if v_previous.commercial_order_id<>new.commercial_order_id
       or v_previous.installment_obligation_id is distinct from new.installment_obligation_id then
      raise exception 'Replacement Order Form must preserve the original commercial subject' using errcode='23514';
    end if;
  elsif exists (
    select 1 from public.sellertray_commercial_order_forms f
    where f.tenant_id=new.tenant_id and f.commercial_order_id=new.commercial_order_id
      and not exists (
        select 1 from public.sellertray_commercial_order_forms replacement
        where replacement.tenant_id=f.tenant_id and replacement.supersedes_order_form_id=f.id
      )
  ) then
    raise exception 'Existing SellerTray Order Form must be explicitly superseded' using errcode='23505';
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
  v_master public.sellertray_commercial_agreement_template_versions%rowtype;
begin
  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=new.tenant_id and f.id=new.order_form_id;
  select t.* into strict v_master
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=new.master_agreement_version_id and t.agreement_family='terms_of_service';
  new.commercial_order_id := v_form.commercial_order_id;
  new.master_content_sha256 := v_master.content_sha256;
  new.order_form_content_sha256 := v_form.content_sha256;
  new.manifest_schema_version := 1;
  new.manifest := jsonb_build_object(
    'schemaVersion',1,'tenantId',new.tenant_id,'commercialOrderId',v_form.commercial_order_id,
    'masterAgreement',jsonb_build_object('versionId',v_master.id,'versionCode',v_master.version_code,'contentSha256',v_master.content_sha256),
    'orderForm',jsonb_build_object('id',v_form.id,'reference',v_form.order_form_reference,'contentSha256',v_form.content_sha256)
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
create trigger prevent_sellertray_master_acceptance_mutation
before update or delete on public.sellertray_master_agreement_acceptances
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
  p_rendered_content text,
  p_supersedes_order_form_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_id uuid;
  v_existing public.sellertray_commercial_order_forms%rowtype;
  v_reference text := btrim(coalesce(p_order_form_reference,''));
  v_content text := coalesce(p_rendered_content,'');
  v_reason text := btrim(coalesce(p_reason,''));
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.platform_admins pa where pa.user_id=p_actor_user_id and pa.role='admin'
  ) then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_commercial_order_id is null or p_template_version_id is null then
    raise exception 'Business, commercial order and Order Form template are required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Order Form issuance reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  insert into public.sellertray_commercial_order_forms(
    tenant_id,commercial_order_id,installment_obligation_id,order_form_template_version_id,
    template_version_code,template_content_sha256,order_form_reference,rendered_content,
    content_sha256,commercial_snapshot,supersedes_order_form_id,issued_by_user_id
  ) values (
    p_tenant_id,p_commercial_order_id,p_installment_obligation_id,p_template_version_id,
    'pending',repeat('0',64),v_reference,v_content,repeat('0',64),'{}'::jsonb,
    p_supersedes_order_form_id,p_actor_user_id
  )
  on conflict (tenant_id,order_form_reference) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
    values (p_actor_user_id,p_tenant_id,'sellertray_issue_commercial_order_form',jsonb_build_object(
      'orderFormId',v_id,'commercialOrderId',p_commercial_order_id,
      'installmentObligationId',p_installment_obligation_id,'templateVersionId',p_template_version_id,
      'orderFormReference',v_reference,'reason',v_reason
    ));
    return v_id;
  end if;

  select f.* into strict v_existing
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.order_form_reference=v_reference;
  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.installment_obligation_id is distinct from p_installment_obligation_id
     or v_existing.order_form_template_version_id<>p_template_version_id
     or v_existing.rendered_content<>v_content
     or v_existing.supersedes_order_form_id is distinct from p_supersedes_order_form_id
     or v_existing.issued_by_user_id<>p_actor_user_id then
    raise exception 'Order Form reference is already used for different contractual facts' using errcode='23505';
  end if;
  return v_existing.id;
end;
$$;

revoke all on function public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,text,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,text,uuid,text,uuid)
  to service_role;

create or replace function public.create_sellertray_agreement_package(
  p_tenant_id uuid,
  p_order_form_id uuid,
  p_master_agreement_version_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_master public.sellertray_commercial_agreement_template_versions%rowtype;
  v_manifest jsonb;
  v_fingerprint text;
  v_id uuid;
begin
  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id and f.id=p_order_form_id;
  select t.* into strict v_master
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=p_master_agreement_version_id and t.agreement_family='terms_of_service';

  v_manifest := jsonb_build_object(
    'schemaVersion',1,
    'tenantId',p_tenant_id,
    'commercialOrderId',v_form.commercial_order_id,
    'masterAgreement',jsonb_build_object('versionId',v_master.id,'versionCode',v_master.version_code,'contentSha256',v_master.content_sha256),
    'orderForm',jsonb_build_object('id',v_form.id,'reference',v_form.order_form_reference,'contentSha256',v_form.content_sha256)
  );
  v_fingerprint := encode(extensions.digest(convert_to(v_manifest::text,'UTF8'),'sha256'),'hex');

  insert into public.sellertray_agreement_packages(
    tenant_id,commercial_order_id,master_agreement_version_id,master_content_sha256,
    order_form_id,order_form_content_sha256,manifest_schema_version,manifest,package_fingerprint
  ) values (
    p_tenant_id,v_form.commercial_order_id,v_master.id,v_master.content_sha256,
    v_form.id,v_form.content_sha256,1,v_manifest,v_fingerprint
  )
  on conflict (tenant_id,master_agreement_version_id,order_form_id) do nothing
  returning id into v_id;
  if v_id is not null then return v_id; end if;

  select p.id into strict v_id
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id and p.master_agreement_version_id=v_master.id and p.order_form_id=v_form.id
    and p.manifest=v_manifest and p.package_fingerprint=v_fingerprint;
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
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_name text := btrim(coalesce(p_confirmed_legal_name,''));
  v_evidence jsonb := coalesce(p_request_evidence,'{}'::jsonb);
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_master public.sellertray_commercial_agreement_template_versions%rowtype;
  v_package public.sellertray_agreement_packages%rowtype;
  v_master_acceptance public.sellertray_master_agreement_acceptances%rowtype;
  v_confirmation public.sellertray_order_form_confirmations%rowtype;
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

  select tm.role into v_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role='owner' then null;
  elsif v_role='manager' and public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements') then null;
  else raise exception 'You are not authorised to confirm SellerTray purchases' using errcode='42501';
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

  select t.* into strict v_master
  from public.sellertray_commercial_agreement_template_versions t
  where t.agreement_family='terms_of_service' and t.effective_from<=now()
  order by t.effective_from desc,t.created_at desc,t.id desc
  limit 1;

  perform public.create_sellertray_agreement_package(p_tenant_id,v_form.id,v_master.id);
  select p.* into strict v_package
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id and p.master_agreement_version_id=v_master.id and p.order_form_id=v_form.id;

  select a.* into v_master_acceptance
  from public.sellertray_master_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.master_agreement_version_id=v_master.id;
  if not found then
    insert into public.sellertray_master_agreement_acceptances(
      tenant_id,master_agreement_version_id,master_version_code,master_content_sha256,
      accepted_by_user_id,accepted_legal_name,accepted_role,acceptance_method,
      request_evidence,command_id
    ) values (
      p_tenant_id,v_master.id,v_master.version_code,v_master.content_sha256,
      p_actor_user_id,v_name,v_role,'merchant_web_authenticated',v_evidence,p_command_id
    )
    on conflict (tenant_id,master_agreement_version_id) do nothing
    returning * into v_master_acceptance;
    if not found then
      select a.* into strict v_master_acceptance
      from public.sellertray_master_agreement_acceptances a
      where a.tenant_id=p_tenant_id and a.master_agreement_version_id=v_master.id;
    end if;
  end if;

  insert into public.sellertray_order_form_confirmations(
    tenant_id,order_form_id,agreement_package_id,order_form_content_sha256,package_fingerprint,
    confirmed_by_user_id,confirmed_legal_name,confirmed_role,confirmation_method,
    request_evidence,command_id
  ) values (
    p_tenant_id,v_form.id,v_package.id,v_form.content_sha256,v_package.package_fingerprint,
    p_actor_user_id,v_name,v_role,'merchant_web_authenticated',v_evidence,p_command_id
  )
  on conflict (tenant_id,command_id) do nothing
  returning * into v_confirmation;

  if not found then
    select c.* into strict v_confirmation
    from public.sellertray_order_form_confirmations c
    where c.tenant_id=p_tenant_id and c.command_id=p_command_id;
    if v_confirmation.order_form_id<>v_form.id
       or v_confirmation.agreement_package_id<>v_package.id
       or v_confirmation.confirmed_by_user_id<>p_actor_user_id
       or v_confirmation.confirmed_legal_name<>v_name
       or v_confirmation.confirmed_role<>v_role
       or v_confirmation.request_evidence is distinct from v_evidence then
      raise exception 'Purchase confirmation command is already used for different facts' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object(
    'masterAcceptanceId',v_master_acceptance.id,
    'masterAcceptanceCreated',v_master_acceptance.command_id=p_command_id,
    'orderFormConfirmationId',v_confirmation.id,
    'agreementPackageId',v_package.id,
    'packageFingerprint',v_package.package_fingerprint
  );
end;
$$;

revoke all on function public.confirm_sellertray_agreement_package(uuid,uuid,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_agreement_package(uuid,uuid,text,jsonb,uuid,uuid)
  to service_role;

create or replace function public.get_sellertray_master_agreement_center(
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
  v_can_accept boolean;
  v_master public.sellertray_commercial_agreement_template_versions%rowtype;
  v_master_acceptance jsonb;
  v_forms jsonb;
  v_legacy jsonb;
begin
  select tm.role into v_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Merchant agreement access requires an Owner or Manager' using errcode='42501';
  end if;
  v_can_accept := public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements');

  select t.* into v_master
  from public.sellertray_commercial_agreement_template_versions t
  where t.agreement_family='terms_of_service' and t.effective_from<=now()
  order by t.effective_from desc,t.created_at desc,t.id desc limit 1;

  if v_master.id is not null then
    select jsonb_build_object(
      'id',a.id,'acceptedAt',a.accepted_at,'acceptedLegalName',a.accepted_legal_name,
      'acceptedRole',a.accepted_role,'acceptedByCurrentUser',a.accepted_by_user_id=p_actor_user_id
    ) into v_master_acceptance
    from public.sellertray_master_agreement_acceptances a
    where a.tenant_id=p_tenant_id and a.master_agreement_version_id=v_master.id;
  end if;

  select coalesce(jsonb_agg(row_value order by is_current desc,issued_at desc,form_id),'[]'::jsonb)
  into v_forms
  from (
    select f.id form_id,f.issued_at,
      not exists (select 1 from public.sellertray_commercial_order_forms r where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id) is_current,
      jsonb_build_object(
        'id',f.id,'reference',f.order_form_reference,'title',t.title,'templateVersion',f.template_version_code,
        'renderedContent',f.rendered_content,'contentSha256',f.content_sha256,'commercialOrderId',f.commercial_order_id,
        'installmentObligationId',f.installment_obligation_id,'supersedesOrderFormId',f.supersedes_order_form_id,
        'isCurrent',not exists (select 1 from public.sellertray_commercial_order_forms r where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id),
        'issuedAt',f.issued_at,
        'confirmation',case when c.id is null then null else jsonb_build_object(
          'id',c.id,'confirmedAt',c.confirmed_at,'confirmedLegalName',c.confirmed_legal_name,
          'confirmedRole',c.confirmed_role,'confirmedByCurrentUser',c.confirmed_by_user_id=p_actor_user_id,
          'packageFingerprint',c.package_fingerprint
        ) end
      ) row_value
    from public.sellertray_commercial_order_forms f
    join public.sellertray_commercial_agreement_template_versions t on t.id=f.order_form_template_version_id
    left join public.sellertray_order_form_confirmations c on c.tenant_id=f.tenant_id and c.order_form_id=f.id
    where f.tenant_id=p_tenant_id
  ) projected;

  v_legacy := public.get_sellertray_commercial_agreement_center(p_tenant_id,p_actor_user_id)->'agreements';
  return jsonb_build_object(
    'tenantId',p_tenant_id,'actorRole',v_role,'canAccept',v_can_accept,
    'masterAgreement',case when v_master.id is null then null else jsonb_build_object(
      'id',v_master.id,'versionCode',v_master.version_code,'title',v_master.title,
      'contentBody',v_master.content_body,'contentSha256',v_master.content_sha256,
      'effectiveFrom',v_master.effective_from,'acceptance',v_master_acceptance
    ) end,
    'masterAcceptanceRequired',v_master.id is not null and v_master_acceptance is null,
    'orderForms',v_forms,'legacyAgreements',coalesce(v_legacy,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_sellertray_master_agreement_center(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_master_agreement_center(uuid,uuid) to service_role;

-- C1B accepts the active package path and retains the exact legacy predicate.
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
  select exists (
    select 1
    from public.sellertray_commercial_order_forms f
    join public.sellertray_order_form_confirmations c on c.tenant_id=f.tenant_id and c.order_form_id=f.id
    join public.sellertray_agreement_packages p on p.tenant_id=c.tenant_id and p.id=c.agreement_package_id
    join public.sellertray_master_agreement_acceptances ma
      on ma.tenant_id=p.tenant_id and ma.master_agreement_version_id=p.master_agreement_version_id
    where f.tenant_id=p_tenant_id and f.commercial_order_id=p_commercial_order_id
      and f.installment_obligation_id=p_installment_obligation_id
      and not exists (
        select 1 from public.sellertray_commercial_order_forms replacement
        where replacement.tenant_id=f.tenant_id and replacement.supersedes_order_form_id=f.id
      )
  ) or exists (
    select 1
    from public.sellertray_commercial_agreements a
    join public.sellertray_commercial_agreement_acceptances ac on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
    where a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id
      and a.installment_obligation_id=p_installment_obligation_id and a.agreement_family='installment_agreement'
      and not exists (
        select 1 from public.sellertray_commercial_agreements replacement
        where replacement.tenant_id=a.tenant_id and replacement.supersedes_agreement_id=a.id
      )
  );
$$;

revoke all on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid) to service_role;

alter table public.sellertray_master_agreement_acceptances enable row level security;
alter table public.sellertray_commercial_order_forms enable row level security;
alter table public.sellertray_agreement_packages enable row level security;
alter table public.sellertray_order_form_confirmations enable row level security;

revoke all on table public.sellertray_master_agreement_acceptances from public,anon,authenticated;
revoke all on table public.sellertray_commercial_order_forms from public,anon,authenticated;
revoke all on table public.sellertray_agreement_packages from public,anon,authenticated;
revoke all on table public.sellertray_order_form_confirmations from public,anon,authenticated;
grant all on table public.sellertray_master_agreement_acceptances to service_role;
grant all on table public.sellertray_commercial_order_forms to service_role;
grant all on table public.sellertray_agreement_packages to service_role;
grant all on table public.sellertray_order_form_confirmations to service_role;

commit;
