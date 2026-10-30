-- Restore the immutable Agreement Package schema to repository migration truth.
-- These objects already exist in the current governed test/live lineage, but the
-- creating migration was missing from repository history. IF NOT EXISTS keeps
-- existing installations unchanged while making clean-schema replay complete.

create table if not exists public.sellertray_commercial_order_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  installment_obligation_id uuid null,
  order_form_template_version_id uuid not null references public.sellertray_commercial_agreement_template_versions(id) on delete restrict,
  template_version_code text not null check (char_length(btrim(template_version_code)) between 1 and 64),
  template_content_sha256 text not null check (template_content_sha256 ~ '^[0-9a-f]{64}$'),
  order_form_reference text not null check (char_length(btrim(order_form_reference)) between 1 and 128),
  rendered_content text not null check (char_length(rendered_content) between 1 and 300000),
  commercial_snapshot jsonb not null check (jsonb_typeof(commercial_snapshot)='object'),
  commercial_snapshot_sha256 text not null check (commercial_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  supersedes_order_form_id uuid null,
  issued_by_user_id uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,order_form_reference),
  constraint sellertray_order_forms_order_same_tenant foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_order_forms_installment_same_order foreign key (tenant_id,commercial_order_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,id) on delete restrict,
  constraint sellertray_order_forms_supersedes_same_tenant foreign key (tenant_id,supersedes_order_form_id)
    references public.sellertray_commercial_order_forms(tenant_id,id) on delete restrict,
  constraint sellertray_order_forms_time_check check (issued_at <= created_at + interval '5 minutes')
);
create unique index if not exists sellertray_order_forms_supersedes_key on public.sellertray_commercial_order_forms(supersedes_order_form_id) where supersedes_order_form_id is not null;
create index if not exists sellertray_order_forms_order_idx on public.sellertray_commercial_order_forms(tenant_id,commercial_order_id,issued_at desc);
create index if not exists sellertray_order_forms_obligation_idx on public.sellertray_commercial_order_forms(tenant_id,installment_obligation_id) where installment_obligation_id is not null;
create index if not exists sellertray_order_forms_template_idx on public.sellertray_commercial_order_forms(order_form_template_version_id);
create index if not exists sellertray_order_forms_issuer_idx on public.sellertray_commercial_order_forms(issued_by_user_id);
alter table public.sellertray_commercial_order_forms enable row level security;
revoke all on public.sellertray_commercial_order_forms from public,anon,authenticated;

create table if not exists public.sellertray_master_agreement_source_documents (
  id uuid primary key default gen_random_uuid(),
  agreement_version_id uuid not null unique references public.sellertray_master_agreement_versions(id) on delete restrict,
  storage_bucket text not null default 'sellertray-agreement-artifacts' check (storage_bucket='sellertray-agreement-artifacts'),
  storage_path text not null unique check (storage_path=btrim(storage_path) and char_length(storage_path) between 1 and 500),
  original_filename text not null check (original_filename=btrim(original_filename) and char_length(original_filename) between 1 and 255),
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 8388608),
  page_count integer not null check (page_count between 1 and 200),
  publication_command_id uuid not null unique,
  uploaded_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists sellertray_master_source_uploaded_idx on public.sellertray_master_agreement_source_documents(uploaded_by_user_id,created_at desc);
alter table public.sellertray_master_agreement_source_documents enable row level security;
revoke all on public.sellertray_master_agreement_source_documents from public,anon,authenticated;

create table if not exists public.sellertray_agreement_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  master_agreement_version_id uuid not null references public.sellertray_master_agreement_versions(id) on delete restrict,
  master_content_sha256 text not null check (master_content_sha256 ~ '^[0-9a-f]{64}$'),
  order_form_id uuid not null,
  order_form_content_sha256 text not null check (order_form_content_sha256 ~ '^[0-9a-f]{64}$'),
  order_form_commercial_snapshot_sha256 text not null check (order_form_commercial_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_schema_version integer not null default 1 check (manifest_schema_version=1),
  manifest jsonb not null check (jsonb_typeof(manifest)='object'),
  package_fingerprint text not null unique check (package_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,master_agreement_version_id,order_form_id),
  constraint sellertray_agreement_packages_order_same_tenant foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete restrict,
  constraint sellertray_agreement_packages_form_same_tenant foreign key (tenant_id,order_form_id)
    references public.sellertray_commercial_order_forms(tenant_id,id) on delete restrict
);
create index if not exists sellertray_package_order_idx on public.sellertray_agreement_packages(tenant_id,commercial_order_id,created_at desc);
create index if not exists sellertray_package_order_form_idx on public.sellertray_agreement_packages(tenant_id,order_form_id);
create index if not exists sellertray_package_master_version_idx on public.sellertray_agreement_packages(master_agreement_version_id);
alter table public.sellertray_agreement_packages enable row level security;
revoke all on public.sellertray_agreement_packages from public,anon,authenticated;

