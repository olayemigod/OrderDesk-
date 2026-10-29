begin;

-- Agreement documents are immutable rendered evidence layered on top of the
-- governed Master Agreement -> Order Form -> Agreement Package authority.
-- Uploaded Master PDFs never bypass version publication, hashes, capability,
-- MFA transport enforcement or audit.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'sellertray-agreement-artifacts',
  'sellertray-agreement-artifacts',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public=false,
    file_size_limit=least(coalesce(storage.buckets.file_size_limit,10485760),10485760),
    allowed_mime_types=array['application/pdf']::text[];

do $$
begin
  if exists (
    select 1 from storage.buckets
    where id='sellertray-agreement-artifacts' and public is true
  ) then
    raise exception 'SellerTray agreement artifact bucket must remain private';
  end if;
end;
$$;

create table public.sellertray_master_agreement_source_documents (
  id uuid primary key default gen_random_uuid(),
  agreement_version_id uuid not null unique references public.sellertray_master_agreement_versions(id) on delete restrict,
  storage_bucket text not null default 'sellertray-agreement-artifacts',
  storage_path text not null unique,
  original_filename text not null,
  pdf_sha256 text not null,
  byte_size bigint not null,
  page_count integer not null,
  publication_command_id uuid not null unique,
  uploaded_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint sellertray_master_source_bucket_check check (storage_bucket='sellertray-agreement-artifacts'),
  constraint sellertray_master_source_path_check check (storage_path=btrim(storage_path) and char_length(storage_path) between 1 and 500),
  constraint sellertray_master_source_filename_check check (original_filename=btrim(original_filename) and char_length(original_filename) between 1 and 255),
  constraint sellertray_master_source_hash_check check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_master_source_size_check check (byte_size between 1 and 8388608),
  constraint sellertray_master_source_page_count_check check (page_count between 1 and 200)
);

create index sellertray_master_source_uploaded_idx
  on public.sellertray_master_agreement_source_documents(uploaded_by_user_id,created_at desc);

alter table public.sellertray_master_agreement_source_documents enable row level security;
revoke all on table public.sellertray_master_agreement_source_documents from public,anon,authenticated;
grant all on table public.sellertray_master_agreement_source_documents to service_role;

create trigger prevent_sellertray_master_agreement_source_document_mutation
before update or delete on public.sellertray_master_agreement_source_documents
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create table public.sellertray_agreement_package_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agreement_package_id uuid not null,
  order_form_id uuid not null,
  artifact_kind text not null,
  storage_bucket text not null,
  storage_path text not null,
  pdf_sha256 text not null,
  byte_size bigint not null,
  package_fingerprint text not null,
  generated_by_user_id uuid not null references auth.users(id) on delete restrict,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,agreement_package_id,artifact_kind),
  unique (storage_bucket,storage_path),
  constraint sellertray_agreement_artifact_package_same_tenant
    foreign key (tenant_id,agreement_package_id)
    references public.sellertray_agreement_packages(tenant_id,id) on delete restrict,
  constraint sellertray_agreement_artifact_form_same_tenant
    foreign key (tenant_id,order_form_id)
    references public.sellertray_commercial_order_forms(tenant_id,id) on delete restrict,
  constraint sellertray_agreement_artifact_kind_check
    check (artifact_kind in ('review_pdf','executed_pdf')),
  constraint sellertray_agreement_artifact_bucket_check
    check (storage_bucket='sellertray-agreement-artifacts'),
  constraint sellertray_agreement_artifact_path_check
    check (storage_path=btrim(storage_path) and char_length(storage_path) between 1 and 500),
  constraint sellertray_agreement_artifact_hash_check
    check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_agreement_artifact_size_check
    check (byte_size between 1 and 10485760),
  constraint sellertray_agreement_artifact_fingerprint_check
    check (package_fingerprint ~ '^[0-9a-f]{64}$')
);

create index sellertray_agreement_package_artifacts_package_idx
  on public.sellertray_agreement_package_artifacts(tenant_id,agreement_package_id,generated_at desc);
create index sellertray_agreement_package_artifacts_form_idx
  on public.sellertray_agreement_package_artifacts(tenant_id,order_form_id,generated_at desc);

