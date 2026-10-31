begin;

-- OA5 Billing first-purchase read-authority convergence.
--
-- SellerTray has no merchant-facing free trial. Before C2, tenant_subscriptions
-- still stores the historical `trial` value as compatibility metadata for a
-- Business that is preparing its first governed purchase. The semantic runtime
-- authority for that state already exists as sellertray_business_is_preparing().
--
-- Do not replace the obsolete Billing status predicate with `active`, `trialing`
-- or another guessed status. The shared first-purchase core deliberately retains
-- the current pre-C2 compatibility guard, while Billing consumes the semantic
-- preparation authority plus its existing Owner / zero-order / onboarding gates.

do $migration$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  if to_regprocedure('public.sellertray_business_is_preparing(uuid)') is null then
    raise exception 'SellerTray preparation authority is missing';
  end if;

  select pg_get_functiondef(p.oid)
  into v_source
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='get_sellertray_commercial_billing_center'
    and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_actor_user_id uuid';

  if v_source is null then
    raise exception 'SellerTray Billing Center authority is missing';
  end if;

  v_old := E'    and exists(\n      select 1 from public.tenant_subscriptions s\n      where s.tenant_id=p_tenant_id and s.status=''trial''\n    )\n';
  v_new := E'    and public.sellertray_business_is_preparing(p_tenant_id)\n';

  if position(v_old in v_source)=0 then
    if position('sellertray_business_is_preparing(p_tenant_id)' in v_source)>0 then
      -- Already converged; allow safe replay of this migration source.
      null;
    elsif position('s.status = ''trial''' in v_source)>0
       or position('s.status=''trial''' in v_source)>0 then
      raise exception 'SellerTray Billing Center trial predicate has an unexpected shape';
    else
      raise exception 'SellerTray Billing Center preparation predicate is missing';
    end if;
  else
    v_source:=replace(v_source,v_old,v_new);
    execute v_source;
  end if;
end
$migration$;

-- Reassert the established service boundary after CREATE OR REPLACE.
revoke all on function public.get_sellertray_commercial_billing_center(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_commercial_billing_center(uuid,uuid)
  to service_role;

commit;
