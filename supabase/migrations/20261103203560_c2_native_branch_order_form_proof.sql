begin;

-- C2-7: a native Branch entitlement term is registered only from a confirmed,
-- purchase-specific Merchant Order Form and its accepted pinned Master.
-- Legacy compatibility terms and the C1/OA2 historical route are unchanged.
create or replace function public.validate_sellertray_native_branch_subscription_legal_proof()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if new.provenance_kind <> 'commercial_order' then
    return new;
  end if;

  if new.order_form_id is null
     or new.required_master_agreement_version_id is null
     or new.installment_obligation_id is null then
    raise exception 'A native Branch Subscription requires its confirmed Merchant Order Form, Master Agreement and settlement obligation'
      using errcode='23514';
  end if;

  if not exists(
    select 1
    from public.sellertray_commercial_order_forms f
    join public.sellertray_order_form_confirmations c
      on c.tenant_id=f.tenant_id and c.order_form_id=f.id
    join public.sellertray_agreement_packages p
      on p.tenant_id=f.tenant_id and p.id=c.agreement_package_id
    join public.sellertray_master_agreement_acceptances a
      on a.tenant_id=f.tenant_id
     and a.agreement_version_id=f.required_master_agreement_version_id
    where f.tenant_id=new.tenant_id
      and f.id=new.order_form_id
      and f.commercial_order_id=new.commercial_order_id
      and f.required_master_agreement_version_id=new.required_master_agreement_version_id
      and p.order_form_id=f.id
      and p.master_agreement_version_id=f.required_master_agreement_version_id
  ) then
    raise exception 'A native Branch Subscription requires a confirmed Order Form and the matching accepted Master Agreement'
      using errcode='23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_sellertray_native_branch_subscription_legal_proof()
  from public,anon,authenticated;

create trigger validate_sellertray_native_branch_subscription_legal_proof
before insert or update on public.sellertray_branch_subscriptions
for each row execute function public.validate_sellertray_native_branch_subscription_legal_proof();

commit;
