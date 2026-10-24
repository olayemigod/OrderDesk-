begin;

-- Branch payment governance extends the shared payment core without treating
-- non-cash settlements as drawer cash.
alter table public.merchant_payment_methods
  drop constraint if exists merchant_payment_methods_type_check;

alter table public.merchant_payment_methods
  add constraint merchant_payment_methods_type_check
    check (method_type=any(array[
      'bank_transfer'::text,
      'card_terminal'::text,
      'paystack'::text,
      'flutterwave'::text,
      'cash_on_delivery'::text,
      'pay_on_pickup'::text
    ]));

drop index if exists public.merchant_payment_methods_singleton_idx;
create unique index merchant_payment_methods_singleton_idx
  on public.merchant_payment_methods(tenant_id,method_type)
  where method_type not in ('bank_transfer','card_terminal');

alter table public.order_payments
  drop constraint if exists order_payments_method_type_check;

alter table public.order_payments
  add constraint order_payments_method_type_check
    check (method_type=any(array[
      'bank_transfer'::text,
      'card_terminal'::text,
      'paystack'::text,
      'flutterwave'::text,
      'cash_on_delivery'::text,
      'pay_on_pickup'::text,
      'cash'::text
    ]));

create table public.sellertray_branch_payment_methods (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  payment_method_id uuid not null,
  is_enabled boolean not null default true,
  assigned_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,branch_id,payment_method_id),
  constraint sellertray_branch_payment_methods_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  constraint sellertray_branch_payment_methods_method_same_tenant
    foreign key (tenant_id,payment_method_id)
    references public.merchant_payment_methods(tenant_id,id)
    on delete cascade
);

create index sellertray_branch_payment_methods_method_idx
  on public.sellertray_branch_payment_methods(tenant_id,payment_method_id,branch_id)
  where is_enabled;

alter table public.sellertray_branch_payment_methods enable row level security;
revoke all on public.sellertray_branch_payment_methods from public,anon,authenticated;
grant select on public.sellertray_branch_payment_methods to authenticated;
grant all on public.sellertray_branch_payment_methods to service_role;

create policy sellertray_branch_payment_methods_select_member
on public.sellertray_branch_payment_methods
for select to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=sellertray_branch_payment_methods.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

-- Existing enabled methods remain available at existing branches after the
-- migration. Future management becomes explicit per payment method/Branch.
insert into public.sellertray_branch_payment_methods(
  tenant_id,branch_id,payment_method_id,is_enabled,assigned_by_user_id
)
select b.tenant_id,b.id,m.id,true,m.updated_by_user_id
from public.branches b
join public.merchant_payment_methods m
  on m.tenant_id=b.tenant_id
 and m.is_enabled=true
on conflict (tenant_id,branch_id,payment_method_id) do update
set is_enabled=true,
    updated_at=now();

