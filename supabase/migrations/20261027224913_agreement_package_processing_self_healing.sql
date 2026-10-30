begin;

-- SellerTray OA5C durable self-healing for zero-touch Agreement Package orchestration.
-- This is operational processing state only. It does not replace or mutate immutable
-- Master Agreement, Order Form, Agreement Package, acceptance or confirmation truth.
-- Existing commercial orders are deliberately not backfilled: only subjects that enter
-- the zero-touch orchestration path after this migration are registered for retries.

create table public.sellertray_agreement_package_processing (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  installment_obligation_id uuid,
  subject_kind text not null,
  subject_id uuid not null,
  order_form_family text not null,
  orchestration_actor_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_result_code text,
  last_error_detail text,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,subject_kind,subject_id),
  constraint sellertray_agreement_processing_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id) on delete cascade,
  constraint sellertray_agreement_processing_obligation_same_order
    foreign key (tenant_id,commercial_order_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,id) on delete cascade,
  constraint sellertray_agreement_processing_subject_check check (
    (subject_kind='commercial_order' and installment_obligation_id is null and subject_id=commercial_order_id and order_form_family='subscription_order')
    or
    (subject_kind='installment_obligation' and installment_obligation_id is not null and subject_id=installment_obligation_id and order_form_family='installment_agreement')
  ),
  constraint sellertray_agreement_processing_status_check check (
    status in ('pending','retryable','resolved','manual_attention')
  ),
  constraint sellertray_agreement_processing_attempt_check check (attempt_count>=0),
  constraint sellertray_agreement_processing_result_code_check check (
    last_result_code is null or char_length(last_result_code) between 1 and 100
  ),
  constraint sellertray_agreement_processing_error_detail_check check (
    last_error_detail is null or char_length(last_error_detail)<=1000
  )
);

create index sellertray_agreement_processing_due_idx
  on public.sellertray_agreement_package_processing(status,next_retry_at,updated_at)
  where status in ('pending','retryable');
create index sellertray_agreement_processing_tenant_idx
  on public.sellertray_agreement_package_processing(tenant_id,status,updated_at desc);
create index sellertray_agreement_processing_order_idx
  on public.sellertray_agreement_package_processing(tenant_id,commercial_order_id,updated_at desc);

alter table public.sellertray_agreement_package_processing enable row level security;
revoke all on table public.sellertray_agreement_package_processing from public,anon,authenticated,service_role;

