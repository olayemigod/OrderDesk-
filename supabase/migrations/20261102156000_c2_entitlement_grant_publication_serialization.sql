begin;

-- Prevent a grant mutation from racing Plan Profile/add-on publication.
-- Parent version rows are locked in deterministic UUID order before status is
-- evaluated, so publication and grant edits serialize on the same authority.
create or replace function public.guard_sellertray_profile_grant_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_old_parent_id uuid;
  v_new_parent_id uuid;
  v_old_status text;
  v_new_status text;
begin
  if tg_table_name like 'sellertray_plan_profile_%' then
    if tg_op in ('UPDATE','DELETE') then
      v_old_parent_id:=old.plan_profile_version_id;
    end if;
    if tg_op in ('INSERT','UPDATE') then
      v_new_parent_id:=new.plan_profile_version_id;
    end if;

    perform 1
    from public.sellertray_plan_profile_versions v
    where v.id in (v_old_parent_id,v_new_parent_id)
    order by v.id
    for update;

    if v_old_parent_id is not null then
      select v.status into v_old_status
      from public.sellertray_plan_profile_versions v
      where v.id=v_old_parent_id;
    end if;
    if v_new_parent_id is not null then
      select v.status into v_new_status
      from public.sellertray_plan_profile_versions v
      where v.id=v_new_parent_id;
    end if;
  else
    if tg_op in ('UPDATE','DELETE') then
      v_old_parent_id:=old.addon_version_id;
    end if;
    if tg_op in ('INSERT','UPDATE') then
      v_new_parent_id:=new.addon_version_id;
    end if;

    perform 1
    from public.sellertray_addon_versions v
    where v.id in (v_old_parent_id,v_new_parent_id)
    order by v.id
    for update;

    if v_old_parent_id is not null then
      select v.status into v_old_status
      from public.sellertray_addon_versions v
      where v.id=v_old_parent_id;
    end if;
    if v_new_parent_id is not null then
      select v.status into v_new_status
      from public.sellertray_addon_versions v
      where v.id=v_new_parent_id;
    end if;
  end if;

  if (tg_op in ('UPDATE','DELETE') and v_old_status is distinct from 'draft')
     or (tg_op in ('INSERT','UPDATE') and v_new_status is distinct from 'draft') then
    raise exception 'Published or retired entitlement grants are immutable' using errcode='55000';
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$function$;

revoke all on function public.guard_sellertray_profile_grant_mutation()
  from public,anon,authenticated;

commit;
