alter table public.merchant_notifications
  add column if not exists lifecycle_source_type text,
  add column if not exists lifecycle_source_id uuid;

alter table public.merchant_notifications
  drop constraint if exists merchant_notifications_lifecycle_source_pair_check;
alter table public.merchant_notifications
  add constraint merchant_notifications_lifecycle_source_pair_check
  check (
    (lifecycle_source_type is null and lifecycle_source_id is null)
    or (
      lifecycle_source_type is not null
      and lifecycle_source_id is not null
      and char_length(btrim(lifecycle_source_type)) between 1 and 80
    )
  );

create unique index if not exists merchant_notifications_lifecycle_source_uniq
  on public.merchant_notifications(tenant_id,lifecycle_source_type,lifecycle_source_id,event_key)
  where lifecycle_source_id is not null;

alter table public.merchant_notifications drop constraint if exists merchant_notifications_event_check;
alter table public.merchant_notifications add constraint merchant_notifications_event_check
  check (event_key = any(array[
    'new_whatsapp_order','order_change_request','new_whatsapp_message',
    'payment_verification_required','payment_confirmed','payment_failed','payment_exception','payment_gate_blocked',
    'customer_complaint','refund_request','catalogue_enquiry','customer_enquiry','workflow_clarification',
    'platform_update','platform_service','platform_information','platform_promotion',
    'commercial_order_created','commercial_adjustment_applied','commercial_payment_confirmed','commercial_balance_outstanding',
    'master_agreement_required','master_agreement_accepted',
    'setup_scheduled','setup_rescheduled','setup_reassigned','setup_cancelled','setup_completed','setup_missed',
    'branch_readiness_reached','activation_succeeded','activation_attention_required','entitlement_full_released',
    'entitlement_expiring','entitlement_expired'
  ]::text[]));

