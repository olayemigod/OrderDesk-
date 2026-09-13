-- SellerTray Phase 1 hardening: bind every online payment attempt to the
-- merchant gateway environment in effect when the attempt is created.

alter table public.order_payments
  add column if not exists provider_mode text;

update public.order_payments p
set provider_mode = m.mode
from public.merchant_payment_methods m
where p.payment_method_id = m.id
  and p.tenant_id = m.tenant_id
  and p.method_type in ('paystack','flutterwave')
  and p.provider_mode is null;

update public.order_payments
set provider_mode = null
where method_type not in ('paystack','flutterwave');

alter table public.order_payments
  drop constraint if exists order_payments_provider_mode_check,
  add constraint order_payments_provider_mode_check
  check (
    (
      method_type in ('paystack','flutterwave')
      and provider_mode in ('test','live')
    )
    or
    (
      method_type not in ('paystack','flutterwave')
      and provider_mode is null
    )
  );

alter table sellertray_private.merchant_gateway_credentials
  add column if not exists credential_mode text;

update sellertray_private.merchant_gateway_credentials c
set credential_mode = m.mode
from public.merchant_payment_methods m
where m.id = c.payment_method_id
  and m.tenant_id = c.tenant_id
  and c.credential_mode is null;

alter table sellertray_private.merchant_gateway_credentials
  alter column credential_mode set not null,
  drop constraint if exists merchant_gateway_credentials_mode_check,
  add constraint merchant_gateway_credentials_mode_check
    check (credential_mode in ('test','live'));

create or replace function public.snapshot_sellertray_payment_provider_mode()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_method public.merchant_payment_methods%rowtype;
begin
  if new.method_type in ('paystack','flutterwave') then
    select * into v_method
    from public.merchant_payment_methods m
    where m.id = new.payment_method_id
      and m.tenant_id = new.tenant_id;

    if not found
       or v_method.method_type <> new.method_type
       or v_method.method_type <> new.provider then
      raise exception 'SellerTray gateway payment method mismatch' using errcode='23514';
    end if;

    new.provider_mode := v_method.mode;
  else
    new.provider_mode := null;
  end if;

  return new;
end;
$$;

revoke all on function public.snapshot_sellertray_payment_provider_mode()
  from public,anon,authenticated;

drop trigger if exists snapshot_sellertray_payment_provider_mode on public.order_payments;
create trigger snapshot_sellertray_payment_provider_mode
before insert on public.order_payments
for each row
execute function public.snapshot_sellertray_payment_provider_mode();

create or replace function public.guard_sellertray_payment_provider_mode()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.provider_mode is distinct from old.provider_mode then
    raise exception 'SellerTray payment provider mode is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sellertray_payment_provider_mode()
  from public,anon,authenticated;

drop trigger if exists guard_sellertray_payment_provider_mode on public.order_payments;
create trigger guard_sellertray_payment_provider_mode
before update on public.order_payments
for each row
execute function public.guard_sellertray_payment_provider_mode();

create or replace function sellertray_private.bind_gateway_credential_mode()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_method public.merchant_payment_methods%rowtype;
begin
  select * into v_method
  from public.merchant_payment_methods m
  where m.id = new.payment_method_id
    and m.tenant_id = new.tenant_id;

  if not found
     or v_method.method_type not in ('paystack','flutterwave')
     or v_method.method_type <> new.provider then
    raise exception 'SellerTray gateway credential payment method mismatch' using errcode='23514';
  end if;

  new.credential_mode := v_method.mode;
  return new;
end;
$$;

revoke all on function sellertray_private.bind_gateway_credential_mode()
  from public,anon,authenticated;

drop trigger if exists bind_gateway_credential_mode on sellertray_private.merchant_gateway_credentials;
create trigger bind_gateway_credential_mode
before insert or update on sellertray_private.merchant_gateway_credentials
for each row
execute function sellertray_private.bind_gateway_credential_mode();

create or replace function sellertray_private.guard_gateway_method_mode_change()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.mode is distinct from old.mode
     and old.method_type in ('paystack','flutterwave')
     and exists (
       select 1
       from sellertray_private.merchant_gateway_credentials c
       where c.payment_method_id = old.id
         and c.tenant_id = old.tenant_id
     ) then
    raise exception 'Disconnect SellerTray gateway credentials before changing test/live mode'
      using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function sellertray_private.guard_gateway_method_mode_change()
  from public,anon,authenticated;

drop trigger if exists guard_gateway_method_mode_change on public.merchant_payment_methods;
create trigger guard_gateway_method_mode_change
before update of mode on public.merchant_payment_methods
for each row
when (old.mode is distinct from new.mode)
execute function sellertray_private.guard_gateway_method_mode_change();

drop function if exists public.get_sellertray_gateway_credentials(uuid,uuid);

create function public.get_sellertray_gateway_credentials(
  p_tenant_id uuid,
  p_payment_method_id uuid
)
returns table(
  provider text,
  credential_mode text,
  credentials_ciphertext text,
  credentials_iv text,
  encryption_key_version integer,
  credential_fingerprint text
)
language sql
security definer
set search_path=''
as $$
  select
    c.provider,
    c.credential_mode,
    c.credentials_ciphertext,
    c.credentials_iv,
    c.encryption_key_version,
    c.credential_fingerprint
  from sellertray_private.merchant_gateway_credentials c
  where c.tenant_id=p_tenant_id
    and c.payment_method_id=p_payment_method_id;
$$;

revoke all on function public.get_sellertray_gateway_credentials(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_gateway_credentials(uuid,uuid)
  to service_role;
