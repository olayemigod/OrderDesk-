begin;

alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
      'can_open_shift','can_record_cash_movement','can_record_expense','can_correct_cash_movement','can_close_shift','can_review_shift',
      'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
      'can_manage_payments','can_view_reports','can_refund_sale'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
      'can_open_shift','can_record_cash_movement','can_record_expense','can_correct_cash_movement','can_close_shift','can_review_shift',
      'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
      'can_manage_payments','can_view_reports','can_refund_sale'
    ));

create or replace function public.sellertray_user_has_capability(
  p_tenant_id uuid,
  p_user_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_override boolean;
begin
  if p_tenant_id is null or p_user_id is null
     or p_capability not in (
       'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
       'can_open_shift','can_record_cash_movement','can_record_expense','can_correct_cash_movement','can_close_shift','can_review_shift',
       'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
       'can_manage_payments','can_view_reports','can_refund_sale'
     ) then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_user_id;

  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;

  select c.allowed into v_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id and c.user_id=p_user_id and c.capability=p_capability;
  if found then return v_override; end if;

  if v_role='manager' then return true; end if;
  if v_role='staff' then
    return p_capability in (
      'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_print_receipt'
    );
  end if;
  return false;
end;
$$;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text) to service_role;

create or replace function public.set_sellertray_member_capability(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_capability text,
  p_allowed boolean,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_capability text := lower(btrim(coalesce(p_capability,'')));
  v_previous_override boolean;
  v_previous_effective boolean;
  v_changed boolean := false;
begin
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required' using errcode='22023';
  end if;
  if v_capability not in (
    'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
    'can_open_shift','can_record_cash_movement','can_record_expense','can_correct_cash_movement','can_close_shift','can_review_shift',
    'can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products','can_manage_purchasing',
    'can_manage_payments','can_view_reports','can_refund_sale'
  ) then
    raise exception 'Unknown SellerTray permission' using errcode='22023';
  end if;

  select tm.role into v_actor_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  select tm.role into v_target_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions' using errcode='42501';
  end if;
  if v_target_role is null then raise exception 'Staff member does not belong to this business' using errcode='23503'; end if;
  if v_target_role='owner' then raise exception 'Owner authority cannot be changed here' using errcode='42501'; end if;
  if v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change permissions for Staff only' using errcode='42501';
  end if;

  v_previous_effective := public.sellertray_user_has_capability(p_tenant_id,p_target_user_id,v_capability);
  select c.allowed into v_previous_override from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id and c.user_id=p_target_user_id and c.capability=v_capability;
  if not found or v_previous_override is distinct from p_allowed then v_changed := true; end if;

  insert into public.tenant_member_capabilities(tenant_id,user_id,capability,allowed,granted_by,created_at,updated_at)
  values(p_tenant_id,p_target_user_id,v_capability,p_allowed,p_actor_user_id,now(),now())
  on conflict(tenant_id,user_id,capability) do update
    set allowed=excluded.allowed,granted_by=excluded.granted_by,updated_at=now();

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
    ) values(p_tenant_id,p_target_user_id,v_capability,v_previous_effective,p_allowed,p_actor_user_id);
  end if;
  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid) to service_role;

alter table public.sellertray_shift_cash_movements
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_correction_id uuid;

drop index if exists public.sellertray_shift_cash_movements_reference_unique;
create unique index sellertray_shift_cash_movements_effective_reference_unique
  on public.sellertray_shift_cash_movements(
    tenant_id,shift_id,movement_type,lower(btrim(reference))
  ) where superseded_at is null;

create table public.sellertray_shift_cash_movement_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  original_movement_id uuid not null,
  replacement_movement_id uuid,
  correction_kind text not null check (correction_kind in ('remove','replace')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  actor_user_id uuid not null,
  command_id_hash text not null check (command_id_hash ~ '^[0-9a-f]{32}$'),
  command_fingerprint text not null check (command_fingerprint ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,original_movement_id),
  unique (tenant_id,command_id_hash),
  constraint sellertray_cash_correction_shift_same_branch
    foreign key (tenant_id,branch_id,register_id,shift_id)
    references public.sellertray_cash_shifts(tenant_id,branch_id,register_id,id)
    on delete restrict,
  constraint sellertray_cash_correction_original_same_tenant
    foreign key (tenant_id,original_movement_id)
    references public.sellertray_shift_cash_movements(tenant_id,id)
    on delete restrict,
  constraint sellertray_cash_correction_replacement_same_tenant
    foreign key (tenant_id,replacement_movement_id)
    references public.sellertray_shift_cash_movements(tenant_id,id)
    on delete restrict,
  constraint sellertray_cash_correction_replacement_state check (
    (correction_kind='remove' and replacement_movement_id is null)
    or (correction_kind='replace' and replacement_movement_id is not null)
  )
);

