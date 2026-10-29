begin;

create or replace function public.get_sellertray_feedback_dashboard(
  p_tenant_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_limit integer := least(greatest(coalesce(p_limit,100),1),250);
  v_member_count integer := 0;
  v_feedback_users integer := 0;
  v_submission_count integer := 0;
  v_new_count integer := 0;
  v_average_rating numeric;
  v_members jsonb := '[]'::jsonb;
  v_submissions jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can view feedback for this business' using errcode='42501';
  end if;

  select
    count(*)::integer,
    count(*) filter (where s.submission_count>0)::integer
  into v_member_count,v_feedback_users
  from public.tenant_members tm
  left join (
    select f.user_id,count(*)::integer submission_count
    from public.sellertray_feedback f
    where f.tenant_id=p_tenant_id
    group by f.user_id
  ) s on s.user_id=tm.user_id
  where tm.tenant_id=p_tenant_id;

  select
    count(*)::integer,
    count(*) filter (where f.status='new')::integer,
    round(avg(f.rating)::numeric,2)
  into v_submission_count,v_new_count,v_average_rating
  from public.sellertray_feedback f
  where f.tenant_id=p_tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',x.user_id,
    'displayName',x.display_name,
    'email',x.email,
    'role',x.role,
    'hasSubmitted',x.submission_count>0,
    'submissionCount',x.submission_count,
    'latestSubmittedAt',x.latest_submitted_at
  ) order by x.display_name,x.email),'[]'::jsonb)
  into v_members
  from (
    select
      tm.user_id,
      coalesce(
        nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
        nullif(btrim(u.raw_user_meta_data->>'name'),''),
        nullif(btrim(u.email),''),
        'Team member'
      ) display_name,
      u.email,
      tm.role,
      coalesce(s.submission_count,0) submission_count,
      s.latest_submitted_at
    from public.tenant_members tm
    join auth.users u on u.id=tm.user_id
    left join (
      select f.user_id,count(*)::integer submission_count,max(f.created_at) latest_submitted_at
      from public.sellertray_feedback f
      where f.tenant_id=p_tenant_id
      group by f.user_id
    ) s on s.user_id=tm.user_id
    where tm.tenant_id=p_tenant_id
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,
    'userId',x.user_id,
    'displayName',x.display_name,
    'email',x.email,
    'role',x.role,
    'branchId',x.branch_id,
    'branchName',x.branch_name,
    'feedbackType',x.feedback_type,
    'rating',x.rating,
    'message',x.message,
    'status',x.status,
    'appVersion',x.app_version,
    'platform',x.platform,
    'createdAt',x.created_at
  ) order by x.created_at desc,x.id desc),'[]'::jsonb)
  into v_submissions
  from (
    select
      f.id,f.user_id,
      coalesce(
        nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
        nullif(btrim(u.raw_user_meta_data->>'name'),''),
        nullif(btrim(u.email),''),
        'Team member'
      ) display_name,
      u.email,tm.role,f.branch_id,b.name branch_name,
      f.feedback_type,f.rating,f.message,f.status,f.app_version,f.platform,f.created_at
    from public.sellertray_feedback f
    join public.tenant_members tm
      on tm.tenant_id=f.tenant_id and tm.user_id=f.user_id
    join auth.users u on u.id=f.user_id
    left join public.branches b
      on b.tenant_id=f.tenant_id and b.id=f.branch_id
    where f.tenant_id=p_tenant_id
    order by f.created_at desc,f.id desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'summary',jsonb_build_object(
      'memberCount',v_member_count,
      'feedbackUsers',v_feedback_users,
      'submissionCount',v_submission_count,
      'newCount',v_new_count,
      'averageRating',v_average_rating
    ),
    'members',v_members,
    'submissions',v_submissions
  );
end;
$$;

revoke all on function public.get_sellertray_feedback_dashboard(uuid,integer)
  from public,anon;
grant execute on function public.get_sellertray_feedback_dashboard(uuid,integer)
  to authenticated,service_role;

commit;
