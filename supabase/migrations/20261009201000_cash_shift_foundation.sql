begin;

alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock',
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_review_shift'
    ));

alter table public.tenant_member_capability_events
  drop constraint if exists tenant_member_capability_events_capability_check,
  add constraint tenant_member_capability_events_capability_check
    check (capability in (
      'can_receive_stock',
      'can_adjust_stock',
      'can_count_stock',
      'can_apply_stock_count',
      'can_transfer_stock',
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift',
      'can_review_shift'
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
       'can_receive_stock',
       'can_adjust_stock',
       'can_count_stock',
       'can_apply_stock_count',
       'can_transfer_stock',
       'can_open_shift',
       'can_record_cash_movement',
       'can_record_expense',
       'can_close_shift',
       'can_review_shift'
     ) then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_user_id;

  if v_role is null then
    return false;
  end if;

  if v_role='owner' then
    return true;
  end if;

  select c.allowed into v_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_user_id
    and c.capability=p_capability;

  if found then
    return v_override;
  end if;

  if v_role='manager' then
    return true;
  end if;

  if v_role='staff' then
    return p_capability in (
      'can_open_shift',
      'can_record_cash_movement',
      'can_record_expense',
      'can_close_shift'
    );
  end if;

  return false;
end;
$$;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text)
  to service_role;

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
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null
     or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required'
      using errcode='22023';
  end if;

  if v_capability not in (
    'can_receive_stock',
    'can_adjust_stock',
    'can_count_stock',
    'can_apply_stock_count',
    'can_transfer_stock',
    'can_open_shift',
    'can_record_cash_movement',
    'can_record_expense',
    'can_close_shift',
    'can_review_shift'
  ) then
    raise exception 'Unknown SellerTray permission' using errcode='22023';
  end if;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  select tm.role into v_target_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions'
      using errcode='42501';
  end if;
  if v_target_role is null then
    raise exception 'Staff member does not belong to this business' using errcode='23503';
  end if;
  if v_target_role='owner' then
    raise exception 'Owner authority cannot be changed here' using errcode='42501';
  end if;
  if v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change permissions for Staff only'
      using errcode='42501';
  end if;

  v_previous_effective := public.sellertray_user_has_capability(
    p_tenant_id,p_target_user_id,v_capability
  );

  select c.allowed into v_previous_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_target_user_id
    and c.capability=v_capability;

  if not found or v_previous_override is distinct from p_allowed then
    v_changed := true;
  end if;

  insert into public.tenant_member_capabilities(
    tenant_id,user_id,capability,allowed,granted_by,created_at,updated_at
  ) values(
    p_tenant_id,p_target_user_id,v_capability,p_allowed,p_actor_user_id,now(),now()
  )
  on conflict(tenant_id,user_id,capability) do update
    set allowed=excluded.allowed,
        granted_by=excluded.granted_by,
        updated_at=now();

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
    ) values(
      p_tenant_id,p_target_user_id,v_capability,
      v_previous_effective,p_allowed,p_actor_user_id
    );
  end if;

  return p_allowed;
end;
$$;

revoke all on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_member_capability(uuid,uuid,text,boolean,uuid)
  to service_role;

create table public.sellertray_registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  code text not null check (char_length(btrim(code)) between 1 and 40),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,branch_id,id),
  constraint sellertray_registers_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade
);

create unique index sellertray_registers_branch_code_unique
  on public.sellertray_registers(tenant_id,branch_id,lower(btrim(code)));
create unique index sellertray_registers_one_default_per_branch
  on public.sellertray_registers(tenant_id,branch_id)
  where is_default;

insert into public.sellertray_registers(tenant_id,branch_id,code,name,is_default,is_active)
select b.tenant_id,b.id,'MAIN','Main Register',true,true
from public.branches b
where not exists (
  select 1 from public.sellertray_registers r
  where r.tenant_id=b.tenant_id and r.branch_id=b.id
);

create or replace function public.ensure_sellertray_default_register()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.sellertray_registers(
    tenant_id,branch_id,code,name,is_default,is_active
  ) values(new.tenant_id,new.id,'MAIN','Main Register',true,true)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_sellertray_default_register()
  from public,anon,authenticated;

