begin;

-- Historical Tax Authority convergence must snapshot pre-tax invoices/returns even
-- when the Business is currently read-only. This migration temporarily narrows
-- the normal runtime guards to permit only the exact zero-tax snapshot writes
-- performed by 20261020180000_tax_authority_foundation.sql.
--
-- The exception is migration-only. It is installed only before Tax Authority
-- exists, and 20261020180025 restores the strict runtime guards immediately after
-- the backfill. Ordinary subscription enforcement and return immutability remain
-- unchanged for every other operation and table.
do $migration$
begin
  if to_regclass('public.sellertray_tax_configurations') is null then
    execute $sql$
create or replace function public.guard_orderdesk_subscription_write()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_expected_line numeric;
  v_expected_subtotal numeric;
  v_has_invoice boolean := false;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);

  if public.orderdesk_subscription_can_write(v_tenant_id) then
    return coalesce(new, old);
  end if;

  -- The tax foundation may populate the immutable zero-tax snapshot of an
  -- existing invoiced order item. PostgreSQL exposes generated line_total as
  -- NULL in NEW during BEFORE UPDATE, so line_total is excluded from the row
  -- equality comparison and independently proven from the OLD commercial facts.
  if tg_op='UPDATE'
     and tg_table_schema='public'
     and tg_table_name='order_items' then
    v_old:=to_jsonb(old);
    v_new:=to_jsonb(new);

    select exists(
      select 1
      from public.order_financial_documents d
      where d.tenant_id=v_tenant_id
        and d.order_id=old.order_id
        and d.document_type='invoice'
    ) into v_has_invoice;

    v_expected_line:=coalesce(
      nullif(v_old->>'line_total','')::numeric,
      round((
        nullif(v_old->>'quantity','')::numeric
        * nullif(v_old->>'unit_price','')::numeric
      )::numeric,2)
    );

    if v_has_invoice
       and v_expected_line is not null
       and v_old->>'tax_basis_amount' is null
       and v_old->>'tax_rate_percent' is null
       and v_old->>'tax_amount' is null
       and v_old->>'gross_line_total' is null
       and nullif(v_new->>'tax_basis_amount','')::numeric = v_expected_line
       and nullif(v_new->>'tax_rate_percent','')::numeric = 0
       and nullif(v_new->>'tax_amount','')::numeric = 0
       and nullif(v_new->>'gross_line_total','')::numeric = v_expected_line
       and (
         v_new - array[
           'tax_basis_amount','tax_rate_percent','tax_amount','gross_line_total','line_total'
         ]::text[]
       ) = (
         v_old - array[
           'tax_basis_amount','tax_rate_percent','tax_amount','gross_line_total','line_total'
         ]::text[]
       ) then
      return new;
    end if;
  end if;

  -- The corresponding historical order header may receive only the exact
  -- zero-tax invoice snapshot. The invoice timestamp and subtotal are derived
  -- from authoritative persisted facts, not from client input.
  if tg_op='UPDATE'
     and tg_table_schema='public'
     and tg_table_name='orders' then
    v_old:=to_jsonb(old);
    v_new:=to_jsonb(new);

    select exists(
      select 1
      from public.order_financial_documents d
      where d.tenant_id=v_tenant_id
        and d.order_id=old.id
        and d.document_type='invoice'
        and d.issued_at=nullif(v_new->>'tax_posted_at','')::timestamptz
    ) into v_has_invoice;

    select coalesce(
      sum(coalesce(
        oi.tax_basis_amount,
        oi.line_total,
        round((oi.quantity*oi.unit_price)::numeric,2)
      ))::numeric(18,2),
      coalesce(nullif(v_old->>'total_amount','')::numeric,0)
    )
    into v_expected_subtotal
    from public.order_items oi
    where oi.tenant_id=v_tenant_id
      and oi.order_id=old.id;

    if v_has_invoice
       and v_old->>'subtotal_amount' is null
       and v_old->>'tax_applied' is null
       and v_old->>'tax_configuration_id' is null
       and v_old->>'tax_configuration_revision' is null
       and v_old->>'tax_rate_percent' is null
       and v_old->>'tax_amount' is null
       and v_old->>'tax_display_breakdown' is null
       and v_old->>'gross_amount' is null
       and v_old->>'tax_posted_at' is null
       and nullif(v_new->>'subtotal_amount','')::numeric = v_expected_subtotal
       and (v_new->>'tax_applied')::boolean is false
       and v_new->>'tax_configuration_id' is null
       and v_new->>'tax_configuration_revision' is null
       and nullif(v_new->>'tax_rate_percent','')::numeric = 0
       and nullif(v_new->>'tax_amount','')::numeric = 0
       and (v_new->>'tax_display_breakdown')::boolean is false
       and nullif(v_new->>'gross_amount','')::numeric = coalesce(nullif(v_old->>'total_amount','')::numeric,0)
       and nullif(v_new->>'total_amount','')::numeric = coalesce(nullif(v_old->>'total_amount','')::numeric,0)
       and (
         v_new - array[
           'subtotal_amount','tax_applied','tax_configuration_id','tax_configuration_revision',
           'tax_rate_percent','tax_amount','tax_display_breakdown','gross_amount','tax_posted_at',
           'total_amount'
         ]::text[]
       ) = (
         v_old - array[
           'subtotal_amount','tax_applied','tax_configuration_id','tax_configuration_revision',
           'tax_rate_percent','tax_amount','tax_display_breakdown','gross_amount','tax_posted_at',
           'total_amount'
         ]::text[]
       ) then
      return new;
    end if;
  end if;

  raise exception 'SellerTray subscription is read-only. Renew or reactivate the business to make changes.'
    using errcode='42501';
