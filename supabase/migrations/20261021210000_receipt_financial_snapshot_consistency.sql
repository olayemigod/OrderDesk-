begin;

-- Receipt/reprint presentation must use the immutable financial facts posted
-- with the sale. Do not consult the current tax configuration when printing a
-- historical transaction.
create or replace function public.sellertray_snapshot_receipt_financials()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
begin
  if new.job_type <> 'receipt' or new.order_id is null then
    return new;
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id = new.tenant_id
    and o.id = new.order_id;

  if not found then
    return new;
  end if;

  -- Tax Authority posts these fields together and guards their accounting
  -- relationship. Merge only the stored historical snapshot into the print
  -- job; never derive it from today's Business tax settings.
  if v_order.tax_posted_at is not null then
    new.content_snapshot := new.content_snapshot || jsonb_build_object(
      'subtotalAmount', v_order.subtotal_amount,
      'taxApplied', v_order.tax_applied,
      'taxRatePercent', v_order.tax_rate_percent,
      'taxAmount', v_order.tax_amount,
      'taxDisplayBreakdown', v_order.tax_display_breakdown,
      'grossAmount', v_order.gross_amount
    );
  elsif v_order.total_amount is not null then
    -- Compatibility for historical pre-tax receipts. The committed total is
    -- still safe to snapshot; no tax is invented for old transactions.
    new.content_snapshot := new.content_snapshot || jsonb_build_object(
      'grossAmount', v_order.total_amount
    );
  end if;

  return new;
end;
$$;

revoke all on function public.sellertray_snapshot_receipt_financials()
  from public,anon,authenticated;
grant execute on function public.sellertray_snapshot_receipt_financials()
  to service_role;

drop trigger if exists sellertray_snapshot_receipt_financials on public.sellertray_print_jobs;
create trigger sellertray_snapshot_receipt_financials
before insert on public.sellertray_print_jobs
for each row execute function public.sellertray_snapshot_receipt_financials();

commit;