alter table public.sellertray_agreement_package_artifacts enable row level security;
revoke all on table public.sellertray_agreement_package_artifacts from public,anon,authenticated;
grant all on table public.sellertray_agreement_package_artifacts to service_role;

create or replace function public.prepare_sellertray_agreement_package_artifact()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare v_package public.sellertray_agreement_packages%rowtype;
begin
  select p.* into strict v_package
  from public.sellertray_agreement_packages p
  where p.tenant_id=new.tenant_id and p.id=new.agreement_package_id;

  new.order_form_id:=v_package.order_form_id;
  new.package_fingerprint:=v_package.package_fingerprint;
  new.storage_bucket:='sellertray-agreement-artifacts';
  new.storage_path:=new.tenant_id::text||'/'||v_package.id::text||'/'||new.artifact_kind||'.pdf';
  new.generated_at:=coalesce(new.generated_at,now());
  new.created_at:=coalesce(new.created_at,now());

  if new.artifact_kind='executed_pdf' and (
    not exists (
      select 1 from public.sellertray_order_form_confirmations c
      where c.tenant_id=new.tenant_id and c.order_form_id=v_package.order_form_id
    )
    or not exists (
      select 1 from public.sellertray_master_agreement_acceptances a
      where a.tenant_id=new.tenant_id and a.agreement_version_id=v_package.master_agreement_version_id
    )
  ) then
    raise exception 'Executed Agreement Package PDF requires Master acceptance and Order Form confirmation evidence'
      using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_sellertray_agreement_package_artifact() from public,anon,authenticated;

create trigger prepare_sellertray_agreement_package_artifact
before insert on public.sellertray_agreement_package_artifacts
for each row execute function public.prepare_sellertray_agreement_package_artifact();
create trigger prevent_sellertray_agreement_package_artifact_mutation
before update or delete on public.sellertray_agreement_package_artifacts
for each row execute function public.prevent_sellertray_commercial_history_mutation();

-- Publish a new immutable Master version from a reviewed PDF. The exact PDF is
-- stored as immutable source evidence while extracted text continues to satisfy
-- the existing text authority and accessibility/search contract. A PDF cannot
-- be attached later to an already-published text-only version.
create or replace function public.publish_sellertray_master_agreement_pdf_admin(
  p_version_code text,
  p_title text,
  p_content_body text,
  p_effective_from timestamptz,
  p_reason text,
  p_source_filename text,
  p_source_pdf_sha256 text,
  p_source_byte_size bigint,
  p_source_page_count integer,
  p_source_storage_path text,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_version_code text:=btrim(coalesce(p_version_code,''));
  v_filename text:=btrim(coalesce(p_source_filename,''));
  v_expected_path text;
  v_existing_version public.sellertray_master_agreement_versions%rowtype;
  v_existing_source public.sellertray_master_agreement_source_documents%rowtype;
  v_version_id uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.agreements.publish',null,now()) then
    raise exception 'Master Agreement publication capability required' using errcode='42501';
  end if;
  if p_command_id is null then raise exception 'Publication command is required' using errcode='22023'; end if;
  if v_filename='' or char_length(v_filename)>255 or v_filename ~ '[\\/\x00-\x1f]' then
    raise exception 'A valid reviewed PDF filename is required' using errcode='22023';
  end if;
  if coalesce(p_source_pdf_sha256,'') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_byte_size,0) not between 1 and 8388608
     or coalesce(p_source_page_count,0) not between 1 and 200 then
    raise exception 'Valid reviewed PDF integrity, size and page count are required' using errcode='22023';
  end if;

  v_expected_path:='master-sources/'||p_command_id::text||'/source.pdf';
  if p_source_storage_path is distinct from v_expected_path then
    raise exception 'Reviewed PDF storage path does not match its publication command' using errcode='23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sellertray-master-pdf:'||p_command_id::text,0));

  select s.* into v_existing_source
  from public.sellertray_master_agreement_source_documents s
  where s.publication_command_id=p_command_id;
  if found then
    select v.* into strict v_existing_version
    from public.sellertray_master_agreement_versions v
    where v.id=v_existing_source.agreement_version_id;
    if v_existing_version.version_code<>v_version_code
       or v_existing_source.original_filename<>v_filename
       or v_existing_source.pdf_sha256<>p_source_pdf_sha256
       or v_existing_source.byte_size<>p_source_byte_size
       or v_existing_source.page_count<>p_source_page_count
       or v_existing_source.storage_path<>v_expected_path then
      raise exception 'Master Agreement PDF publication command is already used for different facts' using errcode='23505';
    end if;
    perform public.publish_sellertray_master_agreement_admin(
      p_version_code,p_title,p_content_body,p_effective_from,p_reason,p_actor_user_id
    );
    return v_existing_version.id;
  end if;

  select v.* into v_existing_version
  from public.sellertray_master_agreement_versions v
  where v.version_code=v_version_code;
  if found then
    raise exception 'Master Agreement version already exists and cannot receive a later source PDF' using errcode='23505';
  end if;

  v_version_id:=public.publish_sellertray_master_agreement_admin(
    p_version_code,p_title,p_content_body,p_effective_from,p_reason,p_actor_user_id
  );

  insert into public.sellertray_master_agreement_source_documents(
    agreement_version_id,storage_bucket,storage_path,original_filename,pdf_sha256,
    byte_size,page_count,publication_command_id,uploaded_by_user_id,created_at
  ) values (
    v_version_id,'sellertray-agreement-artifacts',v_expected_path,v_filename,p_source_pdf_sha256,
    p_source_byte_size,p_source_page_count,p_command_id,p_actor_user_id,now()
  );

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_master_agreement_source_pdf_published',jsonb_build_object(
    'agreementVersionId',v_version_id,
    'versionCode',v_version_code,
    'sourceFilename',v_filename,
    'sourcePdfSha256',p_source_pdf_sha256,
    'sourceByteSize',p_source_byte_size,
    'sourcePageCount',p_source_page_count,
    'publicationCommandId',p_command_id
  ));
  return v_version_id;
