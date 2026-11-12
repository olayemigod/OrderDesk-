-- A later discount changes the purchase-specific commercial snapshot.
-- Preserve the previously issued/confirmed Order Form as immutable history,
-- and issue a new current Order Form within the same discount transaction.
-- The existing current-Order-Form confirmation gate then requires Merchant
-- re-review/reconfirmation before a fresh installment checkout or entitlement.

create or replace function public.reissue_sellertray_order_forms_after_discount()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_prior public.sellertray_commercial_order_forms%rowtype;
  v_new_form_id uuid;
  v_master_version_id uuid;
  v_current_snapshot jsonb;
  v_reference text;
  v_order_form_replaced boolean := false;
begin
  if new.adjustment_type <> 'discount' then
    return new;
  end if;

  -- The governed discount commands already serialize on this order. Reuse
  -- that same lock for any permitted insert path, so replacement chains cannot
  -- fork under concurrent adjustment or Order Form issuance.
  perform public.lock_sellertray_commercial_order(new.tenant_id,new.commercial_order_id);
  v_master_version_id := public.resolve_sellertray_master_agreement_version_id(now());

  for v_prior in
    select f.*
    from public.sellertray_commercial_order_forms f
    where f.tenant_id=new.tenant_id
      and f.commercial_order_id=new.commercial_order_id
      and not exists (
        select 1
        from public.sellertray_commercial_order_forms replacement
        where replacement.tenant_id=f.tenant_id
          and replacement.supersedes_order_form_id=f.id
      )
    order by f.issued_at,f.id
  loop
    v_current_snapshot := public.build_sellertray_commercial_agreement_snapshot(
      new.tenant_id,new.commercial_order_id,v_prior.installment_obligation_id
    );

    -- If terms did not change at currency precision, do not manufacture a
    -- replacement instrument. Historical snapshots are never updated.
    if v_prior.commercial_snapshot = v_current_snapshot then
      continue;
    end if;

    v_reference := 'ST-OF-ADJ-'||replace(new.command_id::text,'-','')
      ||'-'||left(replace(v_prior.id::text,'-',''),12);

    insert into public.sellertray_commercial_order_forms(
      tenant_id,commercial_order_id,installment_obligation_id,
      order_form_template_version_id,template_version_code,
      template_content_sha256,order_form_reference,rendered_content,
      commercial_snapshot,commercial_snapshot_sha256,content_sha256,
      supersedes_order_form_id,issued_by_user_id
    ) values (
      new.tenant_id,new.commercial_order_id,v_prior.installment_obligation_id,
      v_prior.order_form_template_version_id,'pending',repeat('0',64),
      v_reference,'pending','{}'::jsonb,repeat('0',64),repeat('0',64),
      v_prior.id,new.actor_user_id
    ) returning id into v_new_form_id;
    v_order_form_replaced := true;

    -- Generate the exact new purchase package against the current Master.
    -- If a required Master is not yet published, the normal governed
    -- agreement orchestration can create the package after publication.
    if v_master_version_id is not null then
      perform public.create_sellertray_agreement_package(
        new.tenant_id,v_new_form_id,v_master_version_id
      );
    end if;

    insert into public.platform_admin_audit(
      actor_user_id,tenant_id,action,detail
    ) values (
      new.actor_user_id,new.tenant_id,'sellertray_order_form_issued',
      jsonb_build_object(
        'commercialOrderId',new.commercial_order_id,
        'orderFormId',v_new_form_id,
        'supersedesOrderFormId',v_prior.id,
        'adjustmentId',new.id,
        'discountCommandId',new.command_id,
        'adjustmentAmount',new.amount,
        'currency',new.currency,
        'reason','Commercial discount changed the purchase terms',
        'reconfirmationRequired',true
      )
    );
  end loop;

  -- A previously initialized Paystack URL remains executable even if
  -- rounding leaves the next installment amount unchanged. Retire every
  -- unpaid/preparing checkout bound to the replaced commercial terms;
  -- historical paid sessions are immutable settlement evidence. The
  -- existing reserve/confirm authorities reject superseded sessions and
  -- old command retries request a fresh checkout after reconfirmation.
  if v_order_form_replaced then
    update public.billing_checkout_sessions s
    set status='superseded',updated_at=now()
    where s.tenant_id=new.tenant_id
      and s.commercial_order_id=new.commercial_order_id
      and s.checkout_kind='installment'
      and s.status in ('preparing','initialized');
  end if;

  return new;
end;
$$;

revoke all on function public.reissue_sellertray_order_forms_after_discount()
from public,anon,authenticated;
grant execute on function public.reissue_sellertray_order_forms_after_discount()
to service_role;

drop trigger if exists reissue_sellertray_order_forms_after_discount
on public.sellertray_commercial_adjustments;
create trigger reissue_sellertray_order_forms_after_discount
after insert on public.sellertray_commercial_adjustments
for each row execute function public.reissue_sellertray_order_forms_after_discount();