drop trigger if exists ensure_sellertray_default_register on public.branches;
create trigger ensure_sellertray_default_register
after insert on public.branches
for each row execute function public.ensure_sellertray_default_register();

alter table public.sellertray_registers enable row level security;
revoke all on public.sellertray_registers from public,anon,authenticated;
grant all on public.sellertray_registers to service_role;

create table public.sellertray_cash_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  status text not null default 'open'
    check (status in ('open','closed','reviewed')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opening_cash numeric(18,2) not null check (opening_cash>=0),
  opened_by_user_id uuid not null,
  opened_at timestamptz not null default now(),
  expected_cash numeric(18,2),
  declared_cash numeric(18,2),
  variance numeric(18,2),
  close_note text,
  closed_by_user_id uuid,
  closed_at timestamptz,
  review_decision text check (review_decision is null or review_decision in ('accepted','follow_up')),
  review_note text,
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,branch_id,register_id,id),
  constraint sellertray_cash_shifts_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint sellertray_cash_shifts_register_same_branch
    foreign key (tenant_id,branch_id,register_id)
    references public.sellertray_registers(tenant_id,branch_id,id)
    on delete cascade,
  constraint sellertray_cash_shifts_state_check check (
    (status='open'
      and expected_cash is null and declared_cash is null and variance is null
      and closed_by_user_id is null and closed_at is null
      and review_decision is null and review_note is null
      and reviewed_by_user_id is null and reviewed_at is null)
    or
    (status='closed'
      and expected_cash is not null and expected_cash>=0
      and declared_cash is not null and declared_cash>=0
      and variance is not null
      and closed_by_user_id is not null and closed_at is not null
      and review_decision is null and review_note is null
      and reviewed_by_user_id is null and reviewed_at is null)
    or
    (status='reviewed'
      and expected_cash is not null and expected_cash>=0
      and declared_cash is not null and declared_cash>=0
      and variance is not null
      and closed_by_user_id is not null and closed_at is not null
      and review_decision is not null
      and reviewed_by_user_id is not null and reviewed_at is not null)
  )
);

create unique index sellertray_cash_shifts_one_open_register
  on public.sellertray_cash_shifts(tenant_id,register_id)
  where status='open';
create unique index sellertray_cash_shifts_one_open_user
  on public.sellertray_cash_shifts(tenant_id,opened_by_user_id)
  where status='open';
create index sellertray_cash_shifts_branch_opened_idx
  on public.sellertray_cash_shifts(tenant_id,branch_id,opened_at desc);

create table public.sellertray_shift_cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  movement_type text not null check (movement_type in ('cash_in','cash_out','expense')),
  amount numeric(18,2) not null check (amount>0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reference text not null check (char_length(btrim(reference)) between 1 and 160),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  expense_category text,
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint sellertray_shift_cash_movements_shift_same_branch
    foreign key (tenant_id,branch_id,register_id,shift_id)
    references public.sellertray_cash_shifts(tenant_id,branch_id,register_id,id)
    on delete cascade,
  constraint sellertray_shift_cash_movements_expense_category_check check (
    (movement_type='expense'
      and char_length(btrim(coalesce(expense_category,''))) between 1 and 120)
    or (movement_type<>'expense' and expense_category is null)
  )
);

create unique index sellertray_shift_cash_movements_reference_unique
  on public.sellertray_shift_cash_movements(
    tenant_id,shift_id,movement_type,lower(btrim(reference))
  );
create index sellertray_shift_cash_movements_shift_created_idx
  on public.sellertray_shift_cash_movements(tenant_id,shift_id,created_at desc);

create table public.sellertray_shift_cash_sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  order_id uuid not null,
  payment_id uuid not null,
  amount numeric(18,2) not null check (amount>0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  actor_user_id uuid not null,
  business_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,payment_id),
  constraint sellertray_shift_cash_sales_shift_same_branch
    foreign key (tenant_id,branch_id,register_id,shift_id)
    references public.sellertray_cash_shifts(tenant_id,branch_id,register_id,id)
    on delete cascade,
  constraint sellertray_shift_cash_sales_payment_same_order
    foreign key (tenant_id,order_id,payment_id)
    references public.order_payments(tenant_id,order_id,id)
    on delete restrict
);

