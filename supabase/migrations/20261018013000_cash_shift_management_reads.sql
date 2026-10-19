begin;

-- Restore the immutable cash-correction boundary where older production
-- environments may contain the correction schema without the final trigger/RPC.
create or replace function public.guard_sellertray_cash_movement_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    raise exception 'SellerTray cash history is immutable; use a correction' using errcode='55000';
  end if;
  if current_setting('sellertray.cash_correction',true)='1'
     and new.tenant_id=old.tenant_id
     and new.branch_id=old.branch_id
     and new.register_id=old.register_id
     and new.shift_id=old.shift_id
     and new.movement_type=old.movement_type
     and new.amount=old.amount
     and new.currency=old.currency
     and new.reference=old.reference
     and new.reason=old.reason
     and new.expense_category is not distinct from old.expense_category
     and new.actor_user_id=old.actor_user_id
     and new.created_at=old.created_at
     and new.command_id_hash is not distinct from old.command_id_hash
     and old.superseded_at is null
     and new.superseded_at is not null then
    return new;
  end if;
  raise exception 'SellerTray cash history is immutable; use a correction' using errcode='55000';
end;
$$;
revoke all on function public.guard_sellertray_cash_movement_history() from public,anon,authenticated;
drop trigger if exists guard_sellertray_cash_movement_history on public.sellertray_shift_cash_movements;
create trigger guard_sellertray_cash_movement_history
before update or delete on public.sellertray_shift_cash_movements
for each row execute function public.guard_sellertray_cash_movement_history();

create or replace function public.prevent_sellertray_cash_correction_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'SellerTray cash corrections are immutable' using errcode='55000';
end;
$$;
revoke all on function public.prevent_sellertray_cash_correction_mutation() from public,anon,authenticated;
drop trigger if exists prevent_sellertray_cash_correction_mutation on public.sellertray_shift_cash_movement_corrections;
create trigger prevent_sellertray_cash_correction_mutation
before update or delete on public.sellertray_shift_cash_movement_corrections
for each row execute function public.prevent_sellertray_cash_correction_mutation();