create or replace function public.emit_sellertray_lifecycle_notification(
  p_tenant_id uuid,
  p_event_key text,
  p_source_type text,
  p_source_id uuid,
  p_severity text,
  p_title text,
  p_body text,
  p_branch_id uuid default null,
  p_audience_roles text[] default array['owner','manager']::text[],
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_event_key text:=btrim(coalesce(p_event_key,''));
  v_source_type text:=btrim(coalesce(p_source_type,''));
begin
  if p_tenant_id is null or p_source_id is null then
    raise exception 'Lifecycle notification tenant and source are required' using errcode='22023';
  end if;
  if v_source_type='' or char_length(v_source_type)>80 then
    raise exception 'Lifecycle notification source type is invalid' using errcode='22023';
  end if;
  if v_event_key <> all(array[
    'commercial_order_created','commercial_adjustment_applied','commercial_payment_confirmed','commercial_balance_outstanding',
    'master_agreement_required','master_agreement_accepted',
    'setup_scheduled','setup_rescheduled','setup_reassigned','setup_cancelled','setup_completed','setup_missed',
    'branch_readiness_reached','activation_succeeded','activation_attention_required','entitlement_full_released',
    'entitlement_expiring','entitlement_expired'
  ]::text[]) then
    raise exception 'Unsupported SellerTray lifecycle notification event' using errcode='22023';
  end if;

  insert into public.merchant_notifications(
    tenant_id,event_key,severity,title,body,message_type,branch_id,audience_roles,expires_at,
    lifecycle_source_type,lifecycle_source_id
  ) values (
    p_tenant_id,v_event_key,p_severity,btrim(p_title),btrim(p_body),'operational',p_branch_id,p_audience_roles,p_expires_at,
    v_source_type,p_source_id
  )
  on conflict (tenant_id,lifecycle_source_type,lifecycle_source_id,event_key)
    where lifecycle_source_id is not null
  do nothing
  returning id into v_id;

  if v_id is null then
    select n.id into strict v_id
    from public.merchant_notifications n
    where n.tenant_id=p_tenant_id
      and n.lifecycle_source_type=v_source_type
      and n.lifecycle_source_id=p_source_id
      and n.event_key=v_event_key;
  end if;
  return v_id;
end;
$$;
revoke all on function public.emit_sellertray_lifecycle_notification(uuid,text,text,uuid,text,text,text,uuid,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.emit_sellertray_lifecycle_notification(uuid,text,text,uuid,text,text,text,uuid,text[],timestamptz) to service_role;

create or replace function public.sellertray_merchant_unread_notification_count(p_tenant_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_role text;
  v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null then raise exception 'SellerTray business membership required' using errcode='42501'; end if;

  select count(*)::integer into v_count
  from public.merchant_notifications n
  where n.tenant_id=p_tenant_id
    and public.sellertray_current_user_can_access_notification_scope(n.tenant_id,n.branch_id)
    and (n.expires_at is null or n.expires_at>now())
    and (n.audience_roles is null or v_role=any(n.audience_roles))
    and not exists (
      select 1 from public.merchant_notification_reads r
      where r.notification_id=n.id and r.user_id=v_user_id
    );
  return v_count;
end;
$$;
revoke all on function public.sellertray_merchant_unread_notification_count(uuid) from public,anon,authenticated;
grant execute on function public.sellertray_merchant_unread_notification_count(uuid) to authenticated,service_role;

create or replace function public.expire_sellertray_commercial_balance_notifications(
  p_tenant_id uuid,p_commercial_order_id uuid,p_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer;
begin
  update public.merchant_notifications n
  set expires_at=least(coalesce(n.expires_at,p_at),p_at),updated_at=now()
  where n.tenant_id=p_tenant_id
    and n.event_key='commercial_balance_outstanding'
    and n.lifecycle_source_id is not null
    and (
      (n.lifecycle_source_type='commercial_adjustment' and exists(
        select 1 from public.sellertray_commercial_adjustments a
        where a.id=n.lifecycle_source_id and a.tenant_id=p_tenant_id and a.commercial_order_id=p_commercial_order_id
      ))
      or (n.lifecycle_source_type='commercial_direct_payment_confirmation' and exists(
        select 1 from public.sellertray_commercial_direct_payment_confirmations d
        where d.id=n.lifecycle_source_id and d.tenant_id=p_tenant_id and d.commercial_order_id=p_commercial_order_id
      ))
      or (n.lifecycle_source_type='commercial_gateway_payment_confirmation' and exists(
        select 1 from public.sellertray_commercial_installment_payment_confirmations g
        where g.id=n.lifecycle_source_id and g.tenant_id=p_tenant_id and g.commercial_order_id=p_commercial_order_id
      ))
    );
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.expire_sellertray_commercial_balance_notifications(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.expire_sellertray_commercial_balance_notifications(uuid,uuid,timestamptz) to service_role;

create or replace function public.queue_sellertray_commercial_order_lifecycle_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_version_id uuid; v_version_code text;
begin
  perform public.emit_sellertray_lifecycle_notification(
    new.tenant_id,'commercial_order_created','commercial_order',new.id,'info',
    'Commercial order created',
    'Your SellerTray commercial order '||new.order_reference||' has been created. Total: '||new.currency||' '||new.total_gross_amount::text||'.'
  );
  v_version_id:=public.resolve_sellertray_master_agreement_version_id(now());
  if v_version_id is not null and not public.sellertray_master_agreement_is_accepted(new.tenant_id,now()) then
    select v.version_code into v_version_code from public.sellertray_master_agreement_versions v where v.id=v_version_id;
    perform public.emit_sellertray_lifecycle_notification(
      new.tenant_id,'master_agreement_required','master_agreement_version',v_version_id,'attention',
      'Master Agreement acceptance required',
      'SellerTray Master Agreement '||v_version_code||' must be accepted before new service activation can complete. Payment remains available.'
    );
  end if;
  return new;
end;
$$;
revoke all on function public.queue_sellertray_commercial_order_lifecycle_notification() from public,anon,authenticated;

drop trigger if exists sellertray_commercial_order_lifecycle_notification on public.sellertray_commercial_orders;
create trigger sellertray_commercial_order_lifecycle_notification
after insert on public.sellertray_commercial_orders
for each row execute function public.queue_sellertray_commercial_order_lifecycle_notification();

create or replace function public.queue_sellertray_commercial_adjustment_lifecycle_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_state jsonb; v_outstanding numeric(18,2);
begin
  perform public.emit_sellertray_lifecycle_notification(
    new.tenant_id,'commercial_adjustment_applied','commercial_adjustment',new.id,'info',
    'Commercial adjustment applied',
    'An approved '||replace(new.adjustment_type,'_',' ')||' adjustment of '||new.currency||' '||new.amount::text||' has been applied to your SellerTray commercial order.'
  );
  v_state:=public.get_sellertray_commercial_settlement_state(new.tenant_id,new.commercial_order_id);
  v_outstanding:=coalesce((v_state->>'outstandingAmount')::numeric,0);
  if v_outstanding>=0.005 then
    perform public.emit_sellertray_lifecycle_notification(
      new.tenant_id,'commercial_balance_outstanding','commercial_adjustment',new.id,'attention',
      'Commercial balance outstanding',
      coalesce(v_state->>'currency',new.currency)||' '||v_outstanding::text||' remains outstanding on your SellerTray commercial order.'
    );
  else
    perform public.expire_sellertray_commercial_balance_notifications(new.tenant_id,new.commercial_order_id,now());
  end if;
  return new;
end;
$$;
revoke all on function public.queue_sellertray_commercial_adjustment_lifecycle_notification() from public,anon,authenticated;

drop trigger if exists sellertray_commercial_adjustment_lifecycle_notification on public.sellertray_commercial_adjustments;
create trigger sellertray_commercial_adjustment_lifecycle_notification
after insert on public.sellertray_commercial_adjustments
for each row execute function public.queue_sellertray_commercial_adjustment_lifecycle_notification();

create or replace function public.queue_sellertray_commercial_payment_lifecycle_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_state jsonb; v_outstanding numeric(18,2); v_source_type text;
begin
  v_source_type:=case tg_table_name
    when 'sellertray_commercial_direct_payment_confirmations' then 'commercial_direct_payment_confirmation'
    else 'commercial_gateway_payment_confirmation' end;
  perform public.emit_sellertray_lifecycle_notification(
    new.tenant_id,'commercial_payment_confirmed',v_source_type,new.id,'info',
    'Commercial payment confirmed',
    'A SellerTray commercial payment of '||new.currency||' '||new.amount::text||' has been confirmed.'
  );
  v_state:=public.get_sellertray_commercial_settlement_state(new.tenant_id,new.commercial_order_id);
  v_outstanding:=coalesce((v_state->>'outstandingAmount')::numeric,0);
  if v_outstanding>=0.005 then
    perform public.emit_sellertray_lifecycle_notification(
      new.tenant_id,'commercial_balance_outstanding',v_source_type,new.id,'attention',
      'Commercial balance outstanding',
      coalesce(v_state->>'currency',new.currency)||' '||v_outstanding::text||' remains outstanding on your SellerTray commercial order.'
    );
  else
    perform public.expire_sellertray_commercial_balance_notifications(new.tenant_id,new.commercial_order_id,now());
  end if;
  return new;
end;
$$;
revoke all on function public.queue_sellertray_commercial_payment_lifecycle_notification() from public,anon,authenticated;

drop trigger if exists sellertray_direct_payment_lifecycle_notification on public.sellertray_commercial_direct_payment_confirmations;
create trigger sellertray_direct_payment_lifecycle_notification
after insert on public.sellertray_commercial_direct_payment_confirmations
for each row execute function public.queue_sellertray_commercial_payment_lifecycle_notification();

drop trigger if exists sellertray_gateway_payment_lifecycle_notification on public.sellertray_commercial_installment_payment_confirmations;
create trigger sellertray_gateway_payment_lifecycle_notification
after insert on public.sellertray_commercial_installment_payment_confirmations
for each row execute function public.queue_sellertray_commercial_payment_lifecycle_notification();

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
        'SellerTray Master Agreement '||v_version_code||' must be accepted before new service activation can complete. Payment remains available.'
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
        'Your latest SellerTray entitlement term ended on '||to_char(v_ent.effective_until at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC. Review your commercial status or contact ProcessEdge for the next governed service term.'
      );
      v_expiry_count:=v_expiry_count+1;
    end if;
  end loop;
  return jsonb_build_object('agreementCandidates',v_agreement_count,'entitlementCandidates',v_expiry_count);
end;
$$;
revoke all on function public.materialize_sellertray_lifecycle_notifications() from public,anon,authenticated;
grant execute on function public.materialize_sellertray_lifecycle_notifications() to service_role;

create or replace function public.queue_sellertray_master_agreement_version_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.materialize_sellertray_lifecycle_notifications();
  return new;
end;
$$;
revoke all on function public.queue_sellertray_master_agreement_version_notification() from public,anon,authenticated;

drop trigger if exists sellertray_master_agreement_version_notification on public.sellertray_master_agreement_versions;
create trigger sellertray_master_agreement_version_notification
after insert on public.sellertray_master_agreement_versions
for each row execute function public.queue_sellertray_master_agreement_version_notification();

create or replace function public.queue_sellertray_master_agreement_acceptance_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.merchant_notifications n
  set expires_at=least(coalesce(n.expires_at,new.accepted_at),new.accepted_at),updated_at=now()
  where n.tenant_id=new.tenant_id
    and n.event_key='master_agreement_required'
    and n.lifecycle_source_type='master_agreement_version'
    and n.lifecycle_source_id=new.agreement_version_id;
  perform public.emit_sellertray_lifecycle_notification(
    new.tenant_id,'master_agreement_accepted','master_agreement_acceptance',new.id,'info',
    'Master Agreement accepted',
    'SellerTray Master Agreement '||new.agreement_version_code||' was accepted for your Business.'
  );
  return new;
end;
$$;
revoke all on function public.queue_sellertray_master_agreement_acceptance_notification() from public,anon,authenticated;

drop trigger if exists sellertray_master_agreement_acceptance_notification on public.sellertray_master_agreement_acceptances;
create trigger sellertray_master_agreement_acceptance_notification
after insert on public.sellertray_master_agreement_acceptances
for each row execute function public.queue_sellertray_master_agreement_acceptance_notification();

create or replace function public.queue_sellertray_setup_event_lifecycle_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_event_key text; v_severity text:='info'; v_title text; v_body text;
begin
  case new.event_type
    when 'scheduled' then v_event_key:='setup_scheduled'; v_title:='Branch setup scheduled'; v_body:='Your SellerTray Branch setup appointment has been scheduled.';
    when 'rescheduled' then v_event_key:='setup_rescheduled'; v_title:='Branch setup rescheduled'; v_body:='Your SellerTray Branch setup appointment has been rescheduled.';
    when 'reassigned' then v_event_key:='setup_reassigned'; v_title:='Branch setup assignment updated'; v_body:='The ProcessEdge setup assignment for your Branch has been updated.';
    when 'cancelled' then v_event_key:='setup_cancelled'; v_severity:='attention'; v_title:='Branch setup cancelled'; v_body:='Your SellerTray Branch setup appointment has been cancelled. A new appointment can be arranged through the governed setup process.';
    when 'completed' then v_event_key:='setup_completed'; v_title:='Branch setup completed'; v_body:='Your SellerTray Branch setup appointment has been completed with structured handover evidence.';
    when 'no_show' then v_event_key:='setup_missed'; v_severity:='attention'; v_title:='Branch setup appointment missed'; v_body:='The scheduled SellerTray Branch setup appointment was not completed. A new appointment is required.';
    else return new;
  end case;
  perform public.emit_sellertray_lifecycle_notification(
    new.tenant_id,v_event_key,'setup_appointment_event',new.id,v_severity,v_title,v_body,new.branch_id
  );
  return new;
end;
$$;
revoke all on function public.queue_sellertray_setup_event_lifecycle_notification() from public,anon,authenticated;

drop trigger if exists sellertray_setup_event_lifecycle_notification on public.sellertray_commercial_setup_appointment_events;
create trigger sellertray_setup_event_lifecycle_notification
after insert on public.sellertray_commercial_setup_appointment_events
for each row execute function public.queue_sellertray_setup_event_lifecycle_notification();

create or replace function public.queue_sellertray_branch_readiness_lifecycle_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.emit_sellertray_lifecycle_notification(
    new.tenant_id,'branch_readiness_reached','branch_setup_readiness',new.id,'info',
    'Branch setup ready','SellerTray Branch setup readiness has been confirmed from governed completion evidence.',new.branch_id
  );
  return new;
end;
$$;
revoke all on function public.queue_sellertray_branch_readiness_lifecycle_notification() from public,anon,authenticated;

drop trigger if exists sellertray_branch_readiness_lifecycle_notification on public.sellertray_commercial_branch_setup_readiness;
create trigger sellertray_branch_readiness_lifecycle_notification
after insert on public.sellertray_commercial_branch_setup_readiness
for each row execute function public.queue_sellertray_branch_readiness_lifecycle_notification();

create or replace function public.queue_sellertray_entitlement_lifecycle_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_has_provisional boolean:=false;
begin
  if new.event_type not in ('installment.provisional_activated','installment.full_entitlement_released') then return new; end if;

  update public.merchant_notifications n
  set expires_at=least(coalesce(n.expires_at,now()),now()),updated_at=now()
  where n.tenant_id=new.tenant_id
    and n.event_key in ('entitlement_expiring','entitlement_expired')
    and n.lifecycle_source_type='commercial_entitlement_event'
    and n.lifecycle_source_id<>new.id
    and exists(
      select 1 from public.sellertray_commercial_entitlement_events old_e
      where old_e.id=n.lifecycle_source_id and old_e.tenant_id=new.tenant_id
    );

  if new.event_type='installment.provisional_activated' then
    perform public.emit_sellertray_lifecycle_notification(
      new.tenant_id,'activation_succeeded','commercial_entitlement_event',new.id,'info',
      'SellerTray activated','SellerTray is now operational under the governed commercial entitlement for your Business.'
    );
  else
    select exists(
      select 1 from public.sellertray_commercial_entitlement_events e
      where e.tenant_id=new.tenant_id
        and e.installment_obligation_id=new.installment_obligation_id
        and e.event_type='installment.provisional_activated'
    ) into v_has_provisional;
    if not v_has_provisional then
      perform public.emit_sellertray_lifecycle_notification(
        new.tenant_id,'activation_succeeded','commercial_entitlement_event',new.id,'info',
        'SellerTray activated','SellerTray is now operational under the governed commercial entitlement for your Business.'
      );
    end if;
    perform public.emit_sellertray_lifecycle_notification(
      new.tenant_id,'entitlement_full_released','commercial_entitlement_event',new.id,'info',
      'Full subscription access confirmed',
      'Full SellerTray entitlement has been released through '||to_char(new.effective_until at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC.'
    );
  end if;
  return new;
end;
$$;
revoke all on function public.queue_sellertray_entitlement_lifecycle_notification() from public,anon,authenticated;

drop trigger if exists sellertray_entitlement_lifecycle_notification on public.sellertray_commercial_entitlement_events;
create trigger sellertray_entitlement_lifecycle_notification
after insert on public.sellertray_commercial_entitlement_events
for each row execute function public.queue_sellertray_entitlement_lifecycle_notification();

create or replace function public.queue_sellertray_activation_attention_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_appointment public.sellertray_commercial_setup_appointments%rowtype;
begin
  if new.action<>'setup_activation_reconciliation_failed' or new.tenant_id is null then return new; end if;
  select a.* into v_appointment
  from public.sellertray_commercial_setup_appointments a
  where a.tenant_id=new.tenant_id and a.id=nullif(new.detail->>'appointmentId','')::uuid;
  perform public.emit_sellertray_lifecycle_notification(
    new.tenant_id,'activation_attention_required','platform_admin_audit',new.id,'attention',
    'Activation needs attention',
    'Branch setup is complete, but SellerTray activation requires ProcessEdge attention. Your setup evidence remains recorded and support can retry the governed reconciliation.',
    v_appointment.branch_id
  );
  return new;
end;
$$;
revoke all on function public.queue_sellertray_activation_attention_notification() from public,anon,authenticated;

drop trigger if exists sellertray_activation_attention_notification on public.platform_admin_audit;
create trigger sellertray_activation_attention_notification
after insert on public.platform_admin_audit
for each row execute function public.queue_sellertray_activation_attention_notification();

do $$
declare v_job_id bigint;
begin
  if to_regclass('cron.job') is not null then
    select jobid into v_job_id from cron.job where jobname='sellertray-lifecycle-notifications' order by jobid desc limit 1;
    if v_job_id is not null then execute 'select cron.unschedule($1)' using v_job_id; end if;
    execute 'select cron.schedule($1,$2,$3)'
      using 'sellertray-lifecycle-notifications','17 * * * *','select public.materialize_sellertray_lifecycle_notifications();';
  end if;
end;
$$;

select public.materialize_sellertray_lifecycle_notifications();