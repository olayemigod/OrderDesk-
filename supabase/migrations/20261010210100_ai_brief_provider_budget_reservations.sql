begin;

create table public.sellertray_ai_brief_provider_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null,
  reserved_on date not null default ((now() at time zone 'UTC')::date),
  created_at timestamptz not null default now(),
  unique (tenant_id,request_id)
);

create index sellertray_ai_brief_provider_reservations_budget_idx
  on public.sellertray_ai_brief_provider_reservations(tenant_id,reserved_on,created_at);

alter table public.sellertray_ai_brief_provider_reservations enable row level security;
revoke all on table public.sellertray_ai_brief_provider_reservations from public,anon,authenticated;
grant all on table public.sellertray_ai_brief_provider_reservations to service_role;

create policy sellertray_ai_brief_provider_reservations_deny_clients
on public.sellertray_ai_brief_provider_reservations
for all to anon,authenticated
using (false)
with check (false);

create or replace function public.prevent_sellertray_ai_brief_provider_reservation_mutation()
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
  raise exception 'SellerTray AI provider reservations are immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_ai_brief_provider_reservation_mutation()
  from public,anon,authenticated;

drop trigger if exists prevent_sellertray_ai_brief_provider_reservation_update
  on public.sellertray_ai_brief_provider_reservations;
create trigger prevent_sellertray_ai_brief_provider_reservation_update
before update on public.sellertray_ai_brief_provider_reservations
for each row execute function public.prevent_sellertray_ai_brief_provider_reservation_mutation();

drop trigger if exists prevent_sellertray_ai_brief_provider_reservation_delete
  on public.sellertray_ai_brief_provider_reservations;
create trigger prevent_sellertray_ai_brief_provider_reservation_delete
before delete on public.sellertray_ai_brief_provider_reservations
for each row execute function public.prevent_sellertray_ai_brief_provider_reservation_mutation();

create or replace function public.reserve_sellertray_ai_brief_provider_call(
  p_tenant_id uuid,
  p_request_id uuid,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_count integer;
  v_exists boolean;
begin
  if p_tenant_id is null or p_request_id is null then
    raise exception 'Tenant and request are required' using errcode='22023';
  end if;
  if p_daily_limit is null or p_daily_limit<1 or p_daily_limit>100 then
    raise exception 'AI Brief daily limit is invalid' using errcode='22023';
  end if;
  if not exists(select 1 from public.tenants t where t.id=p_tenant_id) then
    raise exception 'SellerTray business not found' using errcode='P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text||':'||v_day::text,0)
  );

  select exists(
    select 1 from public.sellertray_ai_brief_provider_reservations r
    where r.tenant_id=p_tenant_id and r.request_id=p_request_id
  ) into v_exists;

  select count(*)::integer into v_count
  from public.sellertray_ai_brief_provider_reservations r
  where r.tenant_id=p_tenant_id and r.reserved_on=v_day;

  if v_exists then
    return jsonb_build_object(
      'allowed',false,
      'replayed',true,
      'reason','request_already_reserved',
      'providerCallsToday',v_count,
      'remainingProviderCalls',greatest(0,p_daily_limit-v_count),
      'dailyLimit',p_daily_limit
    );
  end if;

  if v_count>=p_daily_limit then
    return jsonb_build_object(
      'allowed',false,
      'replayed',false,
      'reason','daily_budget_reached',
      'providerCallsToday',v_count,
      'remainingProviderCalls',0,
      'dailyLimit',p_daily_limit
    );
  end if;

  insert into public.sellertray_ai_brief_provider_reservations(
    tenant_id,request_id,reserved_on
  ) values(p_tenant_id,p_request_id,v_day);

  v_count:=v_count+1;
  return jsonb_build_object(
    'allowed',true,
    'replayed',false,
    'reason',null,
    'providerCallsToday',v_count,
    'remainingProviderCalls',greatest(0,p_daily_limit-v_count),
    'dailyLimit',p_daily_limit
  );
end;
$$;

revoke all on function public.reserve_sellertray_ai_brief_provider_call(uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.reserve_sellertray_ai_brief_provider_call(uuid,uuid,integer)
  to service_role;

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
  v_day date:=(now() at time zone 'UTC')::date;
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
      select count(*) from public.sellertray_ai_brief_provider_reservations r
      where r.tenant_id=p_tenant_id and r.reserved_on=v_day
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