begin;

-- C2-7 review hardening: after a Branch order has been priced, ProcessEdge
-- may publish an immutable installment-policy successor before a merchant
-- confirms its Order Form. The first confirmation must respect the CURRENT
-- allowed-template set, not merely the originally approved quote. A successful
-- confirmation freezes the exact schedule/version; subsequent policy changes
-- must not retroactively invalidate an already confirmed contract.
--
-- This trigger intentionally covers both reviewed and direct confirmation RPCs
-- and any service-role insert. It does not apply to legacy C1 confirmations.
create or replace function public.validate_sellertray_c2_order_form_confirm_installments()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_order_kind text;
  v_subject public.sellertray_branch_commercial_order_subjects%rowtype;
  v_policy jsonb;
  v_count integer:=0;
begin
  select o.order_kind into strict v_order_kind
  from public.sellertray_commercial_order_forms f
  join public.sellertray_commercial_orders o
    on o.tenant_id=f.tenant_id and o.id=f.commercial_order_id
  where f.tenant_id=new.tenant_id and f.id=new.order_form_id;

  if v_order_kind<>'branch_commercial_v2' then
    return new;
  end if;

  for v_subject in
    select s.*
    from public.sellertray_branch_commercial_order_subjects s
    join public.sellertray_commercial_order_forms f
      on f.tenant_id=s.tenant_id and f.commercial_order_id=s.commercial_order_id
    where f.tenant_id=new.tenant_id and f.id=new.order_form_id
    order by s.branch_id
  loop
    v_count:=v_count+1;
    v_policy:=public.resolve_sellertray_installment_policy_v2(
      v_subject.tenant_id,
      v_subject.commercial_order_id,
      v_subject.plan_profile_version_id,
      v_subject.billing_cycle,
      now()
    );

    if not coalesce(
      public.sellertray_c2_installment_template_allowed(
        v_policy,v_subject.installment_template_id
      ),false
    ) then
      raise exception 'The selected payment schedule is no longer available for this Branch. Request an updated commercial order before confirming the Order Form'
        using errcode='23514';
    end if;
  end loop;

  if v_count=0 then
    raise exception 'Cannot confirm a Branch Order Form without governed Branch commitments'
      using errcode='23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_sellertray_c2_order_form_confirm_installments()
  from public,anon,authenticated;

create trigger validate_sellertray_c2_order_form_confirm_installments
before insert on public.sellertray_order_form_confirmations
for each row execute function public.validate_sellertray_c2_order_form_confirm_installments();

-- A confirmed C2 Order Form has already registered immutable native Branch
-- Subscription terms using the Branch subject as its idempotency command.
-- Replacing that legal instrument in place cannot safely reuse the command
-- with a different order_form_id or confirmed_at. The supported path for a
-- changed commercial commitment is a NEW governed commercial order with its
-- own confirmed Form. Until an explicit confirmed-form amendment contract is
-- implemented, reject the unsafe replacement BEFORE issuance.
--
-- Sort this trigger before prepare_sellertray_commercial_order_form so its
-- FOR UPDATE lock on the previous form serializes against confirmation's
-- existing FOR SHARE lock, preventing the confirm/supersede race.
create or replace function public.guard_sellertray_c2_confirmed_form_supersession()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_order_kind text;
  v_previous public.sellertray_commercial_order_forms%rowtype;
begin
  if new.supersedes_order_form_id is null then
    return new;
  end if;

  select o.order_kind into strict v_order_kind
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;
  if v_order_kind<>'branch_commercial_v2' then
    return new;
  end if;

  select f.* into strict v_previous
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=new.tenant_id and f.id=new.supersedes_order_form_id
  for update;

  if v_previous.commercial_order_id<>new.commercial_order_id then
    raise exception 'Replacement Order Form must preserve the original Branch commercial order'
      using errcode='23514';
  end if;

  if exists(
    select 1
    from public.sellertray_order_form_confirmations c
    where c.tenant_id=new.tenant_id and c.order_form_id=v_previous.id
  ) or exists(
    select 1
    from public.sellertray_branch_subscriptions s
    where s.tenant_id=new.tenant_id and s.order_form_id=v_previous.id
      and s.provenance_kind='commercial_order'
  ) then
    raise exception 'This Branch Order Form is already confirmed. Create a new commercial order for a change; confirmed forms cannot be replaced directly'
      using errcode='23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_sellertray_c2_confirmed_form_supersession()
  from public,anon,authenticated;

create trigger a_guard_sellertray_c2_confirmed_form_supersession
before insert on public.sellertray_commercial_order_forms
for each row execute function public.guard_sellertray_c2_confirmed_form_supersession();

comment on function public.validate_sellertray_c2_order_form_confirm_installments() is
  'Before first native Branch Order Form confirmation, validates all selected installment templates against the currently effective configured policy. Already-confirmed contracts and C1 are unaffected.';
comment on function public.guard_sellertray_c2_confirmed_form_supersession() is
  'Prevents an already confirmed C2 Order Form being superseded into an unconfirmable native Branch term; replacement commercial commitments require a new order.';

commit;
