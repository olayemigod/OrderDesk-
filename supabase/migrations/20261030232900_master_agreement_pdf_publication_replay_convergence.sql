-- Restore the reviewed-PDF Master Agreement publisher to repository migration truth.
-- Production already carried this authority, but the creating migration was absent
-- from the repository. Replaying a clean schema must create the same governed
-- function before later privilege hardening can reference it.

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
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
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
  if p_command_id is null then
    raise exception 'Publication command is required' using errcode='22023';
  end if;
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
$function$;

revoke all on function public.publish_sellertray_master_agreement_pdf_admin(
  text,text,text,timestamptz,text,text,text,bigint,integer,text,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.publish_sellertray_master_agreement_pdf_admin(
  text,text,text,timestamptz,text,text,text,bigint,integer,text,uuid,uuid
) to service_role;

comment on function public.publish_sellertray_master_agreement_pdf_admin(text,text,text,timestamptz,text,text,text,bigint,integer,text,uuid,uuid) is
  'Authoritative ProcessEdge Admin publication path for immutable SellerTray Master Agreement versions. Requires reviewed source PDF evidence and admin.agreements.publish authority.';