create table if not exists public.sellertray_order_form_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_form_id uuid not null,
  agreement_package_id uuid not null,
  order_form_content_sha256 text not null check (order_form_content_sha256 ~ '^[0-9a-f]{64}$'),
  package_fingerprint text not null check (package_fingerprint ~ '^[0-9a-f]{64}$'),
  confirmed_by_user_id uuid not null references auth.users(id) on delete restrict,
  confirmed_legal_name text not null check (char_length(btrim(confirmed_legal_name)) between 1 and 200),
  confirmed_role text not null check (confirmed_role in ('owner','manager')),
  confirmation_method text not null default 'merchant_web_authenticated' check (confirmation_method='merchant_web_authenticated'),
  request_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(request_evidence)='object'),
  command_id uuid not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,order_form_id),
  unique (tenant_id,command_id),
  constraint sellertray_order_form_confirmations_form_same_tenant foreign key (tenant_id,order_form_id)
    references public.sellertray_commercial_order_forms(tenant_id,id) on delete restrict,
  constraint sellertray_order_form_confirmations_package_same_tenant foreign key (tenant_id,agreement_package_id)
    references public.sellertray_agreement_packages(tenant_id,id) on delete restrict,
  constraint sellertray_order_form_confirmations_time_check check (confirmed_at <= created_at + interval '5 minutes')
);
create index if not exists sellertray_order_form_confirmations_package_idx on public.sellertray_order_form_confirmations(tenant_id,agreement_package_id);
create index if not exists sellertray_order_form_confirmations_actor_idx on public.sellertray_order_form_confirmations(confirmed_by_user_id,confirmed_at desc);
alter table public.sellertray_order_form_confirmations enable row level security;
revoke all on public.sellertray_order_form_confirmations from public,anon,authenticated;

create table if not exists public.sellertray_agreement_package_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agreement_package_id uuid not null,
  order_form_id uuid not null,
  artifact_kind text not null check (artifact_kind in ('review_pdf','executed_pdf')),
  storage_bucket text not null check (storage_bucket='sellertray-agreement-artifacts'),
  storage_path text not null check (storage_path=btrim(storage_path) and char_length(storage_path) between 1 and 500),
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  package_fingerprint text not null check (package_fingerprint ~ '^[0-9a-f]{64}$'),
  generated_by_user_id uuid not null references auth.users(id) on delete restrict,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,agreement_package_id,artifact_kind),
  unique (storage_bucket,storage_path),
  constraint sellertray_agreement_artifact_package_same_tenant foreign key (tenant_id,agreement_package_id)
    references public.sellertray_agreement_packages(tenant_id,id) on delete restrict,
  constraint sellertray_agreement_artifact_form_same_tenant foreign key (tenant_id,order_form_id)
    references public.sellertray_commercial_order_forms(tenant_id,id) on delete restrict
);
alter table public.sellertray_agreement_package_artifacts enable row level security;
revoke all on public.sellertray_agreement_package_artifacts from public,anon,authenticated;

create or replace function public.prepare_sellertray_commercial_order_form()
returns trigger language plpgsql set search_path to '' as $function$
declare
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_previous public.sellertray_commercial_order_forms%rowtype;
  v_snapshot jsonb;
  v_document jsonb;