create or replace function public.set_sellertray_payment_method_branches(
  p_tenant_id uuid,
  p_payment_method_id uuid,
  p_branch_ids uuid[],
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_branch_ids uuid[] := coalesce(p_branch_ids,array[]::uuid[]);
  v_invalid_count integer;
begin
  if p_tenant_id is null or p_payment_method_id is null or p_actor_user_id is null then
    raise exception 'Business, payment method and operator are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Only the business Owner or Manager can assign payment methods to branches'
      using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if not exists(
    select 1
    from public.merchant_payment_methods m
    where m.tenant_id=p_tenant_id and m.id=p_payment_method_id
  ) then
    raise exception 'SellerTray payment method not found' using errcode='22023';
  end if;

  select count(*)::integer into v_invalid_count
  from unnest(v_branch_ids) branch_id
  where not exists(
    select 1
    from public.branches b
    where b.tenant_id=p_tenant_id
      and b.id=branch_id
      and b.is_active=true
  );

  if v_invalid_count>0 then
    raise exception 'One or more selected branches are unavailable for this business'
      using errcode='23514';
  end if;

  update public.sellertray_branch_payment_methods
  set is_enabled=false,
      assigned_by_user_id=p_actor_user_id,
      updated_at=now()
  where tenant_id=p_tenant_id
    and payment_method_id=p_payment_method_id
    and is_enabled=true;

  insert into public.sellertray_branch_payment_methods(
    tenant_id,branch_id,payment_method_id,is_enabled,assigned_by_user_id,updated_at
  )
  select p_tenant_id,branch_id,p_payment_method_id,true,p_actor_user_id,now()
  from unnest(v_branch_ids) branch_id
  on conflict (tenant_id,branch_id,payment_method_id) do update
    set is_enabled=true,
        assigned_by_user_id=excluded.assigned_by_user_id,
        updated_at=now();

  return jsonb_build_object(
    'paymentMethodId',p_payment_method_id,
    'branchIds',coalesce((
      select jsonb_agg(x.branch_id order by x.branch_id)
      from public.sellertray_branch_payment_methods x
      where x.tenant_id=p_tenant_id
        and x.payment_method_id=p_payment_method_id
        and x.is_enabled=true
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.set_sellertray_payment_method_branches(uuid,uuid,uuid[],uuid)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_payment_method_branches(uuid,uuid,uuid[],uuid)
  to service_role;

create or replace function public.get_sellertray_branch_pos_payment_methods(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table(
  payment_method_id uuid,
  method_type text,
  display_name text,
  sort_order integer,
  is_default boolean,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  instructions text
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

  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to payment methods for this branch' using errcode='42501';
  end if;

  return query
  select
    null::uuid,
    'cash'::text,
    'Cash'::text,
    -1::integer,
    false,
    null::text,
    null::text,
    null::text,
    null::text
  union all
  select
    m.id,
    m.method_type,
    m.display_name,
    m.sort_order::integer,
    m.is_default,
    m.bank_name,
    m.bank_account_name,
    m.bank_account_number,
    m.instructions
  from public.sellertray_branch_payment_methods bpm
  join public.merchant_payment_methods m
    on m.tenant_id=bpm.tenant_id
   and m.id=bpm.payment_method_id
  where bpm.tenant_id=p_tenant_id
    and bpm.branch_id=p_branch_id
    and bpm.is_enabled=true
    and m.is_enabled=true
    and m.method_type in ('bank_transfer','card_terminal')
  order by 4,3;
end;
$$;

revoke all on function public.get_sellertray_branch_pos_payment_methods(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_branch_pos_payment_methods(uuid,uuid)
  to authenticated;

-- Snapshot payment methods at shift open so later configuration changes cannot
-- rewrite what the cashier was expected to reconcile.
create table public.sellertray_shift_payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  method_key text not null,
  payment_method_id uuid,
  method_type text not null,
  display_name text not null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,shift_id,method_key),
  constraint sellertray_shift_payment_methods_shift_same_branch
    foreign key (tenant_id,branch_id,register_id,shift_id)
    references public.sellertray_cash_shifts(tenant_id,branch_id,register_id,id)
    on delete cascade,
  constraint sellertray_shift_payment_methods_method_same_tenant
    foreign key (tenant_id,payment_method_id)
    references public.merchant_payment_methods(tenant_id,id)
    on delete restrict,
  constraint sellertray_shift_payment_methods_key_check
    check (
      (method_type='cash' and payment_method_id is null and method_key='cash')
      or
      (method_type<>'cash' and payment_method_id is not null and method_key=payment_method_id::text)
    )
);

create index sellertray_shift_payment_methods_shift_idx
  on public.sellertray_shift_payment_methods(tenant_id,shift_id,sort_order,display_name);

alter table public.sellertray_shift_payment_methods enable row level security;
revoke all on public.sellertray_shift_payment_methods from public,anon,authenticated;
grant all on public.sellertray_shift_payment_methods to service_role;

create table public.sellertray_shift_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  order_id uuid not null,
  payment_id uuid not null,
  payment_method_id uuid,
  method_key text not null,
  method_type text not null,
  provider text not null,
  display_name text not null,
  amount numeric(18,2) not null check (amount>0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  actor_user_id uuid not null,
  business_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,payment_id),
  constraint sellertray_shift_payments_shift_same_branch
    foreign key (tenant_id,branch_id,register_id,shift_id)
    references public.sellertray_cash_shifts(tenant_id,branch_id,register_id,id)
    on delete cascade,
  constraint sellertray_shift_payments_payment_same_order
    foreign key (tenant_id,order_id,payment_id)
    references public.order_payments(tenant_id,order_id,id)
    on delete restrict,
  constraint sellertray_shift_payments_method_same_tenant
    foreign key (tenant_id,payment_method_id)
    references public.merchant_payment_methods(tenant_id,id)
    on delete restrict,
  constraint sellertray_shift_payments_key_check
    check (
      (method_type='cash' and payment_method_id is null and method_key='cash')
      or
      (method_type<>'cash' and payment_method_id is not null and method_key=payment_method_id::text)
    )
);

create index sellertray_shift_payments_shift_business_idx
  on public.sellertray_shift_payments(tenant_id,shift_id,business_at desc);

alter table public.sellertray_shift_payments enable row level security;
revoke all on public.sellertray_shift_payments from public,anon,authenticated;
grant all on public.sellertray_shift_payments to service_role;

create or replace function public.snapshot_sellertray_shift_payment_methods()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.sellertray_shift_payment_methods(
    tenant_id,branch_id,register_id,shift_id,method_key,payment_method_id,
    method_type,display_name,sort_order
  ) values(
    new.tenant_id,new.branch_id,new.register_id,new.id,'cash',null,
    'cash','Cash',-1
  ) on conflict (tenant_id,shift_id,method_key) do nothing;

  insert into public.sellertray_shift_payment_methods(
    tenant_id,branch_id,register_id,shift_id,method_key,payment_method_id,
    method_type,display_name,sort_order
  )
  select
    new.tenant_id,new.branch_id,new.register_id,new.id,m.id::text,m.id,
    m.method_type,m.display_name,m.sort_order::integer
  from public.sellertray_branch_payment_methods bpm
  join public.merchant_payment_methods m
    on m.tenant_id=bpm.tenant_id and m.id=bpm.payment_method_id
  where bpm.tenant_id=new.tenant_id
    and bpm.branch_id=new.branch_id
    and bpm.is_enabled=true
    and m.is_enabled=true
    and m.method_type in ('bank_transfer','card_terminal','paystack','flutterwave')
  on conflict (tenant_id,shift_id,method_key) do nothing;

  return new;
end;
$$;

revoke all on function public.snapshot_sellertray_shift_payment_methods()
  from public,anon,authenticated;

drop trigger if exists snapshot_sellertray_shift_payment_methods on public.sellertray_cash_shifts;
create trigger snapshot_sellertray_shift_payment_methods
after insert on public.sellertray_cash_shifts
for each row execute function public.snapshot_sellertray_shift_payment_methods();

-- Backfill any shifts created before this migration.
insert into public.sellertray_shift_payment_methods(
  tenant_id,branch_id,register_id,shift_id,method_key,payment_method_id,
  method_type,display_name,sort_order
)
select s.tenant_id,s.branch_id,s.register_id,s.id,'cash',null,'cash','Cash',-1
from public.sellertray_cash_shifts s
on conflict (tenant_id,shift_id,method_key) do nothing;

insert into public.sellertray_shift_payment_methods(
  tenant_id,branch_id,register_id,shift_id,method_key,payment_method_id,
  method_type,display_name,sort_order
)
select s.tenant_id,s.branch_id,s.register_id,s.id,m.id::text,m.id,
       m.method_type,m.display_name,m.sort_order::integer
from public.sellertray_cash_shifts s
join public.sellertray_branch_payment_methods bpm
  on bpm.tenant_id=s.tenant_id
 and bpm.branch_id=s.branch_id
 and bpm.is_enabled=true
join public.merchant_payment_methods m
  on m.tenant_id=bpm.tenant_id
 and m.id=bpm.payment_method_id
 and m.is_enabled=true
where m.method_type in ('bank_transfer','card_terminal','paystack','flutterwave')
on conflict (tenant_id,shift_id,method_key) do nothing;

create or replace function public.capture_sellertray_shift_payment()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_shift public.sellertray_cash_shifts%rowtype;
  v_method public.merchant_payment_methods%rowtype;
  v_method_key text;
  v_display_name text;
  v_sort_order integer;
begin
  if new.status<>'confirmed' or new.confirmed_by_user_id is null then
    return new;
  end if;
  if tg_op='UPDATE' and old.status='confirmed' then
    return new;
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=new.tenant_id and o.id=new.order_id;

  if not found or v_order.source<>'pos' or v_order.branch_id is null then
    return new;
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=new.tenant_id
    and s.branch_id=v_order.branch_id
    and s.opened_by_user_id=new.confirmed_by_user_id
    and s.status='open'
  order by s.opened_at desc,s.id
  limit 1;

  if not found then return new; end if;
  if v_shift.currency<>new.currency then
    raise exception 'POS payment currency does not match the open cashier shift' using errcode='23514';
  end if;

  if new.method_type='cash' then
    v_method_key := 'cash';
    v_display_name := 'Cash';
    v_sort_order := -1;
  else
    if new.payment_method_id is null then return new; end if;
    select * into v_method
    from public.merchant_payment_methods m
    where m.tenant_id=new.tenant_id and m.id=new.payment_method_id;
    if not found then return new; end if;
    v_method_key := new.payment_method_id::text;
    v_display_name := v_method.display_name;
    v_sort_order := v_method.sort_order::integer;
  end if;

  insert into public.sellertray_shift_payment_methods(
    tenant_id,branch_id,register_id,shift_id,method_key,payment_method_id,
    method_type,display_name,sort_order
  ) values(
    new.tenant_id,v_order.branch_id,v_shift.register_id,v_shift.id,
    v_method_key,new.payment_method_id,new.method_type,v_display_name,v_sort_order
  ) on conflict (tenant_id,shift_id,method_key) do nothing;

  insert into public.sellertray_shift_payments(
    tenant_id,branch_id,register_id,shift_id,order_id,payment_id,payment_method_id,
    method_key,method_type,provider,display_name,amount,currency,actor_user_id,business_at
  ) values(
    new.tenant_id,v_order.branch_id,v_shift.register_id,v_shift.id,new.order_id,new.id,
    new.payment_method_id,v_method_key,new.method_type,new.provider,v_display_name,
    new.amount,new.currency,new.confirmed_by_user_id,coalesce(new.confirmed_at,now())
  ) on conflict (tenant_id,payment_id) do nothing;

  return new;
end;
$$;

revoke all on function public.capture_sellertray_shift_payment()
  from public,anon,authenticated;

drop trigger if exists capture_sellertray_shift_payment on public.order_payments;
create trigger capture_sellertray_shift_payment
after insert or update of status on public.order_payments
for each row execute function public.capture_sellertray_shift_payment();

-- Preserve pre-migration POS cash history in the new all-method shift ledger.
insert into public.sellertray_shift_payments(
  tenant_id,branch_id,register_id,shift_id,order_id,payment_id,payment_method_id,
  method_key,method_type,provider,display_name,amount,currency,actor_user_id,business_at
)
select s.tenant_id,s.branch_id,s.register_id,s.shift_id,s.order_id,s.payment_id,
       p.payment_method_id,
       case when p.payment_method_id is null then 'cash' else p.payment_method_id::text end,
       p.method_type,p.provider,
       coalesce(m.display_name,'Cash'),s.amount,s.currency,s.actor_user_id,s.business_at
from public.sellertray_shift_cash_sales s
join public.order_payments p
  on p.tenant_id=s.tenant_id and p.order_id=s.order_id and p.id=s.payment_id
left join public.merchant_payment_methods m
  on m.tenant_id=p.tenant_id and m.id=p.payment_method_id
on conflict (tenant_id,payment_id) do nothing;

create or replace function public.get_sellertray_shift_payment_summary(
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
  v_summary jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id;
  if not found then return '[]'::jsonb; end if;

  if not public.sellertray_user_can_read_branch(p_tenant_id,v_shift.branch_id,v_user_id) then
    raise exception 'You do not have access to this cashier shift' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role='staff' and v_shift.opened_by_user_id<>v_user_id then
    raise exception 'Staff can view only their own cashier shifts' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'methodKey',sm.method_key,
    'paymentMethodId',sm.payment_method_id,
    'methodType',sm.method_type,
    'displayName',sm.display_name,
    'transactionCount',coalesce(t.transaction_count,0),
    'amount',coalesce(t.amount,0),
    'currency',v_shift.currency
  ) order by sm.sort_order,sm.display_name,sm.method_key),'[]'::jsonb)
  into v_summary
  from public.sellertray_shift_payment_methods sm
  left join (
    select sp.method_key,count(*)::integer as transaction_count,sum(sp.amount)::numeric(18,2) as amount
    from public.sellertray_shift_payments sp
    where sp.tenant_id=p_tenant_id and sp.shift_id=p_shift_id
    group by sp.method_key
  ) t on t.method_key=sm.method_key
  where sm.tenant_id=p_tenant_id and sm.shift_id=p_shift_id;

  return v_summary;
end;
$$;

revoke all on function public.get_sellertray_shift_payment_summary(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_shift_payment_summary(uuid,uuid)
  to authenticated;

create or replace function public.prevent_sellertray_shift_payment_history_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' and not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Cashier payment history is immutable while this business exists' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_shift_payment_history_mutation()
  from public,anon,authenticated;

create trigger prevent_sellertray_shift_payment_methods_mutation
before update or delete on public.sellertray_shift_payment_methods
for each row execute function public.prevent_sellertray_shift_payment_history_mutation();

create trigger prevent_sellertray_shift_payments_mutation
before update or delete on public.sellertray_shift_payments
for each row execute function public.prevent_sellertray_shift_payment_history_mutation();

-- Card terminal settlements are verified externally by the cashier and are
-- therefore governed like other manually-confirmed offline methods.
create or replace function public.confirm_sellertray_offline_payment(
  p_payment_id uuid,
  p_actor_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.order_payments%rowtype;
begin
  select * into v_payment
  from public.order_payments p
  where p.id=p_payment_id
  for update;

  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;

  if v_payment.method_type not in ('bank_transfer','card_terminal','cash_on_delivery','pay_on_pickup','cash') then
    raise exception 'Only offline SellerTray payments can be confirmed manually' using errcode='23514';
  end if;

  if v_payment.status not in ('initiated','pending_verification') then
    raise exception 'SellerTray payment is not awaiting confirmation' using errcode='23514';
  end if;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=v_payment.tenant_id and tm.user_id=p_actor_user_id
  ) then
    raise exception 'SellerTray payment confirmation requires a tenant member' using errcode='42501';
  end if;

  perform public.transition_sellertray_order_payment(
    p_payment_id,
    'confirmed',
    'staff',
    p_actor_user_id,
    null,
    null
  );

  perform public.record_sellertray_payment_event(
    v_payment.tenant_id,
    v_payment.order_id,
    v_payment.id,
    v_payment.provider,
    'staff:' || v_payment.id::text || ':' || p_actor_user_id::text,
    'manual_confirmation',
    'staff',
    'verified',
    null,
    null,
    null,
    jsonb_build_object('note',left(coalesce(p_note,''),500))
  );

  return p_payment_id;
end;
$$;

revoke all on function public.confirm_sellertray_offline_payment(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.confirm_sellertray_offline_payment(uuid,uuid,text)
  to service_role;

create or replace function public.create_sellertray_order_payment_for_method(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_method_id uuid,
  p_status text default 'initiated',
  p_provider_reference text default null,
  p_idempotency_key text default null,
  p_customer_claimed_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_method public.merchant_payment_methods%rowtype;
  v_invoice public.order_financial_documents%rowtype;
  v_payment_id uuid;
  v_existing public.order_payments%rowtype;
  v_idempotency_key text := nullif(btrim(p_idempotency_key),'');
begin
  if p_status not in ('initiated','pending_verification') then
    raise exception 'New SellerTray payment must start as initiated or pending verification' using errcode='22023';
  end if;

  select * into v_method
  from public.merchant_payment_methods m
  where m.id=p_payment_method_id and m.tenant_id=p_tenant_id and m.is_enabled=true;

  if not found then
    raise exception 'SellerTray payment method is not enabled' using errcode='23514';
  end if;

  if v_method.method_type in ('paystack','flutterwave')
     and v_method.configuration_status<>'configured' then
    raise exception 'SellerTray payment gateway is not configured' using errcode='23514';
  end if;

  if v_idempotency_key is not null then
    select * into v_existing
    from public.order_payments p
    where p.tenant_id=p_tenant_id and p.idempotency_key=v_idempotency_key;

    if found then
      if v_existing.order_id<>p_order_id or v_existing.payment_method_id<>p_payment_method_id then
        raise exception 'SellerTray payment idempotency key conflicts with another payment' using errcode='23505';
      end if;
      return v_existing.id;
    end if;
  end if;

  if exists (
    select 1 from public.orders o
    where o.id=p_order_id and o.tenant_id=p_tenant_id and o.payment_status='paid'
  ) then
    raise exception 'SellerTray order is already paid' using errcode='23514';
  end if;

  select * into v_invoice
  from public.order_financial_documents d
  where d.tenant_id=p_tenant_id
    and d.order_id=p_order_id
    and d.document_type='invoice'
    and d.status='issued';

  if not found or v_invoice.amount<=0 then
    raise exception 'SellerTray order has no payable invoice' using errcode='23514';
  end if;

  insert into public.order_payments (
    tenant_id,order_id,invoice_document_id,payment_method_id,
    method_type,provider,status,amount,currency,provider_reference,
    idempotency_key,customer_claimed_at
  ) values (
    p_tenant_id,p_order_id,v_invoice.id,p_payment_method_id,
    v_method.method_type,
    case
      when v_method.method_type in ('paystack','flutterwave') then v_method.method_type
      when v_method.method_type='bank_transfer' then 'manual_bank'
      when v_method.method_type='card_terminal' then 'manual_card'
      else 'merchant'
    end,
    p_status,v_invoice.amount,v_invoice.currency,nullif(btrim(p_provider_reference),''),
    v_idempotency_key,
    case when p_status='pending_verification' then coalesce(p_customer_claimed_at,now())
         else p_customer_claimed_at end
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

revoke all on function public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz)
  to service_role;

-- One governed POS completion command now handles cash and Branch-assigned
-- offline payment methods. Cash remains the null payment_method_id sentinel.
create or replace function public.complete_sellertray_pos_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_method_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_method public.merchant_payment_methods%rowtype;
  v_stock_location_id uuid;
  v_payment_id uuid;
  v_invoice_id uuid;
  v_on_hand numeric(18,6);
  v_required numeric(18,6);
  v_product_name text;
  v_movement_count integer := 0;
  v_expected_lines integer := 0;
  v_existing_movements integer := 0;
  v_existing_payments integer := 0;
  v_method_type text;
  v_line record;
  v_item record;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Business, sale and operator are required' using errcode='22023';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;

  if not found then
    raise exception 'SellerTray POS sale not found' using errcode='22023';
  end if;
  if v_order.source<>'pos' then
    raise exception 'Only POS orders can use counter checkout' using errcode='23514';
  end if;
  if v_order.branch_id is null then
    raise exception 'POS sale requires a branch' using errcode='23514';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to complete sales from this branch' using errcode='42501';
  end if;

  if p_payment_method_id is null then
    v_method_type := 'cash';
  else
    select * into v_method
    from public.merchant_payment_methods m
    where m.tenant_id=p_tenant_id
      and m.id=p_payment_method_id
      and m.is_enabled=true;
    if not found then
      raise exception 'Selected payment method is not enabled' using errcode='23514';
    end if;
    if v_method.method_type not in ('bank_transfer','card_terminal') then
      raise exception 'This payment method cannot complete an in-person sale yet' using errcode='23514';
    end if;
    if not exists(
      select 1
      from public.sellertray_branch_payment_methods bpm
      where bpm.tenant_id=p_tenant_id
        and bpm.branch_id=v_order.branch_id
        and bpm.payment_method_id=p_payment_method_id
        and bpm.is_enabled=true
    ) then
      raise exception 'Selected payment method is not assigned to this branch' using errcode='23514';
    end if;
    v_method_type := v_method.method_type;
  end if;

  select sl.id into v_stock_location_id
  from public.stock_locations sl
  where sl.tenant_id=p_tenant_id
    and sl.branch_id=v_order.branch_id
    and sl.is_default=true
    and sl.is_active=true
  order by sl.created_at,sl.id
  limit 1;

  if v_stock_location_id is null then
    raise exception 'POS branch has no active default stock location' using errcode='23514';
  end if;

  select count(*)::integer into v_expected_lines
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id;
  if v_expected_lines<1 then
    raise exception 'POS sale has no items' using errcode='23514';
  end if;

  select count(*)::integer into v_existing_movements
  from public.inventory_movements im
  where im.tenant_id=p_tenant_id
    and im.reference_type='order'
    and im.reference_id=p_order_id::text
    and im.movement_type='sale';

  select count(*)::integer into v_existing_payments
  from public.order_payments p
  where p.tenant_id=p_tenant_id
    and p.order_id=p_order_id
    and p.status='confirmed'
    and (
      (p_payment_method_id is null and p.method_type='cash' and p.provider='pos_cash')
      or
      (p_payment_method_id is not null and p.payment_method_id=p_payment_method_id)
    );

  if v_order.status='completed' then
    if v_order.payment_status='paid'
       and v_order.fulfillment_status='collected'
       and v_existing_payments=1
       and v_existing_movements=v_expected_lines then
      select p.id into v_payment_id
      from public.order_payments p
      where p.tenant_id=p_tenant_id
        and p.order_id=p_order_id
        and p.status='confirmed'
        and (
          (p_payment_method_id is null and p.method_type='cash' and p.provider='pos_cash')
          or
          (p_payment_method_id is not null and p.payment_method_id=p_payment_method_id)
        )
      order by p.confirmed_at,p.id
      limit 1;

      return jsonb_build_object(
        'orderId',p_order_id,
        'paymentId',v_payment_id,
        'paymentMethodId',p_payment_method_id,
        'methodType',v_method_type,
        'status','completed',
        'paymentStatus','paid',
        'fulfillmentStatus','collected',
        'inventoryMovementCount',v_existing_movements,
        'idempotentReplay',true
      );
    end if;
    raise exception 'Completed POS sale has inconsistent payment or stock state' using errcode='23514';
  end if;

  if v_order.status<>'draft' then
    raise exception 'POS checkout requires a draft sale' using errcode='23514';
  end if;

  if v_order.payment_status<>'unpaid'
     or exists(
       select 1 from public.order_payments p
       where p.tenant_id=p_tenant_id and p.order_id=p_order_id
     )
     or v_existing_movements>0 then
    raise exception 'POS draft already has payment or stock activity' using errcode='23514';
  end if;

  for v_item in
    select
      oi.catalog_item_id,
      sum(oi.stock_quantity)::numeric(18,6) as required_quantity,
      max(ci.name) as product_name
    from public.order_items oi
    join public.catalog_items ci
      on ci.tenant_id=oi.tenant_id and ci.id=oi.catalog_item_id
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
    group by oi.catalog_item_id
    order by oi.catalog_item_id
  loop
    if v_item.catalog_item_id is null
       or v_item.required_quantity is null
       or v_item.required_quantity<=0 then
      raise exception 'POS sale has an invalid stock quantity' using errcode='23514';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_tenant_id::text || ':' || v_order.branch_id::text || ':' ||
        v_stock_location_id::text || ':' || v_item.catalog_item_id::text,
        0
      )
    );

    select coalesce(sum(im.quantity_delta),0)::numeric(18,6)
    into v_on_hand
    from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.branch_id=v_order.branch_id
      and im.stock_location_id=v_stock_location_id
      and im.catalog_item_id=v_item.catalog_item_id;

    v_required := v_item.required_quantity;
    v_product_name := v_item.product_name;
    if v_on_hand<v_required then
      raise exception 'Insufficient stock for %: % available, % required',
        coalesce(v_product_name,'product'),v_on_hand,v_required
        using errcode='23514';
    end if;
  end loop;

  update public.orders
  set status='accepted',updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  v_invoice_id := public.ensure_sellertray_invoice_for_order(p_order_id);
  if v_invoice_id is null then
    raise exception 'POS sale could not create a payable invoice' using errcode='23514';
  end if;

  if p_payment_method_id is null then
    v_payment_id := public.create_sellertray_order_payment(
      p_tenant_id,p_order_id,'cash','pos_cash','initiated',null,
      'pos-cash:' || p_order_id::text,null
    );
    perform public.confirm_sellertray_offline_payment(
      v_payment_id,p_actor_user_id,'Counter cash sale'
    );
  else
    v_payment_id := public.create_sellertray_order_payment_for_method(
      p_tenant_id,p_order_id,p_payment_method_id,'initiated',null,
      'pos-method:' || p_order_id::text || ':' || p_payment_method_id::text,null
    );
    perform public.confirm_sellertray_offline_payment(
      v_payment_id,p_actor_user_id,'Counter ' || replace(v_method_type,'_',' ') || ' sale'
    );
  end if;

  for v_line in
    select
      oi.id,
      oi.catalog_item_id,
      oi.selected_uom,
      oi.quantity,
      oi.conversion_factor,
      oi.stock_quantity,
      oi.unit_price
    from public.order_items oi
    where oi.tenant_id=p_tenant_id and oi.order_id=p_order_id
    order by oi.id
  loop
    if v_line.catalog_item_id is null
       or v_line.selected_uom is null
       or v_line.quantity is null or v_line.quantity<=0
       or v_line.conversion_factor is null or v_line.conversion_factor<=0
       or v_line.stock_quantity is null or v_line.stock_quantity<=0 then
      raise exception 'POS sale line has incomplete UOM stock snapshot' using errcode='23514';
    end if;

    perform public.record_sellertray_inventory_movement(
      p_tenant_id,
      v_order.branch_id,
      v_stock_location_id,
      v_line.catalog_item_id,
      'sale',
      -v_line.stock_quantity,
      v_line.selected_uom,
      v_line.quantity,
      v_line.conversion_factor,
      'order',
      p_order_id::text,
      'pos-sale:' || p_order_id::text || ':' || v_line.id::text,
      now(),
      p_actor_user_id,
      'Counter sale',
      jsonb_build_object(
        'order_id',p_order_id,
        'public_order_id',v_order.public_order_id,
        'order_item_id',v_line.id,
        'payment_id',v_payment_id,
        'payment_method_id',p_payment_method_id,
        'payment_method_type',v_method_type,
        'unit_price',v_line.unit_price
      ),
      null
    );
    v_movement_count := v_movement_count+1;
  end loop;

  update public.orders set status='processing',updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;
  update public.orders set status='ready',updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;
  update public.orders
  set status='completed',
      fulfillment_method='customer_pickup',
      fulfillment_status='collected',
      fulfilled_at=now(),
      fulfillment_confirmed_by='merchant',
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  return jsonb_build_object(
    'orderId',p_order_id,
    'paymentId',v_payment_id,
    'paymentMethodId',p_payment_method_id,
    'methodType',v_method_type,
    'status','completed',
    'paymentStatus','paid',
    'fulfillmentStatus','collected',
    'inventoryMovementCount',v_movement_count,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.complete_sellertray_pos_sale(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.complete_sellertray_pos_sale(uuid,uuid,uuid,uuid)
  to service_role;

create or replace function public.complete_sellertray_pos_cash_sale(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language sql
security definer
set search_path=''
as $$
  select public.complete_sellertray_pos_sale(
    p_tenant_id,p_order_id,null::uuid,p_actor_user_id
  );
$$;

revoke all on function public.complete_sellertray_pos_cash_sale(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.complete_sellertray_pos_cash_sale(uuid,uuid,uuid)
  to service_role;

commit;