create or replace function public.correct_sellertray_shift_cash_movement(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_movement_id uuid,
  p_correction_kind text,
  p_correction_reason text,
  p_command_id text,
  p_replacement_type text,
  p_replacement_amount numeric,
  p_replacement_reference text,
  p_replacement_reason text,
  p_replacement_expense_category text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shift public.sellertray_cash_shifts%rowtype;
  v_original public.sellertray_shift_cash_movements%rowtype;
  v_existing public.sellertray_shift_cash_movement_corrections%rowtype;
  v_kind text := lower(btrim(coalesce(p_correction_kind,'')));
  v_correction_reason text := nullif(btrim(coalesce(p_correction_reason,'')),'');
  v_command_id text := nullif(btrim(coalesce(p_command_id,'')),'');
  v_type text := lower(btrim(coalesce(p_replacement_type,'')));
  v_reference text := nullif(btrim(coalesce(p_replacement_reference,'')),'');
  v_reason text := nullif(btrim(coalesce(p_replacement_reason,'')),'');
  v_category text := nullif(btrim(coalesce(p_replacement_expense_category,'')),'');
  v_command_hash text;
  v_fingerprint text;
  v_correction_id uuid;
  v_replacement_id uuid;
  v_replacement_command_hash text;
  v_expected numeric(18,2);
begin
  if p_tenant_id is null or p_shift_id is null or p_movement_id is null
     or p_actor_user_id is null or v_correction_reason is null
     or v_kind not in ('remove','replace') or v_command_id is null then
    raise exception 'Shift, cash activity, correction, reason, retry identity and operator are required' using errcode='22023';
  end if;
  if char_length(v_correction_reason)>500
     or char_length(v_command_id)<8 or char_length(v_command_id)>160
     or v_command_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$' then
    raise exception 'Cash correction details are invalid' using errcode='22023';
  end if;
  if v_kind='replace' then
    if v_type not in ('cash_in','cash_out','expense') or p_replacement_amount is null or p_replacement_amount<=0
       or v_reference is null or v_reason is null then
      raise exception 'Replacement type, amount, reference and reason are required' using errcode='22023';
    end if;
    if char_length(v_reference)>160 or char_length(v_reason)>500
       or (v_category is not null and char_length(v_category)>120) then
      raise exception 'Replacement cash details are too long' using errcode='22023';
    end if;
    if v_type='expense' and v_category is null then raise exception 'Expense category is required' using errcode='22023'; end if;
    if v_type<>'expense' then v_category:=null; end if;
  else
    v_type:=null; v_reference:=null; v_reason:=null; v_category:=null;
  end if;

  v_command_hash:=pg_catalog.md5(p_tenant_id::text||'|'||p_shift_id::text||'|'||v_command_id);
  v_fingerprint:=pg_catalog.md5(pg_catalog.concat_ws('|',p_movement_id::text,v_kind,v_correction_reason,coalesce(v_type,''),coalesce(round(p_replacement_amount::numeric,2)::text,''),coalesce(v_reference,''),coalesce(v_reason,''),coalesce(v_category,''),p_actor_user_id::text));

  select * into v_existing from public.sellertray_shift_cash_movement_corrections c
  where c.tenant_id=p_tenant_id and c.command_id_hash=v_command_hash;
  if found then
    if v_existing.original_movement_id<>p_movement_id or v_existing.command_fingerprint<>v_fingerprint then
      raise exception 'Cash correction retry identity is already used for different facts' using errcode='23505';
    end if;
    select t.expected_cash into v_expected from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;
    return jsonb_build_object('correctionId',v_existing.id,'movementId',p_movement_id,'replacementMovementId',v_existing.replacement_movement_id,'correctionKind',v_existing.correction_kind,'expectedCash',v_expected,'idempotentReplay',true);
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  select * into v_shift from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id for update;
  if not found then raise exception 'Cashier shift not found' using errcode='22023'; end if;
  if v_shift.status<>'open' then raise exception 'Closed cashier shifts cannot be changed; use shift review for historical issues' using errcode='23514'; end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_shift.branch_id,p_actor_user_id)
     or not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_correct_cash_movement') then
    raise exception 'You do not have permission to correct cash activity in this Branch' using errcode='42501';
  end if;

  select * into v_original from public.sellertray_shift_cash_movements m
  where m.tenant_id=p_tenant_id and m.shift_id=p_shift_id and m.id=p_movement_id for update;
  if not found then raise exception 'Cash activity not found' using errcode='22023'; end if;
  if v_original.superseded_at is not null then raise exception 'This cash activity has already been corrected' using errcode='23514'; end if;

  perform set_config('sellertray.cash_correction','1',true);
  update public.sellertray_shift_cash_movements set superseded_at=now()
  where tenant_id=p_tenant_id and id=p_movement_id;

  if v_kind='replace' then
    select t.expected_cash into v_expected from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;
    if v_type in ('cash_out','expense') and round(p_replacement_amount::numeric,2)>v_expected then
      raise exception 'Replacement cash activity cannot take expected drawer cash below zero' using errcode='23514';
    end if;
    v_replacement_command_hash:=pg_catalog.md5(p_tenant_id::text||'|cash-correction|'||v_command_hash);
    insert into public.sellertray_shift_cash_movements(tenant_id,branch_id,register_id,shift_id,movement_type,amount,currency,reference,reason,expense_category,actor_user_id,command_id_hash)
    values(p_tenant_id,v_shift.branch_id,v_shift.register_id,p_shift_id,v_type,round(p_replacement_amount::numeric,2),v_shift.currency,v_reference,v_reason,v_category,p_actor_user_id,v_replacement_command_hash)
    returning id into v_replacement_id;
  end if;

  insert into public.sellertray_shift_cash_movement_corrections(tenant_id,branch_id,register_id,shift_id,original_movement_id,replacement_movement_id,correction_kind,reason,actor_user_id,command_id_hash,command_fingerprint)
  values(p_tenant_id,v_shift.branch_id,v_shift.register_id,p_shift_id,p_movement_id,v_replacement_id,v_kind,v_correction_reason,p_actor_user_id,v_command_hash,v_fingerprint)
  returning id into v_correction_id;
  update public.sellertray_shift_cash_movements set superseded_by_correction_id=v_correction_id
  where tenant_id=p_tenant_id and id=p_movement_id;
  select t.expected_cash into v_expected from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;
  return jsonb_build_object('correctionId',v_correction_id,'movementId',p_movement_id,'replacementMovementId',v_replacement_id,'correctionKind',v_kind,'expectedCash',v_expected,'idempotentReplay',false);
