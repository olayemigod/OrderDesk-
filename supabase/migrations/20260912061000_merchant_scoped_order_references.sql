-- SellerTray merchant-scoped customer references.
-- New merchants choose a permanent unique 3-character Merchant ID during onboarding.
-- Customer-visible order/receipt references become <MERCHANT>/<SEQUENCE>, e.g. PIS/000001.
-- Internal UUIDs remain the security/relational identity.

begin;

alter table public.tenants add column if not exists merchant_code text;

do $$
declare
  r record;
  v_compact text;
  v_candidate text;
  v_try integer;
begin
  for r in
    select id, name
    from public.tenants
    where merchant_code is null
    order by created_at, id
  loop
    v_compact := upper(regexp_replace(coalesce(r.name,''), '[^A-Za-z0-9]', '', 'g'));
    v_candidate := rpad(substr(v_compact, 1, 3), 3, 'X');

    if not exists (select 1 from public.tenants t where t.merchant_code = v_candidate) then
      update public.tenants set merchant_code = v_candidate where id = r.id;
      continue;
    end if;

    for v_try in 0..4095 loop
      v_candidate := upper(substr(md5(r.id::text || ':' || v_try::text), 1, 3));
      exit when not exists (select 1 from public.tenants t where t.merchant_code = v_candidate);
    end loop;

    if exists (select 1 from public.tenants t where t.merchant_code = v_candidate) then
      raise exception 'Unable to allocate unique 3-character merchant ID';
    end if;

    update public.tenants set merchant_code = v_candidate where id = r.id;
  end loop;
end $$;

alter table public.tenants alter column merchant_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.tenants'::regclass
      and conname='tenants_merchant_code_key'
  ) then
    alter table public.tenants
      add constraint tenants_merchant_code_key unique (merchant_code);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.tenants'::regclass
      and conname='tenants_merchant_code_format_check'
  ) then
    alter table public.tenants
      add constraint tenants_merchant_code_format_check
      check (merchant_code ~ '^[A-Z0-9]{3}$');
  end if;
end $$;

create schema if not exists sellertray_private;
revoke all on schema sellertray_private from public;
revoke all on schema sellertray_private from anon;
revoke all on schema sellertray_private from authenticated;

create table if not exists sellertray_private.tenant_order_sequences (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now()
);

revoke all on table sellertray_private.tenant_order_sequences from public;
revoke all on table sellertray_private.tenant_order_sequences from anon;
revoke all on table sellertray_private.tenant_order_sequences from authenticated;

drop trigger if exists set_sellertray_order_public_id on public.orders;
drop trigger if exists guard_sellertray_order_public_id on public.orders;
drop function if exists public.set_sellertray_order_public_id();

alter table public.orders drop constraint if exists orders_public_order_id_format_check;

with ranked as (
  select
    o.id,
    o.tenant_id,
    row_number() over (partition by o.tenant_id order by o.created_at, o.id) as seq,
    t.merchant_code
  from public.orders o
  join public.tenants t on t.id=o.tenant_id
)
update public.orders o
set public_order_id = ranked.merchant_code || '/' || lpad(ranked.seq::text, 6, '0'),
    receipt_storage_path = null,
    receipt_generated_at = null
from ranked
where o.id=ranked.id;

insert into sellertray_private.tenant_order_sequences (tenant_id,last_value,updated_at)
select o.tenant_id, count(*)::bigint, now()
from public.orders o
group by o.tenant_id
on conflict (tenant_id) do update
set last_value=excluded.last_value,
    updated_at=now();

alter table public.orders
  add constraint orders_public_order_id_format_check
  check (public_order_id ~ '^[A-Z0-9]{3}/[0-9]{6,}$');

create or replace function sellertray_private.assign_order_reference()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_code text;
  v_seq bigint;
begin
  select t.merchant_code
  into v_code
  from public.tenants t
  where t.id=new.tenant_id;

  if v_code is null then
    raise exception 'SellerTray merchant ID is missing for tenant' using errcode='23514';
  end if;

  insert into sellertray_private.tenant_order_sequences (tenant_id,last_value,updated_at)
  values (new.tenant_id,1,now())
  on conflict (tenant_id) do update
  set last_value=sellertray_private.tenant_order_sequences.last_value + 1,
      updated_at=now()
  returning last_value into v_seq;

  new.public_order_id := v_code || '/' || lpad(v_seq::text, 6, '0');
  return new;
end;
$$;

