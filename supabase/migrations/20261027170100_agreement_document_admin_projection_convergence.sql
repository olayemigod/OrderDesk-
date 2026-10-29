begin;

-- The document-artifact migration extends the Admin legal projection with source
-- PDF evidence. Preserve the earlier quarantine projection at the same time so
-- document support cannot accidentally hide invalid/non-production publication
-- evidence from ProcessEdge legal audit.
create or replace function public.get_sellertray_master_agreement_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_versions jsonb;
  v_tenant_state jsonb:=null;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  if p_tenant_id is not null then
    v_tenant_state:=public.get_sellertray_master_agreement_state(p_tenant_id,now());
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',v.id,
    'versionCode',v.version_code,
    'title',v.title,
    'contentBody',v.content_body,
    'contentSha256',v.content_sha256,
    'effectiveFrom',v.effective_from,
    'publishedAt',v.published_at,
    'publishedByUserId',v.published_by_user_id,
    'publishReason',v.publish_reason,
    'quarantined',q.id is not null,
    'quarantineReason',q.reason,
    'quarantinedAt',q.quarantined_at,
    'quarantinedByUserId',q.quarantined_by_user_id,
    'sourceDocument',case when s.id is null then null else jsonb_build_object(
      'filename',s.original_filename,
      'pdfSha256',s.pdf_sha256,
      'byteSize',s.byte_size,
      'pageCount',s.page_count
    ) end
  ) order by v.effective_from desc,v.published_at desc),'[]'::jsonb)
  into v_versions
  from public.sellertray_master_agreement_versions v
  left join public.sellertray_master_agreement_version_quarantines q
    on q.agreement_version_id=v.id
  left join public.sellertray_master_agreement_source_documents s
    on s.agreement_version_id=v.id;

  return jsonb_build_object(
    'actorRole',v_role,
    'canPublish',public.platform_admin_has_capability(
      p_actor_user_id,'admin.agreements.publish',null,now()
    ),
    'versions',v_versions,
    'tenantState',v_tenant_state,
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.get_sellertray_master_agreement_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_master_agreement_admin(uuid,uuid)
  to service_role;

commit;