create or replace function public.ensure_sellertray_agreement_package_managed(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_subject_kind text;
  v_subject_id uuid;
  v_family text;
  v_attempt integer;
  v_result jsonb;
  v_result_code text;
  v_error_state text;
  v_error_message text;
  v_next_retry_at timestamptz;
begin
  if p_tenant_id is null or p_commercial_order_id is null or p_actor_user_id is null then
    raise exception 'Business, commercial order and orchestration actor are required' using errcode='22023';
  end if;

  if p_installment_obligation_id is null then
    v_subject_kind := 'commercial_order';
    v_subject_id := p_commercial_order_id;
    v_family := 'subscription_order';
  else
    v_subject_kind := 'installment_obligation';
    v_subject_id := p_installment_obligation_id;
    v_family := 'installment_agreement';
  end if;

  insert into public.sellertray_agreement_package_processing(
    tenant_id,commercial_order_id,installment_obligation_id,subject_kind,subject_id,
    order_form_family,orchestration_actor_user_id,status,attempt_count,last_result_code,
    last_error_detail,last_attempt_at,next_retry_at,resolved_at,updated_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_installment_obligation_id,v_subject_kind,v_subject_id,
    v_family,p_actor_user_id,'pending',1,null,null,now(),null,null,now()
  )
  on conflict (tenant_id,subject_kind,subject_id) do update set
    status='pending',
    attempt_count=public.sellertray_agreement_package_processing.attempt_count+1,
    last_result_code=null,
    last_error_detail=null,
    last_attempt_at=now(),
    next_retry_at=null,
    resolved_at=null,
    updated_at=now()
  returning attempt_count into v_attempt;

  begin
    v_result := public.ensure_sellertray_agreement_package_for_commercial_order(
      p_tenant_id,p_commercial_order_id,p_installment_obligation_id,p_actor_user_id
    );
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate, v_error_message = message_text;
    if v_attempt>=8 then
      update public.sellertray_agreement_package_processing
      set status='manual_attention',
          last_result_code='orchestration_error',
          last_error_detail=left('['||coalesce(v_error_state,'XXXXX')||'] '||coalesce(v_error_message,'Agreement orchestration failed'),1000),
          next_retry_at=null,
          resolved_at=null,
          updated_at=now()
      where tenant_id=p_tenant_id and subject_kind=v_subject_kind and subject_id=v_subject_id;

      return jsonb_build_object(
        'status','manual_attention','ready',false,'tenantId',p_tenant_id,
        'commercialOrderId',p_commercial_order_id,'installmentObligationId',p_installment_obligation_id,
        'processingAttempt',v_attempt
      );
    end if;

    v_next_retry_at := now() + interval '1 minute' * least(60,power(2,least(greatest(v_attempt-1,0),6))::integer);
    update public.sellertray_agreement_package_processing
    set status='retryable',
        last_result_code='orchestration_error',
        last_error_detail=left('['||coalesce(v_error_state,'XXXXX')||'] '||coalesce(v_error_message,'Agreement orchestration failed'),1000),
        next_retry_at=v_next_retry_at,
        resolved_at=null,
        updated_at=now()
    where tenant_id=p_tenant_id and subject_kind=v_subject_kind and subject_id=v_subject_id;

    return jsonb_build_object(
      'status','orchestration_retry_scheduled','ready',false,'tenantId',p_tenant_id,
      'commercialOrderId',p_commercial_order_id,'installmentObligationId',p_installment_obligation_id,
      'processingAttempt',v_attempt,'nextRetryAt',v_next_retry_at
    );
  end;

  v_result_code := coalesce(v_result->>'status','unknown');
  if coalesce((v_result->>'ready')::boolean,false) then
    update public.sellertray_agreement_package_processing
    set status='resolved',
        last_result_code=v_result_code,
        last_error_detail=null,
        next_retry_at=null,
        resolved_at=now(),
        updated_at=now()
    where tenant_id=p_tenant_id and subject_kind=v_subject_kind and subject_id=v_subject_id;
    return v_result || jsonb_build_object('processingStatus','resolved','processingAttempt',v_attempt);
  end if;

  if v_result_code in ('master_agreement_missing','order_form_template_missing') then
    -- Configuration publication triggers wake these rows immediately. Six hours is
    -- only the fallback reconciliation interval if a wake-up is missed.
    v_next_retry_at := now()+interval '6 hours';
    update public.sellertray_agreement_package_processing
    set status='retryable',
        last_result_code=v_result_code,
        last_error_detail=null,
        next_retry_at=v_next_retry_at,
        resolved_at=null,
        updated_at=now()
    where tenant_id=p_tenant_id and subject_kind=v_subject_kind and subject_id=v_subject_id;
    return v_result || jsonb_build_object(
      'processingStatus','retryable','processingAttempt',v_attempt,'nextRetryAt',v_next_retry_at
    );
  end if;

  update public.sellertray_agreement_package_processing
  set status='manual_attention',
      last_result_code=v_result_code,
      last_error_detail='Agreement orchestration returned an unrecognised non-ready result',
      next_retry_at=null,
      resolved_at=null,
      updated_at=now()
  where tenant_id=p_tenant_id and subject_kind=v_subject_kind and subject_id=v_subject_id;

  return v_result || jsonb_build_object('processingStatus','manual_attention','processingAttempt',v_attempt);
end;
$$;
revoke all on function public.ensure_sellertray_agreement_package_managed(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.ensure_sellertray_agreement_package_managed(uuid,uuid,uuid,uuid)
  to service_role;

create or replace function public.orchestrate_sellertray_agreement_package_after_installment_schedule()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_materialized numeric(18,2);
begin
  select io.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations io
  where io.tenant_id=new.tenant_id and io.id=new.installment_obligation_id;

  select coalesce(sum(s.amount_due),0)::numeric(18,2)
  into v_materialized
  from public.sellertray_commercial_installment_schedule s
  where s.tenant_id=new.tenant_id
    and s.installment_obligation_id=new.installment_obligation_id;

  if abs(v_materialized-v_obligation.obligated_amount)<0.005 then
    perform public.ensure_sellertray_agreement_package_managed(
      new.tenant_id,
      v_obligation.commercial_order_id,
      v_obligation.id,
      v_obligation.created_by_user_id
    );
  end if;

  return new;
end;
$$;
revoke all on function public.orchestrate_sellertray_agreement_package_after_installment_schedule()
  from public,anon,authenticated;

create or replace function public.process_sellertray_agreement_package_retries(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_limit integer := least(500,greatest(1,coalesce(p_limit,100)));
  v_work public.sellertray_agreement_package_processing%rowtype;
  v_result jsonb;
  v_processed integer := 0;
  v_resolved integer := 0;
  v_retryable integer := 0;
  v_manual integer := 0;
begin
  for v_work in
    select p.*
    from public.sellertray_agreement_package_processing p
    where (
      (p.status='retryable' and p.next_retry_at is not null and p.next_retry_at<=now())
      or
      (p.status='pending' and coalesce(p.last_attempt_at,p.created_at)<=now()-interval '5 minutes')
    )
    order by coalesce(p.next_retry_at,p.last_attempt_at,p.created_at),p.id
    for update skip locked
    limit v_limit
  loop
    v_result := public.ensure_sellertray_agreement_package_managed(
      v_work.tenant_id,
      v_work.commercial_order_id,
      v_work.installment_obligation_id,
      v_work.orchestration_actor_user_id
    );
    v_processed := v_processed+1;
    case coalesce(v_result->>'processingStatus',v_result->>'status')
      when 'resolved' then v_resolved := v_resolved+1;
      when 'retryable' then v_retryable := v_retryable+1;
      when 'orchestration_retry_scheduled' then v_retryable := v_retryable+1;
      when 'manual_attention' then v_manual := v_manual+1;
      else null;
    end case;
  end loop;

  return jsonb_build_object(
    'processed',v_processed,
    'resolved',v_resolved,
    'retryable',v_retryable,
    'manualAttention',v_manual
  );
end;
$$;
revoke all on function public.process_sellertray_agreement_package_retries(integer)
  from public,anon,authenticated;
grant execute on function public.process_sellertray_agreement_package_retries(integer)
  to service_role;

create or replace function public.wake_sellertray_agreement_package_processing_after_configuration()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_table_name='sellertray_master_agreement_versions' then
    update public.sellertray_agreement_package_processing
    set next_retry_at=greatest(now(),new.effective_from),updated_at=now()
    where status='retryable' and last_result_code='master_agreement_missing';
  elsif tg_table_name='sellertray_commercial_agreement_template_versions' then
    update public.sellertray_agreement_package_processing
    set next_retry_at=greatest(now(),new.effective_from),updated_at=now()
    where status='retryable'
      and last_result_code='order_form_template_missing'
      and order_form_family=new.agreement_family;
  end if;
  return new;
end;
$$;
revoke all on function public.wake_sellertray_agreement_package_processing_after_configuration()
  from public,anon,authenticated;

drop trigger if exists wake_sellertray_agreement_processing_after_master_publish
  on public.sellertray_master_agreement_versions;
create trigger wake_sellertray_agreement_processing_after_master_publish
after insert on public.sellertray_master_agreement_versions
for each row execute function public.wake_sellertray_agreement_package_processing_after_configuration();

drop trigger if exists wake_sellertray_agreement_processing_after_template_publish
  on public.sellertray_commercial_agreement_template_versions;
create trigger wake_sellertray_agreement_processing_after_template_publish
after insert on public.sellertray_commercial_agreement_template_versions
for each row execute function public.wake_sellertray_agreement_package_processing_after_configuration();

create or replace function public.reconcile_sellertray_agreement_package_admin(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reason text := btrim(coalesce(p_reason,''));
  v_processing public.sellertray_agreement_package_processing%rowtype;
  v_result jsonb;
begin
  if p_actor_user_id is null or not public.platform_admin_has_capability(
    p_actor_user_id,'admin.agreements.recover',p_tenant_id,now()
  ) then
    raise exception 'Agreement reconciliation capability required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_commercial_order_id is null then
    raise exception 'Business and commercial order are required' using errcode='22023';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Agreement reconciliation reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  select p.* into v_processing
  from public.sellertray_agreement_package_processing p
  where p.tenant_id=p_tenant_id
    and p.commercial_order_id=p_commercial_order_id
    and p.status in ('retryable','manual_attention')
  order by case p.status when 'manual_attention' then 0 else 1 end,p.updated_at desc,p.id desc
  limit 1
  for update;

  if not found then
    raise exception 'No zero-touch Agreement Package exception is registered for this commercial order' using errcode='P0002';
  end if;

  v_result := public.ensure_sellertray_agreement_package_managed(
    v_processing.tenant_id,
    v_processing.commercial_order_id,
    v_processing.installment_obligation_id,
    v_processing.orchestration_actor_user_id
  );

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,p_tenant_id,'sellertray_agreement_package_reconciled',jsonb_build_object(
    'commercialOrderId',p_commercial_order_id,
    'processingId',v_processing.id,
    'installmentObligationId',v_processing.installment_obligation_id,
    'resultStatus',v_result->>'status',
    'processingStatus',v_result->>'processingStatus',
    'reason',v_reason
  ));

  return v_result;
end;
$$;
revoke all on function public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.reconcile_sellertray_agreement_package_admin(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.get_sellertray_agreement_processing_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid default null,
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_limit integer := least(200,greatest(1,coalesce(p_limit,100)));
  v_summary jsonb;
  v_items jsonb;
begin
  if p_actor_user_id is null or not public.platform_admin_has_capability(
    p_actor_user_id,'admin.agreements.recover',p_tenant_id,now()
  ) then
    raise exception 'Agreement recovery capability required' using errcode='42501';
  end if;
  if p_status is not null and p_status not in ('pending','retryable','resolved','manual_attention') then
    raise exception 'Unsupported agreement processing status' using errcode='22023';
  end if;

  select jsonb_build_object(
    'pending',count(*) filter (where p.status='pending'),
    'retryable',count(*) filter (where p.status='retryable'),
    'resolved',count(*) filter (where p.status='resolved'),
    'manualAttention',count(*) filter (where p.status='manual_attention')
  ) into v_summary
  from public.sellertray_agreement_package_processing p
  where (p_tenant_id is null or p.tenant_id=p_tenant_id)
    and (p_status is null or p.status=p_status);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,
    'tenantId',q.tenant_id,
    'commercialOrderId',q.commercial_order_id,
    'installmentObligationId',q.installment_obligation_id,
    'subjectKind',q.subject_kind,
    'orderFormFamily',q.order_form_family,
    'status',q.status,
    'attemptCount',q.attempt_count,
    'lastResultCode',q.last_result_code,
    'lastErrorDetail',q.last_error_detail,
    'lastAttemptAt',q.last_attempt_at,
    'nextRetryAt',q.next_retry_at,
    'resolvedAt',q.resolved_at,
    'updatedAt',q.updated_at
  ) order by q.sort_rank,q.updated_at desc,q.id),'[]'::jsonb)
  into v_items
  from (
    select p.*,
      case p.status when 'manual_attention' then 0 when 'retryable' then 1 when 'pending' then 2 else 3 end as sort_rank
    from public.sellertray_agreement_package_processing p
    where (p_tenant_id is null or p.tenant_id=p_tenant_id)
      and (p_status is null or p.status=p_status)
    order by sort_rank,p.updated_at desc,p.id
    limit v_limit
  ) q;

  return jsonb_build_object('summary',coalesce(v_summary,'{}'::jsonb),'items',v_items);
end;
$$;
revoke all on function public.get_sellertray_agreement_processing_admin(uuid,uuid,text,integer)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_agreement_processing_admin(uuid,uuid,text,integer)
  to service_role;

create or replace function public.get_sellertray_order_forms_admin(p_actor_user_id uuid,p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_master jsonb;
  v_forms jsonb;
  v_can_recover boolean;
  v_processing jsonb;
begin
  v_master := public.get_sellertray_master_agreement_admin(p_actor_user_id,p_tenant_id);
  v_can_recover := public.platform_admin_has_capability(
    p_actor_user_id,'admin.agreements.recover',p_tenant_id,now()
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,
    'reference',f.order_form_reference,
    'commercialOrderId',f.commercial_order_id,
    'installmentObligationId',f.installment_obligation_id,
    'templateVersionId',f.order_form_template_version_id,
    'templateVersionCode',f.template_version_code,
    'contentSha256',f.content_sha256,
    'commercialSnapshotSha256',f.commercial_snapshot_sha256,
    'supersedesOrderFormId',f.supersedes_order_form_id,
    'issuedAt',f.issued_at,
    'confirmed',c.id is not null,
    'confirmedAt',c.confirmed_at,
    'packageFingerprint',c.package_fingerprint
  ) order by f.issued_at desc,f.id desc),'[]'::jsonb)
  into v_forms
  from public.sellertray_commercial_order_forms f
  left join public.sellertray_order_form_confirmations c
    on c.tenant_id=f.tenant_id and c.order_form_id=f.id
  where p_tenant_id is not null and f.tenant_id=p_tenant_id;

  if v_can_recover then
    v_processing := public.get_sellertray_agreement_processing_admin(
      p_actor_user_id,p_tenant_id,null,100
    );
  else
    v_processing := jsonb_build_object(
      'summary',jsonb_build_object('pending',0,'retryable',0,'resolved',0,'manualAttention',0),
      'items','[]'::jsonb
    );
  end if;

  return v_master || jsonb_build_object(
    'canIssueOrderForms',false,
    'canRecoverAgreementPackages',v_can_recover,
    'orderForms',v_forms,
    'agreementProcessing',v_processing
  );
end;
$$;
revoke all on function public.get_sellertray_order_forms_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_order_forms_admin(uuid,uuid)
  to service_role;

-- Keep routine per-merchant issuance outside every trusted happy path.
revoke execute on function public.issue_sellertray_commercial_order_form_admin(uuid,uuid,uuid,uuid,text,uuid,text,uuid)
  from service_role;

-- Reuse SellerTray's established database scheduler pattern when pg_cron is available.
-- The worker is bounded and only scans rows explicitly registered by zero-touch orchestration.
do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    for v_job_id in execute
      'select jobid from cron.job where jobname=$1'
      using 'sellertray-agreement-package-retry'
    loop
      execute 'select cron.unschedule($1)' using v_job_id;
    end loop;
    execute 'select cron.schedule($1,$2,$3)'
      using 'sellertray-agreement-package-retry','* * * * *',
        'select public.process_sellertray_agreement_package_retries(100);';
  end if;
end;
$$;

commit;
