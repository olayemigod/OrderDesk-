-- SellerTray Phase 1 resilience: fixed-window server-side request budgets.

create table if not exists sellertray_private.request_rate_limits (
  scope text not null,
  rate_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (scope,rate_key,window_started_at),
  constraint request_rate_limits_scope_check check (char_length(scope) between 1 and 80),
  constraint request_rate_limits_key_check check (char_length(rate_key) between 1 and 160),
  constraint request_rate_limits_count_check check (request_count >= 1)
);

revoke all on table sellertray_private.request_rate_limits from public,anon,authenticated;
grant all on table sellertray_private.request_rate_limits to service_role;

create index if not exists request_rate_limits_cleanup_idx
  on sellertray_private.request_rate_limits(window_started_at);

create or replace function public.consume_sellertray_rate_limit(
  p_scope text,
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_scope text := btrim(coalesce(p_scope,''));
  v_key text := btrim(coalesce(p_key,''));
  v_window timestamptz;
begin
  if char_length(v_scope) not between 1 and 80
     or char_length(v_key) not between 1 and 160
     or p_limit not between 1 and 100000
     or p_window_seconds not between 1 and 86400 then
    raise exception 'Invalid SellerTray rate-limit contract' using errcode='22023';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into sellertray_private.request_rate_limits (
    scope,rate_key,window_started_at,request_count,updated_at
  ) values (
    v_scope,v_key,v_window,1,now()
  )
  on conflict do nothing;

  if found then
    return true;
  end if;

  update sellertray_private.request_rate_limits r
  set request_count=r.request_count+1,
      updated_at=now()
  where r.scope=v_scope
    and r.rate_key=v_key
    and r.window_started_at=v_window
    and r.request_count<p_limit;

  return found;
end;
$$;

revoke all on function public.consume_sellertray_rate_limit(text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.consume_sellertray_rate_limit(text,text,integer,integer)
  to service_role;