alter table public.sellertray_shift_cash_movements
  add constraint sellertray_shift_cash_movements_superseded_correction_same_tenant
  foreign key (tenant_id,superseded_by_correction_id)
  references public.sellertray_shift_cash_movement_corrections(tenant_id,id)
  on delete restrict;

create index sellertray_cash_corrections_shift_created_idx
  on public.sellertray_shift_cash_movement_corrections(tenant_id,shift_id,created_at desc);

alter table public.sellertray_shift_cash_movement_corrections enable row level security;
revoke all on public.sellertray_shift_cash_movement_corrections from public,anon,authenticated;
grant all on public.sellertray_shift_cash_movement_corrections to service_role;

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
create trigger prevent_sellertray_cash_correction_mutation
before update or delete on public.sellertray_shift_cash_movement_corrections
for each row execute function public.prevent_sellertray_cash_correction_mutation();

create or replace function public.sellertray_cash_shift_totals(
  p_tenant_id uuid,
  p_shift_id uuid
)
returns table(
  opening_cash numeric,
  cash_sales numeric,
  cash_refunds numeric,
  cash_in numeric,
  cash_out numeric,
  expenses numeric,
  expected_cash numeric
)
language sql
stable
security definer
set search_path=''
as $$
  select
    s.opening_cash,
    coalesce((select sum(x.amount) from public.sellertray_shift_cash_sales x where x.tenant_id=s.tenant_id and x.shift_id=s.id),0)::numeric(18,2),
    coalesce((select sum(x.amount) from public.sellertray_shift_cash_refunds x where x.tenant_id=s.tenant_id and x.shift_id=s.id),0)::numeric(18,2),
    coalesce((select sum(x.amount) from public.sellertray_shift_cash_movements x where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='cash_in' and x.superseded_at is null),0)::numeric(18,2),
    coalesce((select sum(x.amount) from public.sellertray_shift_cash_movements x where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='cash_out' and x.superseded_at is null),0)::numeric(18,2),
    coalesce((select sum(x.amount) from public.sellertray_shift_cash_movements x where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='expense' and x.superseded_at is null),0)::numeric(18,2),
    (
      s.opening_cash
      + coalesce((select sum(x.amount) from public.sellertray_shift_cash_sales x where x.tenant_id=s.tenant_id and x.shift_id=s.id),0)
      - coalesce((select sum(x.amount) from public.sellertray_shift_cash_refunds x where x.tenant_id=s.tenant_id and x.shift_id=s.id),0)
      + coalesce((select sum(x.amount) from public.sellertray_shift_cash_movements x where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='cash_in' and x.superseded_at is null),0)
      - coalesce((select sum(x.amount) from public.sellertray_shift_cash_movements x where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='cash_out' and x.superseded_at is null),0)
      - coalesce((select sum(x.amount) from public.sellertray_shift_cash_movements x where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='expense' and x.superseded_at is null),0)
    )::numeric(18,2)
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id;
$$;