create index sellertray_shift_cash_sales_shift_business_idx
  on public.sellertray_shift_cash_sales(tenant_id,shift_id,business_at desc);

create table public.sellertray_shift_cash_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  refund_id uuid not null,
  amount numeric(18,2) not null check (amount>0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  actor_user_id uuid not null,
  business_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,refund_id),
  constraint sellertray_shift_cash_refunds_shift_same_branch
    foreign key (tenant_id,branch_id,register_id,shift_id)
    references public.sellertray_cash_shifts(tenant_id,branch_id,register_id,id)
    on delete cascade,
  constraint sellertray_shift_cash_refunds_refund_same_tenant
    foreign key (tenant_id,refund_id)
    references public.payment_refunds(tenant_id,id)
    on delete restrict
);

create index sellertray_shift_cash_refunds_shift_business_idx
  on public.sellertray_shift_cash_refunds(tenant_id,shift_id,business_at desc);

alter table public.sellertray_cash_shifts enable row level security;
alter table public.sellertray_shift_cash_movements enable row level security;
alter table public.sellertray_shift_cash_sales enable row level security;
alter table public.sellertray_shift_cash_refunds enable row level security;
revoke all on public.sellertray_cash_shifts from public,anon,authenticated;
revoke all on public.sellertray_shift_cash_movements from public,anon,authenticated;
revoke all on public.sellertray_shift_cash_sales from public,anon,authenticated;
revoke all on public.sellertray_shift_cash_refunds from public,anon,authenticated;
grant all on public.sellertray_cash_shifts to service_role;
grant all on public.sellertray_shift_cash_movements to service_role;
grant all on public.sellertray_shift_cash_sales to service_role;
grant all on public.sellertray_shift_cash_refunds to service_role;

create or replace function public.get_sellertray_cash_capabilities(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
  can_open_shift boolean,
  can_record_cash_movement boolean,
  can_record_expense boolean,
  can_close_shift boolean,
  can_review_shift boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_branch_allowed boolean;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  v_branch_allowed := public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,v_user_id
  );

  return query select
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_open_shift'),
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_record_cash_movement'),
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_record_expense'),
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_close_shift'),
    v_branch_allowed and public.sellertray_user_has_capability(p_tenant_id,v_user_id,'can_review_shift');
end;
$$;

