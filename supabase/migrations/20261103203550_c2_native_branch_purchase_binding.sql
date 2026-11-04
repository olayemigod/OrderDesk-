begin;

-- C2-6/C2-7: a native Branch Subscription may only be registered for
-- the exact priced Branch plan/cycle and Branch commitment it purchased.
-- C2-4 legacy_compatibility evidence remains untouched.
create or replace function public.validate_sellertray_native_branch_subscription_purchase()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_line public.sellertray_commercial_order_price_snapshots%rowtype;
  v_subject public.sellertray_branch_commercial_order_subjects%rowtype;
begin
  if new.provenance_kind <> 'commercial_order' then
    return new;
  end if;

  select l.* into v_line
  from public.sellertray_commercial_order_price_snapshots l
  join public.sellertray_commercial_orders o
    on o.tenant_id=l.tenant_id and o.id=l.commercial_order_id
  where l.tenant_id=new.tenant_id
    and l.id=new.commercial_order_line_id
    and l.commercial_order_id=new.commercial_order_id
    and o.order_kind='branch_commercial_v2';

  if not found
     or v_line.line_type is distinct from 'branch_subscription'
     or v_line.branch_id is distinct from new.branch_id
     or v_line.plan_profile_version_id is distinct from new.plan_profile_version_id
     or v_line.billing_cycle is distinct from new.billing_cycle then
    raise exception 'Native Branch Subscription must match its exact purchased Branch plan and billing cycle'
      using errcode='23514';
  end if;

  select s.* into v_subject
  from public.sellertray_branch_commercial_order_subjects s
  where s.tenant_id=new.tenant_id
    and s.commercial_order_id=new.commercial_order_id
    and s.branch_id=new.branch_id
    and s.branch_subscription_line_id=new.commercial_order_line_id;

  if not found
     or v_subject.plan_profile_version_id is distinct from new.plan_profile_version_id
     or v_subject.billing_cycle is distinct from new.billing_cycle
     or v_subject.setup_required is distinct from new.setup_required
     or v_subject.supersedes_branch_subscription_id is distinct from new.supersedes_branch_subscription_id
     or (new.installment_obligation_id is not null and
         v_subject.installment_obligation_id is distinct from new.installment_obligation_id) then
    raise exception 'Native Branch Subscription must use its Branch commercial commitment and settlement obligation'
      using errcode='23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_sellertray_native_branch_subscription_purchase()
  from public,anon,authenticated;

create trigger validate_sellertray_native_branch_subscription_purchase
before insert or update on public.sellertray_branch_subscriptions
for each row execute function public.validate_sellertray_native_branch_subscription_purchase();

commit;
