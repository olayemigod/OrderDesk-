-- Close OA5A cross-device read synchronization without broadening read permissions.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='merchant_notification_reads') then
    alter publication supabase_realtime add table public.merchant_notification_reads;
  end if;
end;
$$;

create or replace function public.materialize_sellertray_lifecycle_notifications()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_version_id uuid;
  v_version_code text;
  v_tenant record;
  v_ent record;
  v_agreement_count integer:=0;
  v_expiry_count integer:=0;
  v_notification_id uuid;
begin
  v_version_id:=public.resolve_sellertray_master_agreement_version_id(now());
  update public.merchant_notifications n
  set expires_at=now(),updated_at=now()
  where n.event_key='master_agreement_required'
    and n.lifecycle_source_type='master_agreement_version'
    and (n.expires_at is null or n.expires_at>now())
    and (n.lifecycle_source_id is distinct from v_version_id
      or public.sellertray_master_agreement_is_accepted(n.tenant_id,now()));

  update public.merchant_notifications n
  set expires_at=now(),updated_at=now()
  where n.event_key='entitlement_expiring'
    and n.lifecycle_source_type='commercial_entitlement_event'
    and (n.expires_at is null or n.expires_at>now())
    and exists(select 1 from public.sellertray_commercial_entitlement_events e
      where e.id=n.lifecycle_source_id and e.tenant_id=n.tenant_id and e.effective_until<=now());

  if v_version_id is not null then
    select v.version_code into v_version_code from public.sellertray_master_agreement_versions v where v.id=v_version_id;
    for v_tenant in
      select distinct o.tenant_id
      from public.sellertray_commercial_orders o
      where not public.sellertray_master_agreement_is_accepted(o.tenant_id,now())
    loop
      v_notification_id:=public.emit_sellertray_lifecycle_notification(
        v_tenant.tenant_id,'master_agreement_required','master_agreement_version',v_version_id,'attention',
        'Master Agreement acceptance required',
        'SellerTray Master Agreement '||v_version_code||' must be accepted before new service activation can complete. You can still make payments.'
      );
      v_agreement_count:=v_agreement_count+1;
    end loop;
  end if;

  for v_ent in
    with ranked as (
      select e.*,
             row_number() over(
               partition by e.tenant_id
               order by e.effective_from desc,
                        case e.event_type when 'installment.full_entitlement_released' then 0 else 1 end,
                        e.recorded_at desc,e.id desc
             ) as rn
      from public.sellertray_commercial_entitlement_events e
      where e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')
        and e.effective_until is not null
    )
    select * from ranked where rn=1
  loop
    if v_ent.effective_until>now() and v_ent.effective_until<=now()+interval '7 days' then
      v_notification_id:=public.emit_sellertray_lifecycle_notification(
        v_ent.tenant_id,'entitlement_expiring','commercial_entitlement_event',v_ent.id,'attention',
        'SellerTray entitlement ending soon',
        'Your current SellerTray entitlement term ends on '||to_char(v_ent.effective_until at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC. Review your commercial status before the term ends.'
      );
      v_expiry_count:=v_expiry_count+1;
    elsif v_ent.effective_until<=now() then
      v_notification_id:=public.emit_sellertray_lifecycle_notification(
        v_ent.tenant_id,'entitlement_expired','commercial_entitlement_event',v_ent.id,'attention',
        'SellerTray entitlement term ended',
        'Your latest SellerTray entitlement term ended on '||to_char(v_ent.effective_until at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC. Review your commercial status or contact ProcessEdge for the next service term.'
      );
      v_expiry_count:=v_expiry_count+1;
    end if;
  end loop;
  return jsonb_build_object('agreementCandidates',v_agreement_count,'entitlementCandidates',v_expiry_count);
end;
$$;
revoke all on function public.materialize_sellertray_lifecycle_notifications() from public,anon,authenticated;
grant execute on function public.materialize_sellertray_lifecycle_notifications() to service_role;
