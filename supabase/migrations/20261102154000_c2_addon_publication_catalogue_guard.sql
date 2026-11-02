begin;

-- Keep add-on publication symmetric with Plan Profile publication: a published
-- commercial entitlement must not depend on planned or retired catalogue rows.
create or replace function public.publish_sellertray_addon_version_admin(
  p_addon_version_id uuid,
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
  v_reason text:=btrim(coalesce(p_reason,''));
  v_result uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.plans.manage',null,now()) then
    raise exception 'Plan Profile management capability required' using errcode='42501';
  end if;
  if p_effective_from is null or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Effective time and a reason between 6 and 1000 characters are required' using errcode='22023';
  end if;
  if exists(
    select 1 from public.sellertray_addon_versions v
    where v.id=p_addon_version_id and v.status='published'
      and v.effective_from=p_effective_from and v.change_reason=v_reason
  ) then
    return p_addon_version_id;
  end if;
  if not exists(
    select 1 from public.sellertray_addon_versions v
    where v.id=p_addon_version_id and v.status='draft'
  ) then
    raise exception 'Draft add-on version not found' using errcode='P0002';
  end if;
  if not exists(
      select 1 from public.sellertray_addon_feature_grants g
      where g.addon_version_id=p_addon_version_id and g.enabled
    )
    and not exists(
      select 1 from public.sellertray_addon_capability_grants g
      where g.addon_version_id=p_addon_version_id and g.enabled
    )
    and not exists(
      select 1 from public.sellertray_addon_limit_values g
      where g.addon_version_id=p_addon_version_id
    ) then
    raise exception 'Add-on version requires governed entitlement content before publication' using errcode='23514';
  end if;
  if exists(
    select 1
    from public.sellertray_addon_feature_grants g
    join public.sellertray_feature_catalogue c on c.code=g.feature_code
    where g.addon_version_id=p_addon_version_id and c.status<>'active'
  ) or exists(
    select 1
    from public.sellertray_addon_capability_grants g
    join public.sellertray_capability_catalogue c on c.code=g.capability_code
    where g.addon_version_id=p_addon_version_id and c.status<>'active'
  ) or exists(
    select 1
    from public.sellertray_addon_limit_values g
    join public.sellertray_limit_definitions c on c.code=g.limit_code
    where g.addon_version_id=p_addon_version_id and c.status<>'active'
  ) then
    raise exception 'Add-on version references catalogue entries that are not active' using errcode='23514';
  end if;

  update public.sellertray_addon_versions v
  set status='published',effective_from=p_effective_from,change_reason=v_reason,
      published_by_user_id=p_actor_user_id,published_at=now()
  where v.id=p_addon_version_id and v.status='draft'
  returning v.id into v_result;

  if v_result is null then
    raise exception 'Add-on publication conflicted with another change' using errcode='40001';
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,null,'sellertray_publish_addon_version',
    jsonb_build_object(
      'addonVersionId',v_result,
      'effectiveFrom',p_effective_from,
      'reason',v_reason
    )
  );
  return v_result;
end;
$function$;

revoke all on function public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid)
  from public,anon,authenticated;
grant execute on function public.publish_sellertray_addon_version_admin(uuid,timestamptz,text,uuid)
  to service_role;

commit;
