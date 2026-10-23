begin;

-- OA1 live-operation gating must not turn governed parent Business deletion into
-- an operational mutation failure. Existing history/retention constraints still
-- govern direct child deletion while the Business exists; only FK cascade cleanup
-- after the tenant row is no longer visible may pass this onboarding gate.
create or replace function public.guard_sellertray_onboarding_live_operation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;

  if tg_op='DELETE'
     and not exists (
       select 1 from public.tenants t where t.id=v_tenant_id
     ) then
    return old;
  end if;

  if not public.sellertray_onboarding_live_operations_allowed(v_tenant_id) then
    raise exception 'SellerTray setup is not active yet. Complete commercial setup and activation before live operations.'
      using errcode='42501';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_sellertray_onboarding_live_operation()
  from public,anon,authenticated;
grant execute on function public.guard_sellertray_onboarding_live_operation()
  to service_role;

commit;