end;
$$;
revoke all on function public.publish_sellertray_master_agreement_pdf_admin(text,text,text,timestamptz,text,text,text,bigint,integer,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_master_agreement_pdf_admin(text,text,text,timestamptz,text,text,text,bigint,integer,text,uuid,uuid) to service_role;

-- Include an uploaded reviewed Master PDF hash in every newly-created package
-- fingerprint. Existing immutable packages remain unchanged historical evidence.
create or replace function public.prepare_sellertray_agreement_package()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_master public.sellertray_master_agreement_versions%rowtype;
  v_source public.sellertray_master_agreement_source_documents%rowtype;
  v_master_manifest jsonb;
begin
  select f.* into strict v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=new.tenant_id and f.id=new.order_form_id;
  select m.* into strict v_master
  from public.sellertray_master_agreement_versions m
  where m.id=new.master_agreement_version_id;
  select s.* into v_source
  from public.sellertray_master_agreement_source_documents s
  where s.agreement_version_id=v_master.id;

  v_master_manifest:=jsonb_build_object(
    'versionId',v_master.id,
    'versionCode',v_master.version_code,
    'contentSha256',v_master.content_sha256
  );
  if v_source.id is not null then
    v_master_manifest:=v_master_manifest||jsonb_build_object(
      'sourceDocument',jsonb_build_object(
        'kind','reviewed_pdf',
        'filename',v_source.original_filename,
        'pdfSha256',v_source.pdf_sha256,
        'byteSize',v_source.byte_size,
        'pageCount',v_source.page_count
      )
    );
  end if;

  new.commercial_order_id:=v_form.commercial_order_id;
  new.master_content_sha256:=v_master.content_sha256;
  new.order_form_content_sha256:=v_form.content_sha256;
  new.order_form_commercial_snapshot_sha256:=v_form.commercial_snapshot_sha256;
  new.manifest_schema_version:=1;
  new.manifest:=jsonb_build_object(
    'schemaVersion',1,
    'tenantId',new.tenant_id,
    'commercialOrderId',v_form.commercial_order_id,
    'masterAgreement',v_master_manifest,
    'orderForm',jsonb_build_object(
      'id',v_form.id,
      'reference',v_form.order_form_reference,
      'templateVersionId',v_form.order_form_template_version_id,
      'templateVersionCode',v_form.template_version_code,
      'contentSha256',v_form.content_sha256,
      'commercialSnapshotSha256',v_form.commercial_snapshot_sha256
    )
  );
  new.package_fingerprint:=encode(extensions.digest(convert_to(new.manifest::text,'UTF8'),'sha256'),'hex');
  new.created_at:=coalesce(new.created_at,now());
  return new;
end;
$$;
revoke all on function public.prepare_sellertray_agreement_package() from public,anon,authenticated;

-- The merchant signs exactly the package rendered for review. A newly-effective
-- Master version after review forces a fresh review instead of silently signing
-- different terms.
create or replace function public.confirm_sellertray_agreement_package_reviewed(
  p_tenant_id uuid,
  p_order_form_id uuid,
  p_expected_package_id uuid,
  p_expected_package_fingerprint text,
  p_confirmed_legal_name text,
  p_request_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_expected public.sellertray_agreement_packages%rowtype;
  v_current_master_id uuid;
begin
  if p_expected_package_id is null
     or coalesce(p_expected_package_fingerprint,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'Review the current Agreement Package PDF before signing' using errcode='22023';
  end if;

  select p.* into strict v_expected
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id and p.id=p_expected_package_id
  for share;

  if v_expected.order_form_id<>p_order_form_id
     or v_expected.package_fingerprint<>p_expected_package_fingerprint then
    raise exception 'The reviewed Agreement Package does not match this purchase' using errcode='23514';
  end if;

  v_current_master_id:=public.resolve_sellertray_master_agreement_version_id(now());
  if v_current_master_id is null then
    raise exception 'SellerTray Master Agreement is not yet published' using errcode='23514';
  end if;
  if v_expected.master_agreement_version_id<>v_current_master_id then
    raise exception 'The SellerTray Master Agreement changed after review. Review the current Agreement Package PDF before signing'
      using errcode='23514';
  end if;

  return public.confirm_sellertray_agreement_package(
    p_tenant_id,
    p_order_form_id,
    p_confirmed_legal_name,
    coalesce(p_request_evidence,'{}'::jsonb)||jsonb_build_object(
      'reviewed_agreement_package_id',v_expected.id,
      'reviewed_package_fingerprint',v_expected.package_fingerprint
    ),
    p_command_id,
    p_actor_user_id
  );
end;
$$;
revoke all on function public.confirm_sellertray_agreement_package_reviewed(uuid,uuid,uuid,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_sellertray_agreement_package_reviewed(uuid,uuid,uuid,text,text,jsonb,uuid,uuid) to service_role;

-- Admin legal history exposes source-document integrity without exposing the
-- private storage path. Merchant acceptance continues to use the exact version
-- and package fingerprint rather than a browser attachment URL.
create or replace function public.get_sellertray_master_agreement_admin(p_actor_user_id uuid,p_tenant_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_role text; v_versions jsonb; v_tenant_state jsonb:=null;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if coalesce(v_role,'') not in ('admin','support') then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  if p_tenant_id is not null then v_tenant_state:=public.get_sellertray_master_agreement_state(p_tenant_id,now()); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',v.id,'versionCode',v.version_code,'title',v.title,'contentBody',v.content_body,
    'contentSha256',v.content_sha256,'effectiveFrom',v.effective_from,'publishedAt',v.published_at,
    'publishedByUserId',v.published_by_user_id,'publishReason',v.publish_reason,
    'sourceDocument',case when s.id is null then null else jsonb_build_object(
      'filename',s.original_filename,'pdfSha256',s.pdf_sha256,'byteSize',s.byte_size,'pageCount',s.page_count
    ) end
  ) order by v.effective_from desc,v.published_at desc),'[]'::jsonb)
  into v_versions
  from public.sellertray_master_agreement_versions v
  left join public.sellertray_master_agreement_source_documents s on s.agreement_version_id=v.id;
  return jsonb_build_object(
    'actorRole',v_role,
    'canPublish',public.platform_admin_has_capability(p_actor_user_id,'admin.agreements.publish',null,now()),
    'versions',v_versions,
    'tenantState',v_tenant_state,
    'generatedAt',now()
  );
end;
$$;
revoke all on function public.get_sellertray_master_agreement_admin(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_master_agreement_admin(uuid,uuid) to service_role;

commit;
