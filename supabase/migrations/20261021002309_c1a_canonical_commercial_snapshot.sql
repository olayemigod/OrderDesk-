begin;

-- C1A agreement snapshots must consume governed C1 commercial facts. The admin
-- browser may choose the commercial order/template and provide the rendered
-- legal text, but it must never author price, tax, Branch or installment truth.

create or replace function public.build_sellertray_commercial_agreement_snapshot(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_lines jsonb;
  v_schedule jsonb;
begin
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=p_commercial_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_no',s.line_no,
    'line_type',s.line_type,
    'source_price_version_id',s.source_price_version_id,
    'plan_code',s.plan_code,
    'branch_id',s.branch_id,
    'billing_cycle',s.billing_cycle,
    'description',s.description_snapshot,
    'quantity',s.quantity,
    'currency',s.currency,
    'unit_gross_amount',s.unit_gross_amount,
    'gross_amount',s.gross_amount,
    'net_amount',s.net_amount,
    'tax_rate_percent',s.tax_rate_percent,
    'tax_amount',s.tax_amount
  ) order by s.line_no),'[]'::jsonb)
  into v_lines
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=p_commercial_order_id;

  if p_installment_obligation_id is not null then
    select o.* into strict v_obligation
    from public.sellertray_commercial_installment_obligations o
    where o.tenant_id=p_tenant_id
      and o.commercial_order_id=p_commercial_order_id
      and o.id=p_installment_obligation_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'sequence_no',s.sequence_no,
      'percentage',s.percentage,
      'amount_due',s.amount_due,
      'due_at',s.due_at
    ) order by s.sequence_no),'[]'::jsonb)
    into v_schedule
    from public.sellertray_commercial_installment_schedule s
    where s.tenant_id=p_tenant_id
      and s.installment_obligation_id=p_installment_obligation_id;
  else
    v_schedule := null;
  end if;

  return jsonb_build_object(
    'commercial_order_id',v_order.id,
    'order_reference',v_order.order_reference,
    'currency',v_order.currency,
    'total_gross_amount',v_order.total_gross_amount,
    'ordered_at',v_order.ordered_at,
    'price_snapshots',v_lines,
    'installment',case when p_installment_obligation_id is null then null else jsonb_build_object(
      'installment_obligation_id',v_obligation.id,
      'structure_code',v_obligation.structure_code,
      'currency',v_obligation.currency,
      'obligated_amount',v_obligation.obligated_amount,
      'schedule',v_schedule
    ) end
  );
end;
$$;

revoke all on function public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.build_sellertray_commercial_agreement_snapshot(uuid,uuid,uuid)
  to service_role;

create or replace function public.issue_sellertray_commercial_agreement(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid,
  p_template_version_id uuid,
  p_agreement_reference text,
  p_rendered_content text,
  p_supersedes_agreement_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_id uuid;
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_existing public.sellertray_commercial_agreements%rowtype;
  v_reference text := btrim(coalesce(p_agreement_reference,''));
  v_rendered_content text := coalesce(p_rendered_content,'');
  v_content_hash text := encode(extensions.digest(coalesce(p_rendered_content,''),'sha256'),'hex');
  v_snapshot jsonb;
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.platform_admins pa
    where pa.user_id=p_actor_user_id and pa.role='admin'
  ) then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_commercial_order_id is null or p_template_version_id is null then
    raise exception 'Business, commercial order and agreement template are required' using errcode='22023';
  end if;

  select t.* into strict v_template
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=p_template_version_id;

  if v_template.agreement_family='installment_agreement' and p_installment_obligation_id is null then
    raise exception 'SellerTray installment agreement requires an installment obligation' using errcode='23514';
  elsif v_template.agreement_family<>'installment_agreement' and p_installment_obligation_id is not null then
    raise exception 'Only an installment agreement may bind an installment obligation' using errcode='23514';
  end if;

  v_snapshot := public.build_sellertray_commercial_agreement_snapshot(
    p_tenant_id,p_commercial_order_id,p_installment_obligation_id
  );

  insert into public.sellertray_commercial_agreements(
    tenant_id,commercial_order_id,installment_obligation_id,template_version_id,
    agreement_family,template_version_code,template_content_sha256,
    agreement_reference,rendered_content,content_sha256,commercial_snapshot,
    supersedes_agreement_id,issued_by_user_id,issued_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_installment_obligation_id,p_template_version_id,
    v_template.agreement_family,v_template.version_code,v_template.content_sha256,
    v_reference,v_rendered_content,v_content_hash,v_snapshot,
    p_supersedes_agreement_id,p_actor_user_id,now()
  )
  on conflict (tenant_id,agreement_reference) do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  select a.* into strict v_existing
  from public.sellertray_commercial_agreements a
  where a.tenant_id=p_tenant_id
    and a.agreement_reference=v_reference;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.installment_obligation_id is distinct from p_installment_obligation_id
     or v_existing.template_version_id<>p_template_version_id
     or v_existing.agreement_family<>v_template.agreement_family
     or v_existing.template_version_code<>v_template.version_code
     or v_existing.template_content_sha256<>v_template.content_sha256
     or v_existing.content_sha256<>v_content_hash
     or v_existing.rendered_content<>v_rendered_content
     or v_existing.commercial_snapshot is distinct from v_snapshot
     or v_existing.supersedes_agreement_id is distinct from p_supersedes_agreement_id
     or v_existing.issued_by_user_id<>p_actor_user_id then
    raise exception 'SellerTray agreement reference is already used for different contractual facts'
      using errcode='23505';
  end if;

  return v_existing.id;
end;
$$;

revoke all on function public.issue_sellertray_commercial_agreement(
  uuid,uuid,uuid,uuid,text,text,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.issue_sellertray_commercial_agreement(
  uuid,uuid,uuid,uuid,text,text,uuid,uuid
) to service_role;

drop function public.issue_sellertray_commercial_agreement(
  uuid,uuid,uuid,uuid,text,text,jsonb,uuid,uuid
);

commit;
