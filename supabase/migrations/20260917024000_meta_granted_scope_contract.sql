-- SellerTray: persist the exact Meta scopes granted to each tenant connection.
-- WhatsApp messaging remains independent; catalogue automation fails closed unless
-- the Meta token explicitly carries business_management + catalog_management.

begin;

alter table public.tenant_whatsapp_connections
  add column if not exists granted_scopes text[] not null default '{}'::text[];

alter table public.tenant_whatsapp_connections
  drop constraint if exists tenant_whatsapp_connections_granted_scopes_size_check;

alter table public.tenant_whatsapp_connections
  add constraint tenant_whatsapp_connections_granted_scopes_size_check
  check (cardinality(granted_scopes) <= 64);

create or replace function public.clear_sellertray_meta_scopes_when_disconnected()
returns trigger
language plpgsql
security definer
set search_path=''
as $
begin
  if new.connection_status <> 'connected' then
    new.granted_scopes := '{}'::text[];
  end if;
  return new;
end;
$;

revoke all on function public.clear_sellertray_meta_scopes_when_disconnected()
from public,anon,authenticated;

drop trigger if exists clear_sellertray_meta_scopes_when_disconnected
on public.tenant_whatsapp_connections;

create trigger clear_sellertray_meta_scopes_when_disconnected
before insert or update of connection_status
on public.tenant_whatsapp_connections
for each row execute function public.clear_sellertray_meta_scopes_when_disconnected();

create or replace function public.set_sellertray_whatsapp_granted_scopes(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_scopes text[]
)
returns text[]
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_scopes text[];
begin
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  if v_role <> 'owner' then
    raise exception 'Only the business Owner can update WhatsApp authorization metadata'
      using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.tenant_whatsapp_connections c
    where c.tenant_id=p_tenant_id
  ) then
    raise exception 'WhatsApp connection not found' using errcode='P0002';
  end if;

  select coalesce(
    array_agg(scope order by scope),
    '{}'::text[]
  )
  into v_scopes
  from (
    select distinct lower(btrim(s)) as scope
    from unnest(coalesce(p_scopes,'{}'::text[])) as u(s)
    where nullif(btrim(s),'') is not null
      and char_length(btrim(s)) <= 128
      and lower(btrim(s)) ~ '^[a-z0-9_.:-]+$'
    limit 64
  ) normalized;

  update public.tenant_whatsapp_connections
  set granted_scopes=v_scopes,
      updated_by_user_id=p_actor_user_id,
      updated_at=now()
  where tenant_id=p_tenant_id;

  return v_scopes;
end;
$$;

revoke all on function public.set_sellertray_whatsapp_granted_scopes(uuid,uuid,text[])
from public,anon,authenticated;

grant execute on function public.set_sellertray_whatsapp_granted_scopes(uuid,uuid,text[])
to service_role;

commit;
