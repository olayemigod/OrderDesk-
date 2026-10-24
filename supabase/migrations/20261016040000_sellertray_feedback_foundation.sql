begin;

create table if not exists public.sellertray_feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid null references public.branches(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null default 'general'
    check (feedback_type in ('general','experience','feature_request','problem')),
  rating smallint null check (rating between 1 and 5),
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  app_version text null,
  platform text null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'new'
    check (status in ('new','reviewing','resolved','closed')),
  admin_note text null,
  reviewed_at timestamptz null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sellertray_feedback_tenant_created_idx
  on public.sellertray_feedback(tenant_id,created_at desc);
create index if not exists sellertray_feedback_user_created_idx
  on public.sellertray_feedback(user_id,created_at desc);
create index if not exists sellertray_feedback_status_created_idx
  on public.sellertray_feedback(status,created_at desc);

alter table public.sellertray_feedback enable row level security;

drop policy if exists sellertray_feedback_select_own on public.sellertray_feedback;
create policy sellertray_feedback_select_own
on public.sellertray_feedback
for select to authenticated
using (
  user_id=(select auth.uid())
  and exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=sellertray_feedback.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

drop policy if exists sellertray_feedback_insert_own on public.sellertray_feedback;
create policy sellertray_feedback_insert_own
on public.sellertray_feedback
for insert to authenticated
with check (
  user_id=(select auth.uid())
  and exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=sellertray_feedback.tenant_id
      and tm.user_id=(select auth.uid())
  )
  and (
    branch_id is null
    or public.sellertray_current_user_can_read_branch(tenant_id,branch_id)
  )
);

revoke insert,update,delete on public.sellertray_feedback from anon;
revoke update,delete on public.sellertray_feedback from authenticated;
grant select,insert on public.sellertray_feedback to authenticated;
grant all on public.sellertray_feedback to service_role;

create or replace function public.submit_sellertray_feedback(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_feedback_type text,
  p_rating smallint,
  p_message text,
  p_app_version text default null,
  p_platform text default null,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=(select auth.uid());
  v_feedback_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in to send feedback' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'You do not have access to this business' using errcode='42501';
  end if;
  if p_branch_id is not null
     and not public.sellertray_current_user_can_read_branch(p_tenant_id,p_branch_id) then
    raise exception 'You do not have access to this Branch' using errcode='42501';
  end if;
  if coalesce(p_feedback_type,'') not in ('general','experience','feature_request','problem') then
    raise exception 'Choose a valid feedback type' using errcode='22023';
  end if;
  if p_rating is not null and (p_rating<1 or p_rating>5) then
    raise exception 'Rating must be between 1 and 5' using errcode='22023';
  end if;
  if char_length(btrim(coalesce(p_message,''))) not between 1 and 4000 then
    raise exception 'Feedback message is required' using errcode='22023';
  end if;

  insert into public.sellertray_feedback(
    tenant_id,branch_id,user_id,feedback_type,rating,message,
    app_version,platform,context
  ) values (
    p_tenant_id,p_branch_id,v_user_id,p_feedback_type,p_rating,btrim(p_message),
    nullif(btrim(coalesce(p_app_version,'')),''),
    nullif(btrim(coalesce(p_platform,'')),''),
    coalesce(p_context,'{}'::jsonb)
  ) returning id into v_feedback_id;

  return v_feedback_id;
end;
$$;

revoke all on function public.submit_sellertray_feedback(uuid,uuid,text,smallint,text,text,text,jsonb)
  from public,anon;
grant execute on function public.submit_sellertray_feedback(uuid,uuid,text,smallint,text,text,text,jsonb)
  to authenticated,service_role;

create or replace function public.sellertray_feedback_state(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=(select auth.uid());
  v_count integer:=0;
  v_latest timestamptz;
begin
  if v_user_id is null then
    raise exception 'Sign in to view feedback status' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'You do not have access to this business' using errcode='42501';
  end if;

  select count(*)::integer,max(f.created_at)
  into v_count,v_latest
  from public.sellertray_feedback f
  where f.tenant_id=p_tenant_id and f.user_id=v_user_id;

  return jsonb_build_object(
    'hasSubmitted',v_count>0,
    'submissionCount',v_count,
    'latestSubmittedAt',v_latest
  );
end;
$$;

revoke all on function public.sellertray_feedback_state(uuid) from public,anon;
grant execute on function public.sellertray_feedback_state(uuid) to authenticated,service_role;

commit;
