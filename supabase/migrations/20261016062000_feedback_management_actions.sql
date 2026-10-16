begin;

create table if not exists public.sellertray_feedback_management_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feedback_id uuid not null references public.sellertray_feedback(id) on delete cascade,
  actor_user_id uuid null references auth.users(id) on delete set null,
  from_status text not null
    check (from_status in ('new','reviewing','resolved','closed')),
  to_status text not null
    check (to_status in ('new','reviewing','resolved','closed')),
  admin_note text null,
  created_at timestamptz not null default now()
);

create index if not exists sellertray_feedback_management_events_feedback_idx
  on public.sellertray_feedback_management_events(feedback_id,created_at desc);
create index if not exists sellertray_feedback_management_events_tenant_idx
  on public.sellertray_feedback_management_events(tenant_id,created_at desc);

alter table public.sellertray_feedback_management_events enable row level security;
revoke all on table public.sellertray_feedback_management_events from public,anon,authenticated;
grant all on table public.sellertray_feedback_management_events to service_role;

create or replace function public.manage_sellertray_feedback(
  p_tenant_id uuid,
  p_feedback_id uuid,
  p_status text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_previous_status text;
  v_note text := nullif(btrim(coalesce(p_admin_note,'')),'');
  v_now timestamptz := now();
  v_reviewed_at timestamptz;
  v_resolved_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can manage feedback for this business' using errcode='42501';
  end if;

  if coalesce(p_status,'') not in ('reviewing','resolved') then
    raise exception 'Choose a valid feedback status' using errcode='22023';
  end if;

  if char_length(coalesce(v_note,'')) > 2000 then
    raise exception 'Review note is too long' using errcode='22023';
  end if;

  select f.status into v_previous_status
  from public.sellertray_feedback f
  where f.tenant_id=p_tenant_id and f.id=p_feedback_id
  for update;

  if not found then
    raise exception 'Feedback was not found for this business' using errcode='22023';
  end if;

  if v_previous_status='closed' then
    raise exception 'Closed feedback cannot be changed' using errcode='22023';
  end if;

  if v_previous_status='resolved' and p_status='reviewing' then
    raise exception 'Resolved feedback cannot return to review' using errcode='22023';
  end if;

  update public.sellertray_feedback f
  set
    status=p_status,
    admin_note=coalesce(v_note,f.admin_note),
    reviewed_at=case
      when p_status in ('reviewing','resolved') then coalesce(f.reviewed_at,v_now)
      else f.reviewed_at
    end,
    resolved_at=case
      when p_status='resolved' then coalesce(f.resolved_at,v_now)
      else f.resolved_at
    end,
    updated_at=v_now
  where f.tenant_id=p_tenant_id and f.id=p_feedback_id
  returning f.reviewed_at,f.resolved_at
  into v_reviewed_at,v_resolved_at;

  insert into public.sellertray_feedback_management_events(
    tenant_id,feedback_id,actor_user_id,from_status,to_status,admin_note,created_at
  ) values (
    p_tenant_id,p_feedback_id,v_user_id,v_previous_status,p_status,v_note,v_now
  );

  return jsonb_build_object(
    'feedbackId',p_feedback_id,
    'status',p_status,
    'reviewedAt',v_reviewed_at,
    'resolvedAt',v_resolved_at
  );
end;
$$;

revoke all on function public.manage_sellertray_feedback(uuid,uuid,text,text)
  from public,anon;
grant execute on function public.manage_sellertray_feedback(uuid,uuid,text,text)
  to authenticated,service_role;

commit;
