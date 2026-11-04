begin;

-- A historical setup price line is an immutable *quote*, not proof that the
-- merchant paid for setup or that ProcessEdge completed that Branch's setup.
-- Never waive Branch setup merely because another, still-unpaid order exists.
--
-- Qualified prior setup requires the same Branch's recorded readiness plus
-- actual confirmed settlement sufficient to cover its snapshotted setup fee.
-- For native C2 orders, settlement must belong to this Branch obligation and
-- the Merchant Order Form must already have been confirmed. C1 payment proof
-- retains its historical order-level attribution; no old facts are rewritten.
create or replace function public.sellertray_branch_requires_commercial_setup(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_excluding_commercial_order_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select not exists(
    select 1
    from public.sellertray_commercial_branch_setup_readiness r
    join public.sellertray_commercial_order_price_snapshots setup_line
      on setup_line.tenant_id=r.tenant_id
     and setup_line.commercial_order_id=r.commercial_order_id
     and setup_line.branch_id=r.branch_id
     and setup_line.line_type='branch_setup'
    join public.sellertray_commercial_orders co
      on co.tenant_id=r.tenant_id
     and co.id=r.commercial_order_id
    left join public.sellertray_branch_commercial_order_subjects bs
      on bs.tenant_id=r.tenant_id
     and bs.commercial_order_id=r.commercial_order_id
     and bs.branch_id=r.branch_id
     and bs.branch_setup_line_id=setup_line.id
    where r.tenant_id=p_tenant_id
      and r.branch_id=p_branch_id
      and (p_excluding_commercial_order_id is null
           or r.commercial_order_id<>p_excluding_commercial_order_id)
      and (
        co.order_kind<>'branch_commercial_v2'
        or (
          bs.id is not null
          and exists(
            select 1
            from public.sellertray_commercial_order_forms f
            join public.sellertray_order_form_confirmations conf
              on conf.tenant_id=f.tenant_id and conf.order_form_id=f.id
            where f.tenant_id=r.tenant_id
              and f.commercial_order_id=r.commercial_order_id
          )
        )
      )
      and (
        (
          select coalesce(sum(p.amount),0)
          from public.sellertray_commercial_installment_payment_confirmations p
          where p.tenant_id=r.tenant_id
            and p.commercial_order_id=r.commercial_order_id
            and (
              co.order_kind<>'branch_commercial_v2'
              or p.installment_obligation_id=bs.installment_obligation_id
            )
        )
        +
        (
          select coalesce(sum(p.amount),0)
          from public.sellertray_commercial_direct_payment_confirmations p
          where p.tenant_id=r.tenant_id
            and p.commercial_order_id=r.commercial_order_id
            and (
              co.order_kind<>'branch_commercial_v2'
              or p.installment_obligation_id=bs.installment_obligation_id
            )
        )
      ) >= setup_line.gross_amount - 0.004
  );
$function$;

revoke all on function public.sellertray_branch_requires_commercial_setup(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_branch_requires_commercial_setup(uuid,uuid,uuid)
  to service_role;

comment on function public.sellertray_branch_requires_commercial_setup(uuid,uuid,uuid) is
  'Requires previously fulfilled Branch setup (readiness plus sufficient confirmed setup-price settlement; C2 also requires confirmed Order Form) before waiving a later setup charge. Historical unpaid quotes alone never waive setup.';

commit;