end;
$function$;
$sql$;

    execute $sql$
create or replace function public.prevent_sellertray_return_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op='UPDATE'
     and tg_table_schema='public'
     and tg_table_name='sale_return_items' then
    v_old:=to_jsonb(old);
    v_new:=to_jsonb(new);

    if v_old->>'subtotal_amount' is null
       and v_old->>'tax_amount' is null
       and nullif(v_new->>'subtotal_amount','')::numeric = old.line_total
       and nullif(v_new->>'tax_amount','')::numeric = 0
       and (
         v_new - array['subtotal_amount','tax_amount']::text[]
       ) = (
         v_old - array['subtotal_amount','tax_amount']::text[]
       ) then
      return new;
    end if;
  end if;

  if tg_op='UPDATE'
     and tg_table_schema='public'
     and tg_table_name='sale_returns' then
    v_old:=to_jsonb(old);
    v_new:=to_jsonb(new);

    if v_old->>'subtotal_amount' is null
       and v_old->>'tax_amount' is null
       and v_old->>'tax_configuration_id' is null
       and v_old->>'tax_configuration_revision' is null
       and v_old->>'tax_rate_percent' is null
       and nullif(v_new->>'subtotal_amount','')::numeric = old.amount
       and nullif(v_new->>'tax_amount','')::numeric = 0
       and v_new->>'tax_configuration_id' is null
       and v_new->>'tax_configuration_revision' is null
       and nullif(v_new->>'tax_rate_percent','')::numeric = 0
       and (
         v_new - array[
           'subtotal_amount','tax_amount','tax_configuration_id',
           'tax_configuration_revision','tax_rate_percent'
         ]::text[]
       ) = (
         v_old - array[
           'subtotal_amount','tax_amount','tax_configuration_id',
           'tax_configuration_revision','tax_rate_percent'
         ]::text[]
       ) then
      return new;
    end if;
  end if;

  raise exception 'SellerTray return and refund records are immutable' using errcode='55000';
end;
$function$;
$sql$;
  end if;
end
$migration$;

revoke all on function public.guard_orderdesk_subscription_write()
from public,anon,authenticated;
revoke all on function public.prevent_sellertray_return_mutation()
from public,anon,authenticated;

commit;
