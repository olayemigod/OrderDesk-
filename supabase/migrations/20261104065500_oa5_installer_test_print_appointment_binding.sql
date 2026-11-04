-- OA5: A print job by an installer is evidence only for the exact
-- appointment that authorised the original request. Existing merchant test
-- jobs and historical printed receipts are not retrospectively attributed.
begin;

create table public.sellertray_installer_test_print_bindings (
  job_id uuid primary key references public.sellertray_print_jobs(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  appointment_id uuid not null references public.sellertray_commercial_setup_appointments(id) on delete restrict,
  assignment_id uuid not null references public.sellertray_internal_setup_staff_assignments(id) on delete restrict,
  printer_id uuid not null references public.sellertray_printers(id) on delete restrict,
  request_key text not null,
  requested_at timestamptz not null default now()
);
create index sellertray_installer_print_binding_appointment
  on public.sellertray_installer_test_print_bindings
    (tenant_id,branch_id,appointment_id,requested_at desc);
alter table public.sellertray_installer_test_print_bindings enable row level security;
revoke all on public.sellertray_installer_test_print_bindings from public,anon,authenticated;
grant select,insert on public.sellertray_installer_test_print_bindings to service_role;
create trigger prevent_sellertray_installer_test_print_binding_mutation
  before update or delete on public.sellertray_installer_test_print_bindings
  for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.request_sellertray_installer_test_print_job(
  p_actor_user_id uuid,p_tenant_id uuid,p_branch_id uuid,
  p_appointment_id uuid,p_printer_id uuid,p_request_key text
) returns jsonb language plpgsql security definer set search_path='' as $testprint$
declare
  v_assignment_id uuid;
  v_result jsonb;
  v_job_id uuid;
  v_job public.sellertray_print_jobs%rowtype;
  v_binding public.sellertray_installer_test_print_bindings%rowtype;
  v_key text:=btrim(coalesce(p_request_key,''));
begin
  -- This actor-parametrized command is called only by the server after JWT
  -- and AAL2 verification. Do not grant it to the authenticated browser role.
  if auth.jwt()->>'role' is distinct from 'service_role' then
    raise exception 'Server-only installer print command required' using errcode='42501';
  end if;
  if p_actor_user_id is null or p_tenant_id is null or p_branch_id is null
    or p_appointment_id is null or p_printer_id is null
    or char_length(v_key) not between 8 and 128 then
    raise exception 'Exact installation and test print request key required' using errcode='22023';
  end if;
  if not public.sellertray_setup_installer_has_assignment(
    p_actor_user_id,p_tenant_id,p_branch_id,p_appointment_id,now()
  ) then
    raise exception 'Installer appointment no longer permits test printing'
      using errcode='42501';
  end if;
  select a.id into v_assignment_id
  from public.sellertray_internal_setup_staff_assignments a
  where a.staff_user_id=p_actor_user_id
    and a.tenant_id=p_tenant_id and a.branch_id=p_branch_id
    and a.appointment_id=p_appointment_id
    and a.revoked_at is null and a.valid_from<=now()
    and a.valid_until>now()
  order by a.valid_from desc,a.id desc limit 1
  for share;
  if v_assignment_id is null then
    raise exception 'A current installation assignment is required'
      using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'installer-test-print:'||p_tenant_id::text||':'||v_key,0
  ));
  -- Use the existing canonical print job request and its request-key
  -- idempotency, native snapshot and printer event semantics unchanged.
  v_result:=public.request_sellertray_print_job(
    p_tenant_id,p_printer_id,'test',null,v_key,p_actor_user_id
  );
  v_job_id:=(v_result->>'jobId')::uuid;
  select * into strict v_job from public.sellertray_print_jobs
    where id=v_job_id and tenant_id=p_tenant_id;
  if v_job.job_type<>'test'
    or v_job.printer_id<>p_printer_id
    or v_job.branch_id<>p_branch_id
    or v_job.requested_by_user_id<>p_actor_user_id
    or v_job.request_key<>v_key
    or v_job.order_id is not null or v_job.financial_document_id is not null then
    raise exception 'Print request key is not owned by this installer setup'
      using errcode='23505';
  end if;
  select * into v_binding from public.sellertray_installer_test_print_bindings
    where job_id=v_job_id;
  if found then
    if v_binding.actor_user_id<>p_actor_user_id
      or v_binding.tenant_id<>p_tenant_id
      or v_binding.branch_id<>p_branch_id
      or v_binding.appointment_id<>p_appointment_id
      or v_binding.printer_id<>p_printer_id
      or v_binding.assignment_id<>v_assignment_id
      or v_binding.request_key<>v_key then
      raise exception 'Existing printed-test job belongs to another appointment'
        using errcode='23505';
    end if;
    return v_result||jsonb_build_object(
      'appointmentId',p_appointment_id,'idempotentReplay',true
    );
  end if;
  -- A previously existing unbound job cannot acquire appointment evidence
  -- through a later replay or concurrent installation assignment.
  if coalesce((v_result->>'idempotentReplay')::boolean,false) then
    raise exception 'An earlier unbound test job is not appointment evidence'
      using errcode='23505';
  end if;
  insert into public.sellertray_installer_test_print_bindings(
    job_id,actor_user_id,tenant_id,branch_id,appointment_id,
    assignment_id,printer_id,request_key,requested_at
  ) values (
    v_job_id,p_actor_user_id,p_tenant_id,p_branch_id,p_appointment_id,
    v_assignment_id,p_printer_id,v_key,v_job.requested_at
  );
  return v_result||jsonb_build_object(
    'appointmentId',p_appointment_id,'idempotentReplay',false
  );
end;
$testprint$;
revoke all on function public.request_sellertray_installer_test_print_job(
  uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.request_sellertray_installer_test_print_job(
  uuid,uuid,uuid,uuid,uuid,text) to service_role;

commit;