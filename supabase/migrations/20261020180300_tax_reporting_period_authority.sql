begin;

-- Tax reporting follows the immutable business events that actually post tax.
-- A draft/order may be created before it is finalised, so sales belong to the
-- tax_posted_at period. Returns are inserted atomically as completed records,
-- therefore sale_returns.created_at is their posting event.
create or replace function public.get_sellertray_tax_report_summary(
  p_tenant_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_branch_id uuid default null,
  p_source text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_timezone text;
  v_currency text;
  v_date_from date;
  v_date_to date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_source text:=nullif(lower(btrim(coalesce(p_source,''))),'');
  v_sales_subtotal numeric(18,2):=0;
  v_sales_tax numeric(18,2):=0;
  v_sales_gross numeric(18,2):=0;
  v_return_subtotal numeric(18,2):=0;
  v_return_tax numeric(18,2):=0;
  v_return_gross numeric(18,2):=0;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id and tm.role in ('owner','manager')
  ) or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'Tax reports are available to Owners and Managers' using errcode='42501';
  end if;

  select coalesce(nullif(t.timezone,''),'Africa/Lagos'),upper(t.currency)
  into v_timezone,v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_timezone is null then raise exception 'Business not found' using errcode='P0002'; end if;

  v_date_to:=coalesce(p_date_to,(now() at time zone v_timezone)::date);
  v_date_from:=coalesce(p_date_from,v_date_to-29);
  if v_date_from>v_date_to or (v_date_to-v_date_from)>365 then
    raise exception 'Tax report date range is invalid' using errcode='22023';
  end if;
  v_start_at:=v_date_from::timestamp at time zone v_timezone;
  v_end_at:=(v_date_to+1)::timestamp at time zone v_timezone;

  if v_source='all' then v_source:=null; end if;
  if v_source is not null and v_source not in ('pos','whatsapp','manual') then
    raise exception 'Unsupported sales channel' using errcode='22023';
  end if;

  if p_branch_id is not null then
    if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then
      raise exception 'Branch not found' using errcode='P0002';
    end if;
    if not public.sellertray_user_can_read_report_branch(p_tenant_id,p_branch_id,v_user_id) then
      raise exception 'You do not have access to reports for this Branch' using errcode='42501';
    end if;
  end if;

  select
    coalesce(sum(o.subtotal_amount),0)::numeric(18,2),
    coalesce(sum(o.tax_amount),0)::numeric(18,2),
    coalesce(sum(o.gross_amount),0)::numeric(18,2)
  into v_sales_subtotal,v_sales_tax,v_sales_gross
  from public.orders o
  where o.tenant_id=p_tenant_id
    and o.deleted_at is null
    and o.status='completed'
    and o.tax_posted_at is not null
    and o.tax_posted_at>=v_start_at and o.tax_posted_at<v_end_at
    and public.sellertray_user_can_read_report_branch(p_tenant_id,o.branch_id,v_user_id)
    and (p_branch_id is null or o.branch_id=p_branch_id)
    and (v_source is null or o.source=v_source);

  select
    coalesce(sum(coalesce(sr.subtotal_amount,sr.amount)),0)::numeric(18,2),
    coalesce(sum(coalesce(sr.tax_amount,0)),0)::numeric(18,2),
    coalesce(sum(sr.amount),0)::numeric(18,2)
  into v_return_subtotal,v_return_tax,v_return_gross
  from public.sale_returns sr
  join public.orders o on o.tenant_id=sr.tenant_id and o.id=sr.order_id
  where sr.tenant_id=p_tenant_id
    and sr.status='completed'
    and sr.created_at>=v_start_at and sr.created_at<v_end_at
    and public.sellertray_user_can_read_report_branch(p_tenant_id,sr.branch_id,v_user_id)
    and (p_branch_id is null or sr.branch_id=p_branch_id)
    and (v_source is null or o.source=v_source);

  return jsonb_build_object(
    'currency',v_currency,
    'dateFrom',v_date_from,
    'dateTo',v_date_to,
    'salesSubtotal',v_sales_subtotal,
    'salesTax',v_sales_tax,
    'salesGross',v_sales_gross,
    'returnedSubtotal',v_return_subtotal,
    'returnedTax',v_return_tax,
    'returnedGross',v_return_gross,
    'netRevenue',(v_sales_subtotal-v_return_subtotal)::numeric(18,2),
    'netTax',(v_sales_tax-v_return_tax)::numeric(18,2),
    'netGross',(v_sales_gross-v_return_gross)::numeric(18,2)
  );
end;
$$;

revoke all on function public.get_sellertray_tax_report_summary(uuid,date,date,uuid,text) from public,anon;
grant execute on function public.get_sellertray_tax_report_summary(uuid,date,date,uuid,text) to authenticated;

commit;
