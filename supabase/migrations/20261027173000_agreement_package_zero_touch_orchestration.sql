begin;

-- SellerTray OA5C agreement-package zero-touch orchestration.
--
-- Normal operation is configure once -> instantiate automatically -> merchant
-- reviews/confirms. Commercial/payment facts remain independent of legal
-- configuration: an absent Master Agreement or reusable Order Form template is
-- reported as a non-fatal orchestration state and never fabricates acceptance
-- or rolls back an otherwise valid commercial order.

alter table public.platform_admin_capability_grant_versions
  drop constraint if exists platform_admin_capability_code_check,
  add constraint platform_admin_capability_code_check
  check (capability_code = any (array[
    'admin.pricing.manage'::text,
    'admin.payments.reconcile'::text,
    'admin.installments.manage'::text,
    'admin.branch_setup.manage'::text,
    'admin.agreements.publish'::text,
    'admin.order_forms.publish'::text,
    'admin.order_forms.issue'::text,
    'admin.agreements.recover'::text
  ]));

create or replace function public.ensure_sellertray_agreement_package_for_commercial_order(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_form public.sellertray_commercial_order_forms%rowtype;
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_package public.sellertray_agreement_packages%rowtype;
  v_master_id uuid;
  v_family text;
  v_reference text;
  v_created_form boolean := false;
  v_created_package boolean := false;
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_actor_user_id is null then
    raise exception 'Business, commercial order and orchestration actor are required' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'sellertray-agreement-orchestration:'||p_tenant_id::text||':'||p_commercial_order_id::text,0
  ));
  perform public.lock_sellertray_commercial_order(p_tenant_id,p_commercial_order_id);

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  if p_installment_obligation_id is not null then
    select io.* into strict v_obligation
    from public.sellertray_commercial_installment_obligations io
    where io.tenant_id=p_tenant_id
      and io.commercial_order_id=p_commercial_order_id
      and io.id=p_installment_obligation_id;
    v_family := 'installment_agreement';
  else
    v_family := 'subscription_order';
  end if;

  select f.* into v_form
  from public.sellertray_commercial_order_forms f
  where f.tenant_id=p_tenant_id
    and f.commercial_order_id=p_commercial_order_id
    and f.installment_obligation_id is not distinct from p_installment_obligation_id
    and not exists (
      select 1
      from public.sellertray_commercial_order_forms replacement
      where replacement.tenant_id=f.tenant_id
        and replacement.supersedes_order_form_id=f.id
    )
  order by f.issued_at desc,f.id desc
  limit 1;

  if not found then
    select t.* into v_template
    from public.sellertray_commercial_agreement_template_versions t
    where t.agreement_family=v_family
      and t.effective_from<=now()
    order by t.effective_from desc,t.published_at desc,t.id desc
    limit 1;

    if not found then
      return jsonb_build_object(
        'status','order_form_template_missing',
        'ready',false,
        'tenantId',p_tenant_id,
        'commercialOrderId',p_commercial_order_id,
        'installmentObligationId',p_installment_obligation_id,
        'orderFormFamily',v_family,
        'orderFormId',null,
        'agreementPackageId',null,
        'masterAgreementVersionId',public.resolve_sellertray_master_agreement_version_id(now())
      );
    end if;

    v_reference := 'ST-OF-'||replace(p_commercial_order_id::text,'-','');

    insert into public.sellertray_commercial_order_forms(
      tenant_id,commercial_order_id,installment_obligation_id,order_form_template_version_id,
      template_version_code,template_content_sha256,order_form_reference,rendered_content,
      commercial_snapshot,commercial_snapshot_sha256,content_sha256,supersedes_order_form_id,
      issued_by_user_id
    ) values (
      p_tenant_id,p_commercial_order_id,p_installment_obligation_id,v_template.id,
      'pending',repeat('0',64),v_reference,'pending','{}'::jsonb,repeat('0',64),repeat('0',64),
      null,p_actor_user_id
    ) returning * into v_form;
    v_created_form := true;
  end if;

  v_master_id := public.resolve_sellertray_master_agreement_version_id(now());
  if v_master_id is null then
    return jsonb_build_object(
      'status','master_agreement_missing',
      'ready',false,
      'tenantId',p_tenant_id,
      'commercialOrderId',p_commercial_order_id,
      'installmentObligationId',p_installment_obligation_id,
      'orderFormId',v_form.id,
      'orderFormCreated',v_created_form,
      'agreementPackageId',null,
      'masterAgreementVersionId',null
    );
  end if;

  select p.* into v_package
  from public.sellertray_agreement_packages p
  where p.tenant_id=p_tenant_id
    and p.master_agreement_version_id=v_master_id
    and p.order_form_id=v_form.id;

  if not found then
    perform public.create_sellertray_agreement_package(p_tenant_id,v_form.id,v_master_id);
    select p.* into strict v_package
    from public.sellertray_agreement_packages p
    where p.tenant_id=p_tenant_id
      and p.master_agreement_version_id=v_master_id
      and p.order_form_id=v_form.id;
    v_created_package := true;
  end if;

  return jsonb_build_object(
    'status','ready_for_review',
    'ready',true,
    'tenantId',p_tenant_id,
    'commercialOrderId',p_commercial_order_id,
    'installmentObligationId',p_installment_obligation_id,
    'orderFormId',v_form.id,
    'orderFormCreated',v_created_form,
    'agreementPackageId',v_package.id,
    'agreementPackageCreated',v_created_package,
    'masterAgreementVersionId',v_master_id,
    'packageFingerprint',v_package.package_fingerprint
  );
