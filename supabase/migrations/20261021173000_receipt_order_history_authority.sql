begin;

-- Receipt/reprint output must use the immutable sale-time financial snapshot.
-- Never derive historical tax from the merchant's current tax configuration.
create or replace function public.sellertray_snapshot_receipt_financial_authority()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
begin
  if new.job_type='receipt' and new.order_id is not null then
    select * into v_order
    from public.orders o
    where o.tenant_id=new.tenant_id
      and o.id=new.order_id;

    if found then
      new.content_snapshot := new.content_snapshot || jsonb_build_object(
        'subtotalAmount',coalesce(v_order.subtotal_amount,v_order.total_amount,0),
        'taxAmount',coalesce(v_order.tax_amount,0),
        'totalAmount',coalesce(v_order.total_amount,v_order.gross_amount,v_order.subtotal_amount,0),
        'showTaxBreakdown',coalesce(v_order.tax_display_breakdown,false)
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.sellertray_snapshot_receipt_financial_authority()
  from public,anon,authenticated;
grant execute on function public.sellertray_snapshot_receipt_financial_authority()
  to service_role;

drop trigger if exists sellertray_snapshot_receipt_financial_authority
  on public.sellertray_print_jobs;
create trigger sellertray_snapshot_receipt_financial_authority
before insert on public.sellertray_print_jobs
for each row execute function public.sellertray_snapshot_receipt_financial_authority();

commit;
