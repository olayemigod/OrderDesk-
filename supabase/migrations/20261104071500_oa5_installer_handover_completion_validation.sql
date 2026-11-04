-- OA5: An Admin choosing a field-installer handover must link the immutable
-- evidence to the existing canonical setup-completion event. No second
-- readiness, entitlement or activation state is introduced.
begin;

create or replace function public.sellertray_validate_installer_handover_completion()
returns trigger language plpgsql security definer set search_path='' as $validate$
declare
  v_reference uuid;
  v_handover public.sellertray_installer_handover_submissions%rowtype;
  v_device jsonb;
  v_evidence jsonb;
begin
  if new.event_type <> 'completed' then return new; end if;
  v_evidence := new.details->'evidence';
  if jsonb_typeof(v_evidence) <> 'object' then return new; end if;
  if not (v_evidence ? 'installerHandoverSubmissionId') then return new; end if;
  v_reference := nullif(btrim(coalesce(
    v_evidence->>'installerHandoverSubmissionId',''
  )), '')::uuid;
  if v_reference is null then
    raise exception 'A valid ProcessEdge handover reference is required'
      using errcode='23514';
  end if;
  select * into v_handover from public.sellertray_installer_handover_submissions h
  where h.id=v_reference
    and h.tenant_id=new.tenant_id
    and h.branch_id=new.branch_id
    and h.appointment_id=new.appointment_id;
  if not found then
    raise exception 'The selected handover belongs to a different Branch appointment'
      using errcode='23514';
  end if;
  if not exists (
    select 1 from public.sellertray_installer_test_print_bindings b
    join public.sellertray_print_jobs j
      on j.id=b.job_id and j.tenant_id=b.tenant_id
    where b.job_id=v_handover.test_job_id
      and b.tenant_id=v_handover.tenant_id
      and b.branch_id=v_handover.branch_id
      and b.appointment_id=v_handover.appointment_id
      and b.actor_user_id=v_handover.actor_user_id
      and b.printer_id=v_handover.printer_id
      and j.status='printed' and j.job_type='test'
      and j.order_id is null and j.financial_document_id is null
  ) then
    raise exception 'The handover test is not bound to this installer appointment'
      using errcode='23514';
  end if;
  if v_evidence->>'receivedBy' is distinct from v_handover.evidence->>'receivedBy'
    or v_evidence->>'acknowledgement' is distinct from v_handover.evidence->>'acknowledgement' then
    raise exception 'The reviewed handover recipient and acknowledgement must match submitted evidence'
      using errcode='23514';
  end if;
  select item.value into v_device
  from jsonb_array_elements(coalesce(v_evidence->'equipment','[]'::jsonb)) item
  where item.value->>'identifier'=v_handover.evidence#>>'{equipment,0,identifier}'
    and item.value->>'handoverCondition'=v_handover.evidence#>>'{equipment,0,handoverCondition}'
  limit 1;
  if v_device is null then
    raise exception 'The reviewed printer and handover condition must match the installer submission'
      using errcode='23514';
  end if;
  -- Required human walkthrough/test confirmations are checked by the
  -- pre-existing setup-completion validator, not fabricated by this trigger.
  return new;
end;
$validate$;
revoke all on function public.sellertray_validate_installer_handover_completion()
  from public,anon,authenticated;
create trigger sellertray_validate_installer_handover_completion
  before insert on public.sellertray_commercial_setup_appointment_events
  for each row execute function public.sellertray_validate_installer_handover_completion();
commit;