revoke all on function public.get_sellertray_cash_capabilities(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_cash_capabilities(uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_accessible_registers(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
  id uuid,
  code text,
  name text,
  is_default boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,p_branch_id,v_user_id
  ) then
    raise exception 'You do not have access to registers in this branch' using errcode='42501';
  end if;

  return query
  select r.id,r.code,r.name,r.is_default
  from public.sellertray_registers r
  where r.tenant_id=p_tenant_id
    and r.branch_id=p_branch_id
    and r.is_active=true
  order by r.is_default desc,r.name,r.id;
end;
$$;

revoke all on function public.get_sellertray_accessible_registers(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_accessible_registers(uuid,uuid)
  to authenticated;

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
    coalesce((
      select sum(x.amount) from public.sellertray_shift_cash_sales x
      where x.tenant_id=s.tenant_id and x.shift_id=s.id
    ),0)::numeric(18,2) as cash_sales,
    coalesce((
      select sum(x.amount) from public.sellertray_shift_cash_refunds x
      where x.tenant_id=s.tenant_id and x.shift_id=s.id
    ),0)::numeric(18,2) as cash_refunds,
    coalesce((
      select sum(x.amount) from public.sellertray_shift_cash_movements x
      where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='cash_in'
    ),0)::numeric(18,2) as cash_in,
    coalesce((
      select sum(x.amount) from public.sellertray_shift_cash_movements x
      where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='cash_out'
    ),0)::numeric(18,2) as cash_out,
    coalesce((
      select sum(x.amount) from public.sellertray_shift_cash_movements x
      where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='expense'
    ),0)::numeric(18,2) as expenses,
    (
      s.opening_cash
      + coalesce((select sum(x.amount) from public.sellertray_shift_cash_sales x where x.tenant_id=s.tenant_id and x.shift_id=s.id),0)
      - coalesce((select sum(x.amount) from public.sellertray_shift_cash_refunds x where x.tenant_id=s.tenant_id and x.shift_id=s.id),0)
      + coalesce((select sum(x.amount) from public.sellertray_shift_cash_movements x where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='cash_in'),0)
      - coalesce((select sum(x.amount) from public.sellertray_shift_cash_movements x where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='cash_out'),0)
      - coalesce((select sum(x.amount) from public.sellertray_shift_cash_movements x where x.tenant_id=s.tenant_id and x.shift_id=s.id and x.movement_type='expense'),0)
    )::numeric(18,2) as expected_cash
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id;
$$;

revoke all on function public.sellertray_cash_shift_totals(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_cash_shift_totals(uuid,uuid)
  to service_role;

create or replace function public.open_sellertray_cash_shift(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_register_id uuid,
  p_opening_cash numeric,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shift_id uuid;
  v_currency text;
begin
  if p_tenant_id is null or p_branch_id is null or p_register_id is null
     or p_actor_user_id is null or p_opening_cash is null or p_opening_cash<0 then
    raise exception 'Business, branch, register, operator and opening cash are required'
      using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,p_actor_user_id) then
    raise exception 'You do not have access to open a shift in this branch' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_open_shift') then
    raise exception 'You do not have permission to open a cashier shift' using errcode='42501';
  end if;

  if not exists(
    select 1 from public.sellertray_registers r
    where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
      and r.id=p_register_id and r.is_active=true
  ) then
    raise exception 'Selected register is unavailable for this branch' using errcode='23514';
  end if;

  select t.currency into v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_currency is null then
    raise exception 'Business not found' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text||':cash-shift:'||p_register_id::text,0)
  );

  if exists(
    select 1 from public.sellertray_cash_shifts s
    where s.tenant_id=p_tenant_id and s.register_id=p_register_id and s.status='open'
  ) then
    raise exception 'This register already has an open shift' using errcode='23514';
  end if;
  if exists(
    select 1 from public.sellertray_cash_shifts s
    where s.tenant_id=p_tenant_id and s.opened_by_user_id=p_actor_user_id and s.status='open'
  ) then
    raise exception 'You already have an open cashier shift' using errcode='23514';
  end if;

  insert into public.sellertray_cash_shifts(
    tenant_id,branch_id,register_id,status,currency,opening_cash,
    opened_by_user_id,opened_at
  ) values(
    p_tenant_id,p_branch_id,p_register_id,'open',v_currency,
    round(p_opening_cash::numeric,2),p_actor_user_id,now()
  ) returning id into v_shift_id;

  return jsonb_build_object(
    'shiftId',v_shift_id,
    'status','open',
    'branchId',p_branch_id,
    'registerId',p_register_id,
    'currency',v_currency,
    'openingCash',round(p_opening_cash::numeric,2),
    'expectedCash',round(p_opening_cash::numeric,2)
  );
end;
$$;

revoke all on function public.open_sellertray_cash_shift(uuid,uuid,uuid,numeric,uuid)
  from public,anon,authenticated;
grant execute on function public.open_sellertray_cash_shift(uuid,uuid,uuid,numeric,uuid)
  to service_role;

create or replace function public.record_sellertray_shift_cash_movement(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_expense_category text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shift public.sellertray_cash_shifts%rowtype;
  v_role text;
  v_type text := lower(btrim(coalesce(p_movement_type,'')));
  v_reference text := nullif(btrim(coalesce(p_reference,'')),'');
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_category text := nullif(btrim(coalesce(p_expense_category,'')),'');
  v_required_capability text;
  v_existing public.sellertray_shift_cash_movements%rowtype;
  v_movement_id uuid;
  v_expected numeric;
begin
  if p_tenant_id is null or p_shift_id is null or p_actor_user_id is null
     or p_amount is null or p_amount<=0 or v_reference is null or v_reason is null
     or v_type not in ('cash_in','cash_out','expense') then
    raise exception 'Shift, movement, amount, reference, reason and operator are required'
      using errcode='22023';
  end if;
  if char_length(v_reference)>160 or char_length(v_reason)>500
     or (v_category is not null and char_length(v_category)>120) then
    raise exception 'Cash movement details are too long' using errcode='22023';
  end if;
  if v_type='expense' and v_category is null then
    raise exception 'Expense category is required' using errcode='22023';
  end if;
  if v_type<>'expense' then v_category := null; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id
  for update;
  if not found then raise exception 'Cashier shift not found' using errcode='22023'; end if;
  if v_shift.status<>'open' then
    raise exception 'Cash movements can only be recorded in an open shift' using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_shift.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to this cashier shift' using errcode='42501';
  end if;

  v_required_capability := case when v_type='expense' then 'can_record_expense' else 'can_record_cash_movement' end;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,v_required_capability) then
    raise exception 'You do not have permission to record this cash activity' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role='staff' and v_shift.opened_by_user_id<>p_actor_user_id then
    raise exception 'Staff can record cash activity only in their own open shift' using errcode='42501';
  end if;

  select * into v_existing
  from public.sellertray_shift_cash_movements m
  where m.tenant_id=p_tenant_id
    and m.shift_id=p_shift_id
    and m.movement_type=v_type
    and lower(btrim(m.reference))=lower(v_reference)
  limit 1;

  if found then
    if v_existing.amount<>round(p_amount::numeric,2)
       or v_existing.reason<>v_reason
       or v_existing.expense_category is distinct from v_category then
      raise exception 'This cash reference is already used for different facts' using errcode='23505';
    end if;
    select t.expected_cash into v_expected
    from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;
    return jsonb_build_object(
      'movementId',v_existing.id,'shiftId',p_shift_id,'movementType',v_type,
      'amount',v_existing.amount,'currency',v_existing.currency,
      'expectedCash',v_expected,'idempotentReplay',true
    );
  end if;

  insert into public.sellertray_shift_cash_movements(
    tenant_id,branch_id,register_id,shift_id,movement_type,amount,currency,
    reference,reason,expense_category,actor_user_id
  ) values(
    p_tenant_id,v_shift.branch_id,v_shift.register_id,p_shift_id,v_type,
    round(p_amount::numeric,2),v_shift.currency,v_reference,v_reason,v_category,p_actor_user_id
  ) returning id into v_movement_id;

  select t.expected_cash into v_expected
  from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;

  return jsonb_build_object(
    'movementId',v_movement_id,'shiftId',p_shift_id,'movementType',v_type,
    'amount',round(p_amount::numeric,2),'currency',v_shift.currency,
    'expectedCash',v_expected,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid)
  to service_role;

create or replace function public.close_sellertray_cash_shift(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_declared_cash numeric,
  p_note text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shift public.sellertray_cash_shifts%rowtype;
  v_role text;
  v_expected numeric(18,2);
  v_variance numeric(18,2);
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if p_tenant_id is null or p_shift_id is null or p_actor_user_id is null
     or p_declared_cash is null or p_declared_cash<0 then
    raise exception 'Shift, declared cash and operator are required' using errcode='22023';
  end if;
  if v_note is not null and char_length(v_note)>500 then
    raise exception 'Shift note is too long' using errcode='22023';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id
  for update;
  if not found then raise exception 'Cashier shift not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_shift.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to close this cashier shift' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_close_shift') then
    raise exception 'You do not have permission to close cashier shifts' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role='staff' and v_shift.opened_by_user_id<>p_actor_user_id then
    raise exception 'Staff can close only their own cashier shift' using errcode='42501';
  end if;

  if v_shift.status in ('closed','reviewed') then
    return jsonb_build_object(
      'shiftId',p_shift_id,'status',v_shift.status,'expectedCash',v_shift.expected_cash,
      'declaredCash',v_shift.declared_cash,'variance',v_shift.variance,'idempotentReplay',true
    );
  end if;

  select t.expected_cash into v_expected
  from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id) t;
  v_variance := round(p_declared_cash::numeric,2)-v_expected;

  if abs(v_variance)>=0.01 and v_note is null then
    raise exception 'Explain the cash variance before closing this shift' using errcode='23514';
  end if;

  update public.sellertray_cash_shifts
  set status='closed',expected_cash=v_expected,
      declared_cash=round(p_declared_cash::numeric,2),variance=v_variance,
      close_note=v_note,closed_by_user_id=p_actor_user_id,closed_at=now(),updated_at=now()
  where tenant_id=p_tenant_id and id=p_shift_id;

  return jsonb_build_object(
    'shiftId',p_shift_id,'status','closed','expectedCash',v_expected,
    'declaredCash',round(p_declared_cash::numeric,2),'variance',v_variance,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.close_sellertray_cash_shift(uuid,uuid,numeric,text,uuid)
  from public,anon,authenticated;
grant execute on function public.close_sellertray_cash_shift(uuid,uuid,numeric,text,uuid)
  to service_role;

create or replace function public.review_sellertray_cash_shift(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_decision text,
  p_note text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shift public.sellertray_cash_shifts%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision,'')));
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if p_tenant_id is null or p_shift_id is null or p_actor_user_id is null
     or v_decision not in ('accepted','follow_up') then
    raise exception 'Shift, review decision and reviewer are required' using errcode='22023';
  end if;
  if v_decision='follow_up' and v_note is null then
    raise exception 'Enter a note for a shift that needs follow-up' using errcode='22023';
  end if;
  if v_note is not null and char_length(v_note)>500 then
    raise exception 'Shift review note is too long' using errcode='22023';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id
  for update;
  if not found then raise exception 'Cashier shift not found' using errcode='22023'; end if;

  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_shift.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to review this cashier shift' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_review_shift') then
    raise exception 'You do not have permission to review cashier shifts' using errcode='42501';
  end if;

  if v_shift.status='reviewed' then
    if v_shift.review_decision<>v_decision or v_shift.review_note is distinct from v_note then
      raise exception 'This cashier shift was already reviewed with a different decision' using errcode='23505';
    end if;
    return jsonb_build_object(
      'shiftId',p_shift_id,'status','reviewed','decision',v_shift.review_decision,
      'idempotentReplay',true
    );
  end if;
  if v_shift.status<>'closed' then
    raise exception 'Close the cashier shift before manager review' using errcode='23514';
  end if;

  update public.sellertray_cash_shifts
  set status='reviewed',review_decision=v_decision,review_note=v_note,
      reviewed_by_user_id=p_actor_user_id,reviewed_at=now(),updated_at=now()
  where tenant_id=p_tenant_id and id=p_shift_id;

  return jsonb_build_object(
    'shiftId',p_shift_id,'status','reviewed','decision',v_decision,'idempotentReplay',false
  );
