-- SellerTray clean-install repair: durable runtime configuration and WhatsApp
-- notification worker invocation contract. Production may populate runtime_config
-- out-of-band; clean database replay must still have the complete schema/functions.

begin;

create schema if not exists sellertray_private;
revoke all on schema sellertray_private from public,anon,authenticated;
grant usage on schema sellertray_private to service_role;

create table if not exists sellertray_private.runtime_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on sellertray_private.runtime_config from public,anon,authenticated;
grant all on sellertray_private.runtime_config to service_role;

create table if not exists sellertray_private.notification_worker_invocations (
  nonce uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz
);

create index if not exists notification_worker_invocations_expiry_idx
  on sellertray_private.notification_worker_invocations(expires_at)
  where consumed_at is null;

revoke all on sellertray_private.notification_worker_invocations from public,anon,authenticated;
grant all on sellertray_private.notification_worker_invocations to service_role;

create or replace function public.claim_sellertray_notification_worker_invocation(
  p_nonce uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claimed uuid;
begin
  delete from sellertray_private.notification_worker_invocations
  where expires_at <= now()
     or (consumed_at is not null and consumed_at < now() - interval '1 day');

  update sellertray_private.notification_worker_invocations
  set consumed_at=now()
  where nonce=p_nonce
    and consumed_at is null
    and expires_at>now()
  returning nonce into v_claimed;

  return v_claimed is not null;
end;
$$;

revoke all on function public.claim_sellertray_notification_worker_invocation(uuid)
from public,anon,authenticated;
grant execute on function public.claim_sellertray_notification_worker_invocation(uuid)
to service_role;

create or replace function sellertray_private.kick_whatsapp_notification_worker()
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_url text;
  v_nonce uuid;
begin
  select rc.value
  into v_url
  from sellertray_private.runtime_config rc
  where rc.key='whatsapp_notification_worker_url';

  if nullif(btrim(v_url),'') is null then return; end if;

  insert into sellertray_private.notification_worker_invocations default values
  returning nonce into v_nonce;

  perform net.http_post(
    url:=v_url,
    headers:=jsonb_build_object('Content-Type','application/json'),
    body:=jsonb_build_object('invocationNonce',v_nonce),
    timeout_milliseconds:=10000
  );
end;
$$;

revoke all on function sellertray_private.kick_whatsapp_notification_worker()
from public,anon,authenticated;
grant execute on function sellertray_private.kick_whatsapp_notification_worker()
to service_role;

-- Recreate the public service-role wrapper after the private implementation
-- exists so both immediate kicks and cron use the same governed path.
create or replace function public.sellertray_kick_notification_worker()
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  perform sellertray_private.kick_whatsapp_notification_worker();
end;
$$;

revoke all on function public.sellertray_kick_notification_worker()
from public,anon,authenticated;
grant execute on function public.sellertray_kick_notification_worker()
to service_role;

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname='sellertray-whatsapp-notification-retry'
  ) then
    perform cron.schedule(
      'sellertray-whatsapp-notification-retry',
      '* * * * *',
      'select sellertray_private.kick_whatsapp_notification_worker();'
    );
  end if;
end
$$;

commit;