end;
$$;
revoke all on function public.correct_sellertray_shift_cash_movement(uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.correct_sellertray_shift_cash_movement(uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,uuid) to service_role;

create or replace function public.get_sellertray_cash_shift_management_list(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_cashier_id uuid default null,
  p_status text default 'all',
  p_variance_state text default 'all',
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_role text;
  v_status text:=lower(btrim(coalesce(p_status,'all')));
  v_variance text:=lower(btrim(coalesce(p_variance_state,'all')));
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_offset integer:=greatest(coalesce(p_offset,0),0);
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then
    raise exception 'Merchant Web cash management is available to Owners and Managers' using errcode='42501';
  end if;
  if v_status not in ('all','open','closed','reviewed') then raise exception 'Unsupported cashier shift status' using errcode='22023'; end if;
  if v_variance not in ('all','balanced','variance','pending_review') then raise exception 'Unsupported cashier variance view' using errcode='22023'; end if;
  if p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then raise exception 'Cashier shift date range is invalid' using errcode='22023'; end if;
  if p_branch_id is not null then
    if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then raise exception 'Branch not found' using errcode='P0002'; end if;
    if not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then raise exception 'You do not have access to cashier shifts in this Branch' using errcode='42501'; end if;
  end if;
  if p_cashier_id is not null and not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=p_cashier_id) then raise exception 'Cashier not found' using errcode='P0002'; end if;
  select coalesce(nullif(t.timezone,''),'Africa/Lagos') into v_timezone from public.tenants t where t.id=p_tenant_id;
  if v_timezone is null then raise exception 'Business not found' using errcode='P0002'; end if;
  if p_date_from is not null then v_start_at:=p_date_from::timestamp at time zone v_timezone; end if;
  if p_date_to is not null then v_end_at:=(p_date_to+1)::timestamp at time zone v_timezone; end if;

  with scoped as materialized (
    select s.id as shift_id,s.branch_id,b.name as branch_name,s.register_id,r.name as register_name,s.status,s.currency,
      s.opening_cash,t.cash_sales,t.cash_refunds,t.cash_in,t.cash_out,t.expenses,
      case when s.status='open' then t.expected_cash else s.expected_cash end as expected_cash,
      s.declared_cash,s.variance,s.review_decision,s.opened_by_user_id,
      left(coalesce(nullif(btrim(regexp_replace(coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',u.email,'Cashier'),'\s+',' ','g')),''),'Cashier'),120) as cashier_name,
      s.opened_at,s.closed_at,s.reviewed_at
    from public.sellertray_cash_shifts s
    join public.branches b on b.tenant_id=s.tenant_id and b.id=s.branch_id
    join public.sellertray_registers r on r.tenant_id=s.tenant_id and r.id=s.register_id
    left join auth.users u on u.id=s.opened_by_user_id
    cross join lateral public.sellertray_cash_shift_totals(s.tenant_id,s.id) t
    where s.tenant_id=p_tenant_id
      and public.sellertray_user_can_read_branch(p_tenant_id,s.branch_id,v_user_id)
      and (p_branch_id is null or s.branch_id=p_branch_id)
      and (p_cashier_id is null or s.opened_by_user_id=p_cashier_id)
      and (v_status='all' or s.status=v_status)
      and (v_start_at is null or s.opened_at>=v_start_at)
      and (v_end_at is null or s.opened_at<v_end_at)
      and (v_variance='all'
        or (v_variance='balanced' and s.status in ('closed','reviewed') and abs(coalesce(s.variance,0))<0.01)
        or (v_variance='variance' and s.status in ('closed','reviewed') and abs(coalesce(s.variance,0))>=0.01)
        or (v_variance='pending_review' and s.status='closed'))
  ), paged as (
    select * from scoped order by opened_at desc,shift_id desc limit v_limit offset v_offset
  ), cashiers as (
    select distinct s.opened_by_user_id,
      left(coalesce(nullif(btrim(regexp_replace(coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',u.email,'Cashier'),'\s+',' ','g')),''),'Cashier'),120) as cashier_name
    from public.sellertray_cash_shifts s left join auth.users u on u.id=s.opened_by_user_id
    where s.tenant_id=p_tenant_id and public.sellertray_user_can_read_branch(p_tenant_id,s.branch_id,v_user_id)
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'shiftId',x.shift_id,'branchId',x.branch_id,'branchName',x.branch_name,'registerId',x.register_id,'registerName',x.register_name,
      'status',x.status,'currency',x.currency,'cashierUserId',x.opened_by_user_id,'cashierName',x.cashier_name,
      'openingCash',x.opening_cash,'cashSales',x.cash_sales,'cashRefunds',x.cash_refunds,'cashIn',x.cash_in,'cashOut',x.cash_out,'expenses',x.expenses,
      'expectedCash',x.expected_cash,'declaredCash',x.declared_cash,'variance',x.variance,'reviewDecision',x.review_decision,
      'openedAt',x.opened_at,'closedAt',x.closed_at,'reviewedAt',x.reviewed_at
    ) order by x.opened_at desc,x.shift_id desc) from paged x),'[]'::jsonb),
    'totalCount',(select count(*) from scoped),
    'openCount',(select count(*) from scoped where status='open'),
    'pendingReviewCount',(select count(*) from scoped where status='closed'),
    'varianceCount',(select count(*) from scoped where status in ('closed','reviewed') and abs(coalesce(variance,0))>=0.01),
    'expectedCash',coalesce((select sum(expected_cash) from scoped),0),
    'declaredCash',coalesce((select sum(declared_cash) from scoped),0),
    'varianceAmount',coalesce((select sum(variance) from scoped),0),
    'currency',(select case when count(distinct currency)=1 then min(currency) else null end from scoped),
    'cashiers',coalesce((select jsonb_agg(jsonb_build_object('userId',c.opened_by_user_id,'name',c.cashier_name) order by c.cashier_name,c.opened_by_user_id) from cashiers c),'[]'::jsonb),
    'limit',v_limit,'offset',v_offset
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_sellertray_cash_shift_management_detail(p_tenant_id uuid,p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_role text;
  v_shift public.sellertray_cash_shifts%rowtype;
  v_totals record;
  v_branch_name text;
  v_register_name text;
  v_cashier_name text;
  v_movements jsonb;
  v_corrections jsonb;
  v_payment_summary jsonb;
  v_can_correct boolean:=false;
  v_can_review boolean:=false;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') or not public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_view_reports') then raise exception 'Merchant Web cash management is available to Owners and Managers' using errcode='42501'; end if;
  select * into v_shift from public.sellertray_cash_shifts s where s.tenant_id=p_tenant_id and s.id=p_shift_id;
  if not found then raise exception 'Cashier shift not found' using errcode='P0002'; end if;
  if not public.sellertray_user_can_read_branch(p_tenant_id,v_shift.branch_id,v_user_id) then raise exception 'You do not have access to this cashier shift' using errcode='42501'; end if;
  select b.name,r.name into v_branch_name,v_register_name from public.branches b join public.sellertray_registers r on r.tenant_id=b.tenant_id and r.branch_id=b.id where b.tenant_id=p_tenant_id and b.id=v_shift.branch_id and r.id=v_shift.register_id;
  select left(coalesce(nullif(btrim(regexp_replace(coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',u.email,'Cashier'),'\s+',' ','g')),''),'Cashier'),120) into v_cashier_name from auth.users u where u.id=v_shift.opened_by_user_id;
  v_cashier_name:=coalesce(v_cashier_name,'Cashier');
  select * into v_totals from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'movementId',m.id,'movementType',m.movement_type,'amount',m.amount,'currency',m.currency,'reference',m.reference,'reason',m.reason,'expenseCategory',m.expense_category,
    'actorUserId',m.actor_user_id,'actorName',left(coalesce(nullif(btrim(regexp_replace(coalesce(au.raw_user_meta_data->>'full_name',au.raw_user_meta_data->>'name',au.email,'Team member'),'\s+',' ','g')),''),'Team member'),120),
    'createdAt',m.created_at,'replacementForCorrectionId',rc.id,'correctionReason',rc.reason
  ) order by m.created_at desc,m.id desc),'[]'::jsonb) into v_movements
  from public.sellertray_shift_cash_movements m left join auth.users au on au.id=m.actor_user_id
  left join public.sellertray_shift_cash_movement_corrections rc on rc.tenant_id=m.tenant_id and rc.replacement_movement_id=m.id
  where m.tenant_id=p_tenant_id and m.shift_id=p_shift_id and m.superseded_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'correctionId',c.id,'correctionKind',c.correction_kind,'reason',c.reason,'actorUserId',c.actor_user_id,
    'actorName',left(coalesce(nullif(btrim(regexp_replace(coalesce(au.raw_user_meta_data->>'full_name',au.raw_user_meta_data->>'name',au.email,'Team member'),'\s+',' ','g')),''),'Team member'),120),
    'originalMovementId',c.original_movement_id,'replacementMovementId',c.replacement_movement_id,'createdAt',c.created_at
  ) order by c.created_at desc,c.id desc),'[]'::jsonb) into v_corrections
  from public.sellertray_shift_cash_movement_corrections c left join auth.users au on au.id=c.actor_user_id
  where c.tenant_id=p_tenant_id and c.shift_id=p_shift_id;
  v_payment_summary:=public.get_sellertray_shift_payment_summary(p_tenant_id,p_shift_id);
  v_can_correct:=v_shift.status='open' and public.orderdesk_subscription_can_write(p_tenant_id) and public.sellertray_user_can_operate_branch(p_tenant_id,v_shift.branch_id,v_user_id) and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_correct_cash_movement');
  v_can_review:=v_shift.status='closed' and public.orderdesk_subscription_can_write(p_tenant_id) and public.sellertray_user_can_operate_branch(p_tenant_id,v_shift.branch_id,v_user_id) and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_review_shift');
  return jsonb_build_object(
    'shiftId',v_shift.id,'branchId',v_shift.branch_id,'branchName',v_branch_name,'registerId',v_shift.register_id,'registerName',v_register_name,
    'status',v_shift.status,'currency',v_shift.currency,'cashierUserId',v_shift.opened_by_user_id,'cashierName',v_cashier_name,
    'openingCash',v_totals.opening_cash,'cashSales',v_totals.cash_sales,'cashRefunds',v_totals.cash_refunds,'cashIn',v_totals.cash_in,'cashOut',v_totals.cash_out,'expenses',v_totals.expenses,
    'expectedCash',case when v_shift.status='open' then v_totals.expected_cash else v_shift.expected_cash end,'declaredCash',v_shift.declared_cash,'variance',v_shift.variance,
    'closeNote',v_shift.close_note,'reviewDecision',v_shift.review_decision,'reviewNote',v_shift.review_note,'openedAt',v_shift.opened_at,'closedAt',v_shift.closed_at,'reviewedAt',v_shift.reviewed_at,
    'movements',v_movements,'corrections',v_corrections,'paymentSummary',v_payment_summary,'canCorrect',v_can_correct,'canReview',v_can_review
  );
end;
$$;

revoke all on function public.get_sellertray_cash_shift_management_list(uuid,uuid,uuid,text,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_sellertray_cash_shift_management_list(uuid,uuid,uuid,text,text,date,date,integer,integer) to authenticated,service_role;
revoke all on function public.get_sellertray_cash_shift_management_detail(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_cash_shift_management_detail(uuid,uuid) to authenticated,service_role;

commit;