end;
$$;

revoke all on function public.review_sellertray_cash_shift(uuid,uuid,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.review_sellertray_cash_shift(uuid,uuid,text,text,uuid)
  to service_role;

create or replace function public.capture_sellertray_shift_cash_sale()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_branch_id uuid;
  v_shift public.sellertray_cash_shifts%rowtype;
begin
  if new.status<>'confirmed' or new.method_type<>'cash' or new.provider<>'pos_cash'
     or new.confirmed_by_user_id is null then
    return new;
  end if;
  if tg_op='UPDATE' and old.status='confirmed' then
    return new;
  end if;

  select o.branch_id into v_branch_id
  from public.orders o
  where o.tenant_id=new.tenant_id and o.id=new.order_id;
  if v_branch_id is null then return new; end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=new.tenant_id
    and s.branch_id=v_branch_id
    and s.opened_by_user_id=new.confirmed_by_user_id
    and s.status='open'
  order by s.opened_at desc,s.id
  limit 1;

  if not found then return new; end if;
  if v_shift.currency<>new.currency then
    raise exception 'Cash sale currency does not match the open cashier shift' using errcode='23514';
  end if;

  insert into public.sellertray_shift_cash_sales(
    tenant_id,branch_id,register_id,shift_id,order_id,payment_id,
    amount,currency,actor_user_id,business_at
  ) values(
    new.tenant_id,v_branch_id,v_shift.register_id,v_shift.id,new.order_id,new.id,
    new.amount,new.currency,new.confirmed_by_user_id,coalesce(new.confirmed_at,now())
  ) on conflict(tenant_id,payment_id) do nothing;

  return new;
end;
$$;

revoke all on function public.capture_sellertray_shift_cash_sale()
  from public,anon,authenticated;

drop trigger if exists capture_sellertray_shift_cash_sale on public.order_payments;
create trigger capture_sellertray_shift_cash_sale
after insert or update of status on public.order_payments
for each row execute function public.capture_sellertray_shift_cash_sale();

create or replace function public.capture_sellertray_shift_cash_refund()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_branch_id uuid;
  v_shift public.sellertray_cash_shifts%rowtype;
begin
  if new.status<>'confirmed' or new.method_type<>'cash' or new.provider<>'pos_cash'
     or new.actor_user_id is null then
    return new;
  end if;

  select sr.branch_id into v_branch_id
  from public.sale_returns sr
  where sr.tenant_id=new.tenant_id and sr.id=new.sale_return_id;
  if v_branch_id is null then return new; end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=new.tenant_id
    and s.branch_id=v_branch_id
    and s.opened_by_user_id=new.actor_user_id
    and s.status='open'
  order by s.opened_at desc,s.id
  limit 1;

  if not found then return new; end if;
  if v_shift.currency<>new.currency then
    raise exception 'Cash refund currency does not match the open cashier shift' using errcode='23514';
  end if;

  insert into public.sellertray_shift_cash_refunds(
    tenant_id,branch_id,register_id,shift_id,refund_id,amount,currency,
    actor_user_id,business_at
  ) values(
    new.tenant_id,v_branch_id,v_shift.register_id,v_shift.id,new.id,new.amount,new.currency,
    new.actor_user_id,new.created_at
  ) on conflict(tenant_id,refund_id) do nothing;

  return new;
end;
$$;

revoke all on function public.capture_sellertray_shift_cash_refund()
  from public,anon,authenticated;

drop trigger if exists capture_sellertray_shift_cash_refund on public.payment_refunds;
create trigger capture_sellertray_shift_cash_refund
after insert on public.payment_refunds
for each row execute function public.capture_sellertray_shift_cash_refund();

create or replace function public.get_sellertray_cash_shift(
  p_tenant_id uuid,
  p_shift_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_shift public.sellertray_cash_shifts%rowtype;
  v_register_name text;
  v_totals record;
  v_movements jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id;
  if not found then return null; end if;

  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_shift.branch_id,v_user_id) then
    raise exception 'You do not have access to this cashier shift' using errcode='42501';
  end if;
  select tm.role into v_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role='staff' and v_shift.opened_by_user_id<>v_user_id then
    raise exception 'Staff can view only their own cashier shifts' using errcode='42501';
  end if;

  select r.name into v_register_name
  from public.sellertray_registers r
  where r.tenant_id=p_tenant_id and r.id=v_shift.register_id;

  select * into v_totals
  from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'movementId',m.id,
    'movementType',m.movement_type,
    'amount',m.amount,
    'currency',m.currency,
    'reference',m.reference,
    'reason',m.reason,
    'expenseCategory',m.expense_category,
    'actorUserId',m.actor_user_id,
    'createdAt',m.created_at
  ) order by m.created_at desc,m.id desc),'[]'::jsonb)
  into v_movements
  from public.sellertray_shift_cash_movements m
  where m.tenant_id=p_tenant_id and m.shift_id=p_shift_id;

  return jsonb_build_object(
    'shiftId',v_shift.id,
    'branchId',v_shift.branch_id,
    'registerId',v_shift.register_id,
    'registerName',v_register_name,
    'status',v_shift.status,
    'currency',v_shift.currency,
    'openingCash',v_totals.opening_cash,
    'cashSales',v_totals.cash_sales,
    'cashRefunds',v_totals.cash_refunds,
    'cashIn',v_totals.cash_in,
    'cashOut',v_totals.cash_out,
    'expenses',v_totals.expenses,
    'expectedCash',case when v_shift.status='open' then v_totals.expected_cash else v_shift.expected_cash end,
    'declaredCash',v_shift.declared_cash,
    'variance',v_shift.variance,
    'closeNote',v_shift.close_note,
    'reviewDecision',v_shift.review_decision,
    'reviewNote',v_shift.review_note,
    'openedByUserId',v_shift.opened_by_user_id,
    'openedAt',v_shift.opened_at,
    'closedAt',v_shift.closed_at,
    'reviewedAt',v_shift.reviewed_at,
    'movements',v_movements
  );