revoke all on function sellertray_private.assign_order_reference() from public;
revoke all on function sellertray_private.assign_order_reference() from anon;
revoke all on function sellertray_private.assign_order_reference() from authenticated;

create trigger set_sellertray_order_public_id
before insert on public.orders
for each row
execute function sellertray_private.assign_order_reference();

create or replace function public.guard_sellertray_order_public_id()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.public_order_id is distinct from old.public_order_id then
    raise exception 'SellerTray order reference is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;

create trigger guard_sellertray_order_public_id
before update of public_order_id on public.orders
for each row
when (old.public_order_id is distinct from new.public_order_id)
execute function public.guard_sellertray_order_public_id();

create or replace function public.guard_sellertray_merchant_code()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.merchant_code is distinct from old.merchant_code then
    raise exception 'SellerTray merchant ID is permanent after onboarding' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_sellertray_merchant_code on public.tenants;
create trigger guard_sellertray_merchant_code
before update of merchant_code on public.tenants
for each row
when (old.merchant_code is distinct from new.merchant_code)
execute function public.guard_sellertray_merchant_code();

drop function if exists public.provision_business_for_user(uuid,text,text,text,text);

create function public.provision_business_for_user(
  p_user_id uuid,
  p_name text,
  p_business_email text default null,
  p_business_phone text default null,
  p_business_type text default null,
  p_merchant_code text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant_id uuid;
  v_slug_base text;
  v_slug text;
  v_code text;
  v_compact text;
  v_try integer;
  v_user_chosen boolean := nullif(btrim(coalesce(p_merchant_code,'')),'') is not null;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users u where u.id=p_user_id
  ) then
    raise exception 'Valid user is required' using errcode='42501';
  end if;

  if exists (
    select 1 from public.tenant_members tm where tm.user_id=p_user_id
  ) then
    raise exception 'Initial business provisioning is only available when no workspace exists' using errcode='23514';
  end if;

  if nullif(btrim(p_name),'') is null then
    raise exception 'Business name is required' using errcode='23514';
  end if;

  if v_user_chosen then
    v_code := upper(btrim(p_merchant_code));
    if v_code !~ '^[A-Z0-9]{3}$' then
      raise exception 'Merchant ID must be exactly 3 letters or numbers' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('sellertray-merchant-code:' || v_code));
    if exists (select 1 from public.tenants t where t.merchant_code=v_code) then
      raise exception 'Merchant ID % is already in use. Choose another 3-character ID.', v_code using errcode='23505';
    end if;
  else
    v_compact := upper(regexp_replace(btrim(p_name), '[^A-Za-z0-9]', '', 'g'));
    v_code := rpad(substr(v_compact,1,3),3,'X');

    perform pg_advisory_xact_lock(hashtext('sellertray-merchant-code:' || v_code));
    if exists (select 1 from public.tenants t where t.merchant_code=v_code) then
      for v_try in 0..4095 loop
        v_code := upper(substr(md5(p_user_id::text || ':' || p_name || ':' || v_try::text),1,3));
        perform pg_advisory_xact_lock(hashtext('sellertray-merchant-code:' || v_code));
        exit when not exists (select 1 from public.tenants t where t.merchant_code=v_code);
      end loop;
    end if;

    if exists (select 1 from public.tenants t where t.merchant_code=v_code) then
      raise exception 'Unable to allocate merchant ID. Choose a 3-character ID.' using errcode='23505';
    end if;
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base='' then v_slug_base := 'business'; end if;
  v_slug := left(v_slug_base,48) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  insert into public.tenants (
    name,slug,merchant_code,business_email,business_phone,business_type,
    currency,timezone,onboarding_status,subscription_status,whatsapp_connection_status
  ) values (
    btrim(p_name),v_slug,v_code,
    nullif(btrim(p_business_email),''),
    nullif(btrim(p_business_phone),''),
    nullif(btrim(p_business_type),''),
    'NGN','Africa/Lagos','catalogue','trial','not_connected'
  )
  returning id into v_tenant_id;

  insert into public.tenant_members (tenant_id,user_id,role)
  values (v_tenant_id,p_user_id,'owner');

  return v_tenant_id;
end;
$$;

revoke all on function public.provision_business_for_user(uuid,text,text,text,text,text) from public;
revoke all on function public.provision_business_for_user(uuid,text,text,text,text,text) from anon;
revoke all on function public.provision_business_for_user(uuid,text,text,text,text,text) from authenticated;
grant execute on function public.provision_business_for_user(uuid,text,text,text,text,text) to service_role;

commit;
