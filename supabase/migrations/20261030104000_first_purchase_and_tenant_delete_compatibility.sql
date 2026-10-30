begin;

-- Preserve the historical Admin first-purchase wrapper contract after the
-- shared purchase core was extracted for Merchant Web. Admin continues to use
-- the existing internal implementation behind the same Business serialization
-- lock; Merchant Web uses the shared core through its separate Owner wrapper.
create or replace function public.create_sellertray_initial_installment_purchase_admin(
  p_tenant_id uuid,
  p_plan_code text,
  p_currency text,
  p_branch_ids uuid[],
  p_structure_code text,
  p_order_reference text,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_role text;
begin
  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;

  if v_role is distinct from 'admin' then
    raise exception 'Platform admin role required for this action' using errcode='42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  perform 1
  from public.tenants t
  where t.id=p_tenant_id
  for update;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  return public.create_sellertray_initial_installment_purchase_admin_impl(
    p_tenant_id,
    p_plan_code,
    p_currency,
    p_branch_ids,
    p_structure_code,
    p_order_reference,
    p_reason,
    p_actor_user_id
  );
end;
$function$;

revoke all on function public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.create_sellertray_initial_installment_purchase_admin(uuid,text,text,uuid[],text,text,text,uuid)
  to service_role;

-- Tenant deletion is a governed lifecycle operation. During a parent Tenant
-- cascade, tenant_subscriptions can be deleted before catalog rows. Permit the
-- child DELETE only when the parent Business is already absent; otherwise keep
-- the normal subscription write gate unchanged for INSERT/UPDATE/DELETE.
create or replace function public.guard_orderdesk_subscription_write()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);

  if tg_op='DELETE'
     and not exists(select 1 from public.tenants t where t.id=v_tenant_id) then
    return old;
  end if;

  if not public.orderdesk_subscription_can_write(v_tenant_id) then
    raise exception 'SellerTray subscription is read-only. Renew or reactivate the business to make changes.'
      using errcode='42501';
  end if;

  return coalesce(new,old);
end;
$function$;

commit;
