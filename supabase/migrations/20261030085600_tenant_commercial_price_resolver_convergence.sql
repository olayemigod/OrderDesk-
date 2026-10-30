begin;

-- Reconcile the tenant-aware commercial price resolver that was present in the
-- live authority but missing from repository migration history. Merchant
-- Billing must resolve standard versus merchant-override prices from the same
-- governed price-version authority on clean schemas and in production.
create or replace function public.resolve_sellertray_commercial_price_version_for_tenant(
  p_tenant_id uuid,
  p_price_kind text,
  p_plan_code text,
  p_billing_cycle text,
  p_currency text,
  p_as_of timestamptz
)
returns uuid
language sql
stable
set search_path=''
as $function$
  select p.id
  from public.sellertray_commercial_price_versions p
  where p.price_kind=p_price_kind
    and p.plan_code is not distinct from p_plan_code
    and p.billing_cycle is not distinct from p_billing_cycle
    and p.currency=upper(btrim(p_currency))
    and p.status='published'
    and p.effective_from<=p_as_of
    and (p.effective_until is null or p.effective_until>p_as_of)
    and public.sellertray_commercial_price_version_state(p.id,p_as_of)='active'
    and (
      (p.price_scope='merchant_override' and p.tenant_id=p_tenant_id)
      or (p.price_scope='standard' and p.tenant_id is null)
    )
  order by
    case when p.price_scope='merchant_override' then 1 else 0 end desc,
    p.effective_from desc,
    p.created_at desc,
    p.id desc
  limit 1;
$function$;

revoke all on function public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.resolve_sellertray_commercial_price_version_for_tenant(uuid,text,text,text,text,timestamptz)
  to service_role;

commit;