begin
  select t.* into strict v_template from public.sellertray_commercial_agreement_template_versions t where t.id=new.order_form_template_version_id;
  if v_template.agreement_family not in ('subscription_order','installment_agreement') then
    raise exception 'Order Forms require a subscription-order or installment-agreement template' using errcode='23514';
  end if;
  if (v_template.agreement_family='installment_agreement') <> (new.installment_obligation_id is not null) then
    raise exception 'Installment Order Forms must bind the exact installment obligation' using errcode='23514';
  end if;
  v_snapshot:=public.build_sellertray_commercial_agreement_snapshot(new.tenant_id,new.commercial_order_id,new.installment_obligation_id);
  new.template_version_code:=v_template.version_code;
  new.template_content_sha256:=v_template.content_sha256;
  new.order_form_reference:=btrim(new.order_form_reference);
  new.rendered_content:=v_template.content_body;
  new.commercial_snapshot:=v_snapshot;
  new.commercial_snapshot_sha256:=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  v_document:=jsonb_build_object('schemaVersion',1,'reference',new.order_form_reference,'template',jsonb_build_object('versionId',v_template.id,'versionCode',v_template.version_code,'contentSha256',v_template.content_sha256),'commercialSnapshot',v_snapshot);
  new.content_sha256:=encode(extensions.digest(convert_to(v_document::text,'UTF8'),'sha256'),'hex');
  new.issued_at:=coalesce(new.issued_at,now());
  new.created_at:=coalesce(new.created_at,now());
  if v_template.effective_from>new.issued_at then raise exception 'Order Form template is not effective at the issue time' using errcode='23514'; end if;
  if new.supersedes_order_form_id is not null then
    select f.* into strict v_previous from public.sellertray_commercial_order_forms f where f.tenant_id=new.tenant_id and f.id=new.supersedes_order_form_id for share;
    if v_previous.commercial_order_id<>new.commercial_order_id or v_previous.installment_obligation_id is distinct from new.installment_obligation_id then
      raise exception 'Replacement Order Form must preserve the original commercial subject' using errcode='23514';
    end if;
    if exists(select 1 from public.sellertray_commercial_order_forms r where r.tenant_id=new.tenant_id and r.supersedes_order_form_id=v_previous.id) then
      raise exception 'The selected Order Form has already been superseded' using errcode='23505';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists prepare_sellertray_commercial_order_form on public.sellertray_commercial_order_forms;
create trigger prepare_sellertray_commercial_order_form before insert on public.sellertray_commercial_order_forms for each row execute function public.prepare_sellertray_commercial_order_form();
drop trigger if exists prevent_sellertray_commercial_order_form_mutation on public.sellertray_commercial_order_forms;
create trigger prevent_sellertray_commercial_order_form_mutation before update or delete on public.sellertray_commercial_order_forms for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.prepare_sellertray_agreement_package()
returns trigger language plpgsql set search_path to '' as $function$
declare
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_master public.sellertray_master_agreement_versions%rowtype;
  v_source public.sellertray_master_agreement_source_documents%rowtype;
  v_master_manifest jsonb;
begin
  select f.* into strict v_form from public.sellertray_commercial_order_forms f where f.tenant_id=new.tenant_id and f.id=new.order_form_id;
  select m.* into strict v_master from public.sellertray_master_agreement_versions m where m.id=new.master_agreement_version_id;
  select s.* into v_source from public.sellertray_master_agreement_source_documents s where s.agreement_version_id=v_master.id;
  v_master_manifest:=jsonb_build_object('versionId',v_master.id,'versionCode',v_master.version_code,'contentSha256',v_master.content_sha256);
  if v_source.id is not null then
    v_master_manifest:=v_master_manifest||jsonb_build_object('sourceDocument',jsonb_build_object('kind','reviewed_pdf','filename',v_source.original_filename,'pdfSha256',v_source.pdf_sha256,'byteSize',v_source.byte_size,'pageCount',v_source.page_count));
  end if;
  new.commercial_order_id:=v_form.commercial_order_id;
  new.master_content_sha256:=v_master.content_sha256;
  new.order_form_content_sha256:=v_form.content_sha256;
  new.order_form_commercial_snapshot_sha256:=v_form.commercial_snapshot_sha256;
  new.manifest_schema_version:=1;
  new.manifest:=jsonb_build_object('schemaVersion',1,'tenantId',new.tenant_id,'commercialOrderId',v_form.commercial_order_id,'masterAgreement',v_master_manifest,'orderForm',jsonb_build_object('id',v_form.id,'reference',v_form.order_form_reference,'templateVersionId',v_form.order_form_template_version_id,'templateVersionCode',v_form.template_version_code,'contentSha256',v_form.content_sha256,'commercialSnapshotSha256',v_form.commercial_snapshot_sha256));
  new.package_fingerprint:=encode(extensions.digest(convert_to(new.manifest::text,'UTF8'),'sha256'),'hex');
  new.created_at:=coalesce(new.created_at,now());
  return new;
