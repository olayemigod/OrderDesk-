-- SellerTray public order ID entropy hardening.
-- Expands the UUID-derived suffix from 40 bits (10 hex chars) to 64 bits
-- before Meta production rollout. Existing QA-only IDs are reissued atomically.

begin;

drop trigger if exists guard_sellertray_order_public_id on public.orders;

alter table public.orders
  drop constraint if exists orders_public_order_id_format_check;

create or replace function public.set_sellertray_order_public_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.public_order_id is null or btrim(new.public_order_id) = '' then
    new.public_order_id :=
      'ST-' ||
      to_char(coalesce(new.created_at, now()), 'YYMMDD') ||
      '-' ||
      upper(substr(md5(new.id::text), 1, 16));
  end if;
  return new;
end;
$$;

update public.orders
set public_order_id =
  'ST-' ||
  to_char(coalesce(created_at, now()), 'YYMMDD') ||
  '-' ||
  upper(substr(md5(id::text), 1, 16))
where public_order_id ~ '^ST-[0-9]{6}-[A-F0-9]{10}$';

alter table public.orders
  add constraint orders_public_order_id_format_check
  check (public_order_id ~ '^ST-[0-9]{6}-[A-F0-9]{16}$');

create trigger guard_sellertray_order_public_id
before update of public_order_id on public.orders
for each row
when (old.public_order_id is distinct from new.public_order_id)
execute function public.guard_sellertray_order_public_id();

commit;
