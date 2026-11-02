begin;

-- C2-6 installment selection guard.
-- Full payment remains universally available. A deferred installment structure
-- must be the exact effective template selected by the governed Commercial V2
-- installment policy for this Business/order/Plan Profile/billing-cycle.

create or replace function public.validate_sellertray_branch_commercial_installment_policy()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_template public.sellertray_installment_schedule_templates%rowtype;
  v_policy jsonb;
  v_policy_enabled boolean;
  v_policy_template_id uuid;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;

  select t.* into strict v_template
  from public.sellertray_installment_schedule_templates t
  where t.id=new.installment_template_id;

  if v_template.template_code='full_payment_100' then
    return new;
  end if;

  v_policy:=public.resolve_sellertray_installment_policy_v2(
    new.tenant_id,
    new.commercial_order_id,
    new.plan_profile_version_id,
    new.billing_cycle,
    v_order.ordered_at
  );
  v_policy_enabled:=coalesce((v_policy->>'enabled')::boolean,false);
  v_policy_template_id:=nullif(v_policy->>'defaultTemplateId','')::uuid;

  if not v_policy_enabled or v_policy_template_id is distinct from new.installment_template_id then
    raise exception 'Selected installment structure is not authorised by the effective Commercial V2 policy'
      using errcode='23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_sellertray_branch_commercial_installment_policy()
  from public,anon,authenticated;

create trigger validate_sellertray_branch_commercial_installment_policy
before insert on public.sellertray_branch_commercial_order_subjects
for each row execute function public.validate_sellertray_branch_commercial_installment_policy();

commit;