end;
$$;

revoke all on function public.get_sellertray_cash_shift(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_cash_shift(uuid,uuid)
  to authenticated;

create or replace function public.get_sellertray_active_cash_shift(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_shift_id uuid;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to cashier shifts in this branch' using errcode='42501';
  end if;

  select s.id into v_shift_id
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id
    and s.branch_id=p_branch_id
    and s.opened_by_user_id=v_user_id
    and s.status='open'
  order by s.opened_at desc,s.id
  limit 1;

  if v_shift_id is null then return null; end if;
  return public.get_sellertray_cash_shift(p_tenant_id,v_shift_id);
end;
$$;

revoke all on function public.get_sellertray_active_cash_shift(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_active_cash_shift(uuid,uuid)
  to authenticated;

create or replace function public.guard_sellertray_cash_shift_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
      return old;
    end if;
    raise exception 'Cashier shift history cannot be deleted while this business exists' using errcode='55000';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.branch_id is distinct from old.branch_id
     or new.register_id is distinct from old.register_id
     or new.currency is distinct from old.currency
     or new.opening_cash is distinct from old.opening_cash
     or new.opened_by_user_id is distinct from old.opened_by_user_id
     or new.opened_at is distinct from old.opened_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Cashier shift opening facts are immutable' using errcode='55000';
  end if;

  if old.status='reviewed' then
    raise exception 'Reviewed cashier shift history is immutable' using errcode='55000';
  end if;

  if old.status='open' then
    if new.status<>'closed'
       or new.expected_cash is null or new.declared_cash is null or new.variance is null
       or new.closed_by_user_id is null or new.closed_at is null
       or new.review_decision is not null or new.review_note is not null
       or new.reviewed_by_user_id is not null or new.reviewed_at is not null then
      raise exception 'Invalid cashier shift close transition' using errcode='55000';
    end if;
    return new;
  end if;

  if old.status='closed' then
    if new.expected_cash is distinct from old.expected_cash
       or new.declared_cash is distinct from old.declared_cash
       or new.variance is distinct from old.variance
       or new.close_note is distinct from old.close_note
       or new.closed_by_user_id is distinct from old.closed_by_user_id
       or new.closed_at is distinct from old.closed_at
       or new.status<>'reviewed'
       or new.review_decision is null
       or new.reviewed_by_user_id is null
       or new.reviewed_at is null then
      raise exception 'Invalid cashier shift review transition' using errcode='55000';
    end if;
    return new;
  end if;

  raise exception 'Unsupported cashier shift state' using errcode='55000';
end;
$$;

revoke all on function public.guard_sellertray_cash_shift_history()
  from public,anon,authenticated;

create trigger guard_sellertray_cash_shift_history
before update or delete on public.sellertray_cash_shifts
for each row execute function public.guard_sellertray_cash_shift_history();

create or replace function public.prevent_sellertray_cash_history_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Cashier cash history is immutable while this business exists' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_cash_history_mutation()
  from public,anon,authenticated;

create trigger prevent_sellertray_shift_cash_movements_mutation
before update or delete on public.sellertray_shift_cash_movements
for each row execute function public.prevent_sellertray_cash_history_mutation();
create trigger prevent_sellertray_shift_cash_sales_mutation
before update or delete on public.sellertray_shift_cash_sales
for each row execute function public.prevent_sellertray_cash_history_mutation();
create trigger prevent_sellertray_shift_cash_refunds_mutation
before update or delete on public.sellertray_shift_cash_refunds
for each row execute function public.prevent_sellertray_cash_history_mutation();

commit;