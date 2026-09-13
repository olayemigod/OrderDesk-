create extension if not exists pg_cron;

create or replace function public.prepare_due_orderdesk_usage_settlements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period record;
  v_result jsonb;
  v_prepared integer := 0;
begin
  for v_period in
    select distinct
      u.tenant_id,
      u.billing_period_start,
      u.billing_period_end
    from public.usage_events u
    where u.event_code = 'AI_ORDER_ACTIVITY'
      and u.amount is not null
      and u.amount > 0
      and u.billing_period_start is not null
      and u.billing_period_end is not null
      and u.billing_period_end <= now()
      and not exists (
        select 1
        from public.usage_settlement_items usi
        where usi.usage_event_id = u.id
      )
  loop
    begin
      v_result := public.prepare_orderdesk_usage_settlement(
        v_period.tenant_id,
        v_period.billing_period_start,
        v_period.billing_period_end
      );
      if coalesce(v_result->>'status', '') = 'pending'
        and coalesce((v_result->>'existing')::boolean, false) = false
      then
        v_prepared := v_prepared + 1;
      end if;
    exception when others then
      raise warning 'SellerTray usage settlement preparation failed for tenant % period % - %: %',
        v_period.tenant_id,
        v_period.billing_period_start,
        v_period.billing_period_end,
        sqlerrm;
    end;
  end loop;

  return v_prepared;
end;
$$;

revoke all on function public.prepare_due_orderdesk_usage_settlements()
  from public, anon, authenticated;
grant execute on function public.prepare_due_orderdesk_usage_settlements()
  to service_role;

select cron.schedule(
  'sellertray-prepare-usage-settlements',
  '15 1 * * *',
  'select public.prepare_due_orderdesk_usage_settlements();'
);
