begin;

-- Preserve immutable published Master Agreement evidence while allowing an
-- explicitly invalid/non-production publication to be quarantined from current
-- SellerTray legal authority. Quarantine is additive audit truth: it never edits
-- or deletes the published version or any acceptance/package evidence.
create table if not exists public.sellertray_master_agreement_version_quarantines (
  id uuid primary key default gen_random_uuid(),
  agreement_version_id uuid not null unique
    references public.sellertray_master_agreement_versions(id) on delete restrict,
  reason text not null,
  quarantined_by_user_id uuid not null references auth.users(id) on delete restrict,
  quarantined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint sellertray_master_agreement_quarantine_reason_check
    check (char_length(btrim(reason)) between 6 and 1000 and reason=btrim(reason))
);

create index if not exists sellertray_master_agreement_quarantine_actor_idx
  on public.sellertray_master_agreement_version_quarantines(quarantined_by_user_id,quarantined_at desc);

alter table public.sellertray_master_agreement_version_quarantines enable row level security;
revoke all on table public.sellertray_master_agreement_version_quarantines from public,anon,authenticated;
grant all on table public.sellertray_master_agreement_version_quarantines to service_role;

drop trigger if exists prevent_sellertray_master_agreement_quarantine_mutation
  on public.sellertray_master_agreement_version_quarantines;
create trigger prevent_sellertray_master_agreement_quarantine_mutation
before update or delete on public.sellertray_master_agreement_version_quarantines
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.quarantine_sellertray_master_agreement_version_admin(
  p_agreement_version_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reason text := btrim(coalesce(p_reason,''));
  v_version public.sellertray_master_agreement_versions%rowtype;
  v_existing public.sellertray_master_agreement_version_quarantines%rowtype;
  v_id uuid;
  v_acceptance_count bigint;
begin
  if p_actor_user_id is null or not public.platform_admin_has_capability(
    p_actor_user_id,'admin.agreements.publish',null,now()
  ) then
    raise exception 'Master Agreement publication capability required' using errcode='42501';
  end if;
  if p_agreement_version_id is null then
    raise exception 'Master Agreement version is required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Quarantine reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  select v.* into v_version
  from public.sellertray_master_agreement_versions v
  where v.id=p_agreement_version_id;
  if not found then
    raise exception 'Master Agreement version not found' using errcode='P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sellertray-master-quarantine:'||p_agreement_version_id::text,0));
  select q.* into v_existing
  from public.sellertray_master_agreement_version_quarantines q
  where q.agreement_version_id=p_agreement_version_id;
  if found then
    return v_existing.id;
  end if;

  select count(*) into v_acceptance_count
  from public.sellertray_master_agreement_acceptances a
  where a.agreement_version_id=p_agreement_version_id;

  insert into public.sellertray_master_agreement_version_quarantines(
    agreement_version_id,reason,quarantined_by_user_id,quarantined_at,created_at
  ) values (
    p_agreement_version_id,v_reason,p_actor_user_id,now(),now()
  ) returning id into v_id;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (
    p_actor_user_id,
    null,
    'sellertray_master_agreement_version_quarantined',
    jsonb_build_object(
      'agreementVersionId',v_version.id,
      'versionCode',v_version.version_code,
      'contentSha256',v_version.content_sha256,
      'effectiveFrom',v_version.effective_from,
      'publishedAt',v_version.published_at,
      'acceptanceCountAtQuarantine',v_acceptance_count,
      'reason',v_reason
    )
  );
  return v_id;
end;
$$;
revoke all on function public.quarantine_sellertray_master_agreement_version_admin(uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.quarantine_sellertray_master_agreement_version_admin(uuid,text,uuid)
  to service_role;

create or replace function public.resolve_sellertray_master_agreement_version_id(
  p_as_of timestamptz default now()
)
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select v.id
  from public.sellertray_master_agreement_versions v
  where v.effective_from<=p_as_of
    and not exists (
      select 1
      from public.sellertray_master_agreement_version_quarantines q
      where q.agreement_version_id=v.id
    )
  order by v.effective_from desc,v.published_at desc,v.id desc
  limit 1
$$;
revoke all on function public.resolve_sellertray_master_agreement_version_id(timestamptz)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_master_agreement_version_id(timestamptz)
  to service_role;

-- Merchant history must not surface a quarantined non-production/legal-invalid
-- publication as if it were a historical SellerTray contract version.
create or replace function public.get_sellertray_master_agreement_center(
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
  v_role text;
  v_can_accept boolean;
  v_state jsonb;
  v_history jsonb;
begin
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if coalesce(v_role,'') not in ('owner','manager') then
    raise exception 'Master Agreement access requires a Business Owner or Manager' using errcode='42501';
  end if;

  v_can_accept:=public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
  );
  v_state:=public.get_sellertray_master_agreement_state(p_tenant_id,now());

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',v.id,
    'versionCode',v.version_code,
    'title',v.title,
    'contentBody',v.content_body,
    'contentSha256',v.content_sha256,
    'effectiveFrom',v.effective_from,
    'publishedAt',v.published_at,
    'acceptance',case when a.id is null then null else jsonb_build_object(
      'id',a.id,
      'acceptedAt',a.accepted_at,
      'acceptedLegalName',a.accepted_legal_name,
      'acceptedRole',a.accepted_role,
      'acceptedByCurrentUser',a.accepted_by_user_id=p_actor_user_id
    ) end
  ) order by v.effective_from desc,v.published_at desc),'[]'::jsonb)
  into v_history
  from public.sellertray_master_agreement_versions v
  left join public.sellertray_master_agreement_acceptances a
    on a.tenant_id=p_tenant_id and a.agreement_version_id=v.id
  where not exists (
    select 1
    from public.sellertray_master_agreement_version_quarantines q
    where q.agreement_version_id=v.id
  );

  return v_state || jsonb_build_object(
    'actorRole',v_role,
    'canAccept',v_can_accept,
    'versions',v_history
  );
end;
$$;
revoke all on function public.get_sellertray_master_agreement_center(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_master_agreement_center(uuid,uuid)
  to service_role;

-- Admin retains complete publication history, including the immutable quarantined
-- row and the explicit reason/evidence for removing it from current authority.
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
    'quarantinedByUserId',q.quarantined_by_user_id
  ) order by v.effective_from desc,v.published_at desc),'[]'::jsonb)
  into v_versions
  from public.sellertray_master_agreement_versions v
  left join public.sellertray_master_agreement_version_quarantines q
    on q.agreement_version_id=v.id;

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