end;
$$;

revoke all on function public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.ensure_sellertray_agreement_package_for_commercial_order(uuid,uuid,uuid,uuid)
  to service_role;

create or replace function public.orchestrate_sellertray_agreement_package_after_installment_schedule()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_materialized numeric(18,2);
begin
  select io.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=new.tenant_id and io.id=new.installment_obligation_id;

  select coalesce(sum(s.amount_due),0)::numeric(18,2)
  into v_materialized
  from public.sellertray_commercial_installment_schedule s
  where s.tenant_id=new.tenant_id
    and s.installment_obligation_id=new.installment_obligation_id;

  if abs(v_materialized-v_obligation.obligated_amount)<0.005 then
    perform public.ensure_sellertray_agreement_package_for_commercial_order(
      new.tenant_id,
      v_obligation.commercial_order_id,
      v_obligation.id,
      v_obligation.created_by_user_id
    );
  end if;

  return new;
end;
$$;
revoke all on function public.orchestrate_sellertray_agreement_package_after_installment_schedule()
  from public,anon,authenticated;

drop trigger if exists orchestrate_sellertray_agreement_package_after_installment_schedule
  on public.sellertray_commercial_installment_schedule;
create trigger orchestrate_sellertray_agreement_package_after_installment_schedule
after insert on public.sellertray_commercial_installment_schedule
for each row execute function public.orchestrate_sellertray_agreement_package_after_installment_schedule();

create or replace function public.reconcile_sellertray_agreement_package_admin(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reason text := btrim(coalesce(p_reason,''));
  v_obligation_id uuid;
  v_result jsonb;
begin
  if p_actor_user_id is null or not public.platform_admin_has_capability(
    p_actor_user_id,'admin.agreements.recover',p_tenant_id,now()
  ) then
    raise exception 'Agreement reconciliation capability required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_commercial_order_id is null then
    raise exception 'Business and commercial order are required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Agreement reconciliation reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  select io.id into v_obligation_id
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=p_tenant_id and io.commercial_order_id=p_commercial_order_id
  order by io.created_at desc,io.id desc
  limit 1;

  v_result := public.ensure_sellertray_agreement_package_for_commercial_order(
    p_tenant_id,p_commercial_order_id,v_obligation_id,p_actor_user_id
  );

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,p_tenant_id,'sellertray_agreement_package_reconciled',jsonb_build_object(
    'commercialOrderId',p_commercial_order_id,
    'installmentObligationId',v_obligation_id,
    'result',v_result,
    'reason',v_reason
  ));

  return v_result;
end;
$$;
revoke all on function public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)
  to service_role;

-- Routine per-merchant issuance is no longer part of any service/web happy path.
-- Keep the immutable function/history for compatibility and audit, but remove the
-- trusted web-service execution grant. Exception recovery uses reconciliation above.
revoke execute on function public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,uuid,text,uuid)
  from service_role;

commit;