revoke all on function public.sellertray_cash_shift_totals(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellertray_cash_shift_totals(uuid,uuid) to service_role;

create or replace function public.get_sellertray_cash_correction_authority(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  return p_tenant_id is not null and p_branch_id is not null
    and public.orderdesk_subscription_can_write(p_tenant_id)
    and public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id)
    and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_correct_cash_movement');
end;
$$;

revoke all on function public.get_sellertray_cash_correction_authority(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_cash_correction_authority(uuid,uuid) to authenticated;

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
    if v_type='expense' and v_category is null then
      raise exception 'Expense category is required' using errcode='22023';
    end if;
    if v_type<>'expense' then v_category := null; end if;
  else
    v_type := null; v_reference := null; v_reason := null; v_category := null;
  end if;

  v_command_hash := pg_catalog.md5(p_tenant_id::text||'|'||p_shift_id::text||'|'||v_command_id);
  v_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',
    p_movement_id::text,v_kind,v_correction_reason,coalesce(v_type,''),
    coalesce(round(p_replacement_amount::numeric,2)::text,''),coalesce(v_reference,''),
    coalesce(v_reason,''),coalesce(v_category,''),p_actor_user_id::text
  ));

  select * into v_existing
  from public.sellertray_shift_cash_movement_corrections c
  where c.tenant_id=p_tenant_id and c.command_id_hash=v_command_hash;
  if found then
    if v_existing.original_movement_id<>p_movement_id or v_existing.command_fingerprint<>v_fingerprint then
      raise exception 'Cash correction retry identity is already used for different facts' using errcode='23505';
    end if;
    select t.expected_cash into v_expected from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;
    return jsonb_build_object(
      'correctionId',v_existing.id,'movementId',p_movement_id,
      'replacementMovementId',v_existing.replacement_movement_id,
      'correctionKind',v_existing.correction_kind,'expectedCash',v_expected,'idempotentReplay',true
    );
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id
  for update;
  if not found then raise exception 'Cashier shift not found' using errcode='22023'; end if;
  if v_shift.status<>'open' then
    raise exception 'Closed cashier shifts cannot be changed; use shift review for historical issues' using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_shift.branch_id,p_actor_user_id)
     or not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_correct_cash_movement') then
    raise exception 'You do not have permission to correct cash activity in this Branch' using errcode='42501';
  end if;

  select * into v_original
  from public.sellertray_shift_cash_movements m
  where m.tenant_id=p_tenant_id and m.shift_id=p_shift_id and m.id=p_movement_id
  for update;
  if not found then raise exception 'Cash activity not found' using errcode='22023'; end if;
  if v_original.superseded_at is not null then
    raise exception 'This cash activity has already been corrected' using errcode='23514';
  end if;

  perform set_config('sellertray.cash_correction','1',true);
  update public.sellertray_shift_cash_movements
  set superseded_at=now()
  where tenant_id=p_tenant_id and id=p_movement_id;

  if v_kind='replace' then
    select t.expected_cash into v_expected
    from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;
    if v_type in ('cash_out','expense') and round(p_replacement_amount::numeric,2)>v_expected then
      raise exception 'Replacement cash activity cannot take expected drawer cash below zero' using errcode='23514';
    end if;

    v_replacement_command_hash := pg_catalog.md5(p_tenant_id::text||'|cash-correction|'||v_command_hash);
    insert into public.sellertray_shift_cash_movements(
      tenant_id,branch_id,register_id,shift_id,movement_type,amount,currency,
      reference,reason,expense_category,actor_user_id,command_id_hash
    ) values(
      p_tenant_id,v_shift.branch_id,v_shift.register_id,p_shift_id,v_type,
      round(p_replacement_amount::numeric,2),v_shift.currency,v_reference,v_reason,v_category,
      p_actor_user_id,v_replacement_command_hash
    ) returning id into v_replacement_id;
  end if;

  insert into public.sellertray_shift_cash_movement_corrections(
    tenant_id,branch_id,register_id,shift_id,original_movement_id,replacement_movement_id,
    correction_kind,reason,actor_user_id,command_id_hash,command_fingerprint
  ) values(
    p_tenant_id,v_shift.branch_id,v_shift.register_id,p_shift_id,p_movement_id,v_replacement_id,
    v_kind,v_correction_reason,p_actor_user_id,v_command_hash,v_fingerprint
  ) returning id into v_correction_id;

  update public.sellertray_shift_cash_movements
  set superseded_by_correction_id=v_correction_id
  where tenant_id=p_tenant_id and id=p_movement_id;

  select t.expected_cash into v_expected
  from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;

  return jsonb_build_object(
    'correctionId',v_correction_id,'movementId',p_movement_id,
    'replacementMovementId',v_replacement_id,'correctionKind',v_kind,
    'expectedCash',v_expected,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.correct_sellertray_shift_cash_movement(
  uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.correct_sellertray_shift_cash_movement(
  uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,uuid
) to service_role;

commit;
