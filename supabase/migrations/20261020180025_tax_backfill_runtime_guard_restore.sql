begin;

-- The historical zero-tax snapshot backfill has completed. Restore the normal
-- runtime write and return-history guards immediately so no migration-only
-- exception survives into SellerTray operation.
create or replace function public.guard_orderdesk_subscription_write()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  if not public.orderdesk_subscription_can_write(v_tenant_id) then
    raise exception 'SellerTray subscription is read-only. Renew or reactivate the business to make changes.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$function$;

revoke all on function public.guard_orderdesk_subscription_write()
from public,anon,authenticated;

create or replace function public.prevent_sellertray_return_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  raise exception 'SellerTray return and refund records are immutable' using errcode='55000';
end;
$function$;

revoke all on function public.prevent_sellertray_return_mutation()
from public,anon,authenticated;

commit;