end;
$function$;

drop trigger if exists prepare_sellertray_agreement_package on public.sellertray_agreement_packages;
create trigger prepare_sellertray_agreement_package before insert on public.sellertray_agreement_packages for each row execute function public.prepare_sellertray_agreement_package();
drop trigger if exists prevent_sellertray_agreement_package_mutation on public.sellertray_agreement_packages;
create trigger prevent_sellertray_agreement_package_mutation before update or delete on public.sellertray_agreement_packages for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.prepare_sellertray_order_form_confirmation()
returns trigger language plpgsql set search_path to '' as $function$
declare v_package public.sellertray_agreement_packages%rowtype;
begin
  select p.* into strict v_package from public.sellertray_agreement_packages p where p.tenant_id=new.tenant_id and p.id=new.agreement_package_id;
  if v_package.order_form_id<>new.order_form_id then raise exception 'Order Form confirmation must bind its exact Agreement Package' using errcode='23514'; end if;
  new.order_form_content_sha256:=v_package.order_form_content_sha256;
  new.package_fingerprint:=v_package.package_fingerprint;
  new.confirmed_legal_name:=btrim(new.confirmed_legal_name);
  new.confirmed_at:=coalesce(new.confirmed_at,now());
  new.created_at:=coalesce(new.created_at,now());
  return new;
end;
$function$;

drop trigger if exists prepare_sellertray_order_form_confirmation on public.sellertray_order_form_confirmations;
create trigger prepare_sellertray_order_form_confirmation before insert on public.sellertray_order_form_confirmations for each row execute function public.prepare_sellertray_order_form_confirmation();
drop trigger if exists prevent_sellertray_order_form_confirmation_mutation on public.sellertray_order_form_confirmations;
create trigger prevent_sellertray_order_form_confirmation_mutation before update or delete on public.sellertray_order_form_confirmations for each row execute function public.prevent_sellertray_commercial_history_mutation();

drop trigger if exists prevent_sellertray_master_agreement_source_document_mutation on public.sellertray_master_agreement_source_documents;
create trigger prevent_sellertray_master_agreement_source_document_mutation before update or delete on public.sellertray_master_agreement_source_documents for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.create_sellertray_agreement_package(p_tenant_id uuid,p_order_form_id uuid,p_master_agreement_version_id uuid)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_form public.sellertray_commercial_order_forms%rowtype; v_master public.sellertray_master_agreement_versions%rowtype; v_id uuid;
begin
  select f.* into strict v_form from public.sellertray_commercial_order_forms f where f.tenant_id=p_tenant_id and f.id=p_order_form_id;
  select m.* into strict v_master from public.sellertray_master_agreement_versions m where m.id=p_master_agreement_version_id;
  insert into public.sellertray_agreement_packages(tenant_id,commercial_order_id,master_agreement_version_id,master_content_sha256,order_form_id,order_form_content_sha256,order_form_commercial_snapshot_sha256,manifest_schema_version,manifest,package_fingerprint)
  values(p_tenant_id,v_form.commercial_order_id,v_master.id,v_master.content_sha256,v_form.id,v_form.content_sha256,v_form.commercial_snapshot_sha256,1,'{}'::jsonb,repeat('0',64))
  on conflict(tenant_id,master_agreement_version_id,order_form_id) do nothing returning id into v_id;
  if v_id is not null then return v_id; end if;
  select p.id into strict v_id from public.sellertray_agreement_packages p where p.tenant_id=p_tenant_id and p.master_agreement_version_id=v_master.id and p.order_form_id=v_form.id;
  return v_id;
end;
$function$;
revoke all on function public.create_sellertray_agreement_package(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_sellertray_agreement_package(uuid,uuid,uuid) to service_role;
