begin;

create table public.sellertray_ai_brief_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  request_id uuid not null,
  period_days integer not null check (period_days in (7,30,90)),
  question_present boolean not null default false,
  provider text not null default 'openai' check (provider='openai'),
  model text,
  outcome text not null check (
    outcome in ('success','provider_error','invalid_output','network_error','not_configured','daily_budget_fallback')
  ),
  provider_called boolean not null default false,
  provider_http_status integer check (provider_http_status is null or provider_http_status between 100 and 599),
  input_tokens integer check (input_tokens is null or input_tokens>=0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens>=0),
  output_tokens integer check (output_tokens is null or output_tokens>=0),
  reasoning_tokens integer check (reasoning_tokens is null or reasoning_tokens>=0),
  total_tokens integer check (total_tokens is null or total_tokens>=0),
  context_bytes integer not null check (context_bytes>=0),
  context_fingerprint text not null check (char_length(context_fingerprint)=64),
  duration_ms integer check (duration_ms is null or duration_ms>=0),
  created_at timestamptz not null default now(),
  unique (tenant_id,request_id)
);

create index sellertray_ai_brief_attempts_tenant_created_idx
  on public.sellertray_ai_brief_attempts(tenant_id,created_at desc);
create index sellertray_ai_brief_attempts_provider_budget_idx
  on public.sellertray_ai_brief_attempts(tenant_id,provider_called,created_at desc);

alter table public.sellertray_ai_brief_attempts enable row level security;
revoke all on table public.sellertray_ai_brief_attempts from public,anon,authenticated;
grant all on table public.sellertray_ai_brief_attempts to service_role;

create policy sellertray_ai_brief_attempts_deny_clients
on public.sellertray_ai_brief_attempts
for all to anon,authenticated
using (false)
with check (false);

create or replace function public.prevent_sellertray_ai_brief_attempt_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' and not exists(
    select 1 from public.tenants t where t.id=old.tenant_id
  ) then
    return old;
  end if;
  raise exception 'SellerTray AI Brief telemetry is immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_ai_brief_attempt_mutation()
  from public,anon,authenticated;

drop trigger if exists prevent_sellertray_ai_brief_attempt_update
  on public.sellertray_ai_brief_attempts;
create trigger prevent_sellertray_ai_brief_attempt_update
before update on public.sellertray_ai_brief_attempts
for each row execute function public.prevent_sellertray_ai_brief_attempt_mutation();

drop trigger if exists prevent_sellertray_ai_brief_attempt_delete
  on public.sellertray_ai_brief_attempts;
create trigger prevent_sellertray_ai_brief_attempt_delete
before delete on public.sellertray_ai_brief_attempts
for each row execute function public.prevent_sellertray_ai_brief_attempt_mutation();

create or replace function public.get_sellertray_ai_brief_usage(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_role text;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Owner or Manager access is required for AI Brief' using errcode='42501';
  end if;

  return jsonb_build_object(
    'generatedToday',(
      select count(*) from public.sellertray_ai_brief_attempts a
      where a.tenant_id=p_tenant_id and a.created_at>=date_trunc('day',now())
    ),
    'providerCallsToday',(
      select count(*) from public.sellertray_ai_brief_attempts a
      where a.tenant_id=p_tenant_id and a.provider_called=true
        and a.created_at>=date_trunc('day',now())
    ),
    'lastGeneratedAt',(
      select max(a.created_at) from public.sellertray_ai_brief_attempts a
      where a.tenant_id=p_tenant_id
    )
  );
end;
$$;

revoke all on function public.get_sellertray_ai_brief_usage(uuid) from public,anon;
grant execute on function public.get_sellertray_ai_brief_usage(uuid) to authenticated,service_role;

commit;