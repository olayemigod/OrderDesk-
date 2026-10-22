begin;

-- Expense Category is Business-scoped master data shared by Merchant Web and Mobile.
-- Existing expense_category text is retained as the immutable historical label snapshot;
-- expense_category_id is the canonical identity for reporting and future consumers.

create table public.sellertray_expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint sellertray_expense_categories_name_check
    check (char_length(btrim(name)) between 1 and 120)
);

create unique index sellertray_expense_categories_tenant_name_unique
  on public.sellertray_expense_categories (tenant_id, lower(btrim(name)));
create index sellertray_expense_categories_tenant_active_name_idx
  on public.sellertray_expense_categories (tenant_id, is_active, lower(btrim(name)));

create table public.sellertray_expense_category_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null,
  action text not null,
  previous_name text,
  new_name text,
  previous_active boolean,
  new_active boolean,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sellertray_expense_category_audit_category_same_tenant
    foreign key (tenant_id, category_id)
    references public.sellertray_expense_categories(tenant_id, id) on delete restrict,
  constraint sellertray_expense_category_audit_action_check
    check (action in ('created','renamed','activated','deactivated'))
);

create index sellertray_expense_category_audit_lookup_idx
  on public.sellertray_expense_category_audit (tenant_id, category_id, created_at desc);

alter table public.sellertray_expense_categories enable row level security;
alter table public.sellertray_expense_category_audit enable row level security;
revoke all on table public.sellertray_expense_categories from public, anon, authenticated;
revoke all on table public.sellertray_expense_category_audit from public, anon, authenticated;
grant all on table public.sellertray_expense_categories to service_role;
grant all on table public.sellertray_expense_category_audit to service_role;

-- Preserve all categories already present in either expense surface. The earliest
-- historical label/actor becomes the initial master row; case-insensitive duplicates
-- collapse to one Business-scoped category identity.
with historical as (
  select
    e.tenant_id,
    btrim(e.expense_category) as name,
    e.actor_user_id,
    e.created_at,
    e.id
  from public.sellertray_business_expenses e
  where nullif(btrim(e.expense_category), '') is not null
  union all
  select
    m.tenant_id,
    btrim(m.expense_category) as name,
    m.actor_user_id,
    m.created_at,
    m.id
  from public.sellertray_shift_cash_movements m
  where m.movement_type='expense'
    and nullif(btrim(m.expense_category), '') is not null
), ranked as (
  select *, row_number() over (
    partition by tenant_id, lower(name)
    order by created_at, id
  ) as rn
  from historical
)
insert into public.sellertray_expense_categories (
  tenant_id,name,is_active,created_by_user_id,updated_by_user_id,created_at,updated_at
)
select tenant_id,name,true,actor_user_id,actor_user_id,created_at,created_at
from ranked
where rn=1
on conflict do nothing;

alter table public.sellertray_business_expenses
  add column expense_category_id uuid,
  add column expense_category_name_snapshot text;

alter table public.sellertray_shift_cash_movements
  add column expense_category_id uuid,
  add column expense_category_name_snapshot text;

update public.sellertray_business_expenses e
set expense_category_id=c.id,
    expense_category_name_snapshot=e.expense_category
from public.sellertray_expense_categories c
where c.tenant_id=e.tenant_id
  and lower(btrim(c.name))=lower(btrim(e.expense_category));

update public.sellertray_shift_cash_movements m
set expense_category_id=c.id,
    expense_category_name_snapshot=m.expense_category
from public.sellertray_expense_categories c
where m.movement_type='expense'
  and c.tenant_id=m.tenant_id
  and lower(btrim(c.name))=lower(btrim(m.expense_category));

alter table public.sellertray_business_expenses
  add constraint sellertray_business_expenses_category_master_same_tenant
    foreign key (tenant_id, expense_category_id)
    references public.sellertray_expense_categories(tenant_id,id) on delete restrict,
  add constraint sellertray_business_expenses_category_snapshot_check
    check (char_length(btrim(expense_category_name_snapshot)) between 1 and 120),
  alter column expense_category_id set not null,
  alter column expense_category_name_snapshot set not null;

alter table public.sellertray_shift_cash_movements
  add constraint sellertray_shift_cash_movements_category_master_same_tenant
    foreign key (tenant_id, expense_category_id)
    references public.sellertray_expense_categories(tenant_id,id) on delete restrict,
  add constraint sellertray_shift_cash_movements_category_shape_check
    check (
      (movement_type='expense'
        and expense_category_id is not null
        and expense_category_name_snapshot is not null
        and char_length(btrim(expense_category_name_snapshot)) between 1 and 120)
      or
      (movement_type<>'expense'
        and expense_category_id is null
        and expense_category_name_snapshot is null)
    );

create or replace function public.enforce_sellertray_expense_category_master()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_category public.sellertray_expense_categories%rowtype;
begin
  if tg_table_name='sellertray_shift_cash_movements' and new.movement_type<>'expense' then
    new.expense_category:=null;
    new.expense_category_id:=null;
    new.expense_category_name_snapshot:=null;
    return new;
  end if;

  if new.expense_category_id is not null then
    select * into v_category
    from public.sellertray_expense_categories c
    where c.tenant_id=new.tenant_id and c.id=new.expense_category_id;
  else
    select * into v_category
    from public.sellertray_expense_categories c
    where c.tenant_id=new.tenant_id
      and lower(btrim(c.name))=lower(btrim(coalesce(new.expense_category,'')))
    limit 1;
  end if;

  if not found then
    raise exception 'Choose a valid Business Expense Category' using errcode='23514';
  end if;
  if not v_category.is_active then
    raise exception 'Choose an active Business Expense Category' using errcode='23514';
  end if;

  new.expense_category_id:=v_category.id;
  new.expense_category:=v_category.name;
  new.expense_category_name_snapshot:=v_category.name;
  return new;
end;
$$;

revoke all on function public.enforce_sellertray_expense_category_master()
  from public,anon,authenticated;

drop trigger if exists enforce_sellertray_business_expense_category_master
  on public.sellertray_business_expenses;
create trigger enforce_sellertray_business_expense_category_master
before insert on public.sellertray_business_expenses
for each row execute function public.enforce_sellertray_expense_category_master();

create trigger enforce_sellertray_shift_expense_category_master
before insert on public.sellertray_shift_cash_movements
for each row execute function public.enforce_sellertray_expense_category_master();

create or replace function public.get_sellertray_expense_category_list(
  p_tenant_id uuid,
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_result jsonb;
begin
  if p_tenant_id is null or v_actor is null then
    raise exception 'Business and authentication are required' using errcode='42501';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_actor;
  if v_role is null then
    raise exception 'You do not have access to this Business' using errcode='42501';
  end if;
  if coalesce(p_include_inactive,false) and v_role not in ('owner','manager') then
    raise exception 'Only the Business Owner or Manager can review inactive Expense Categories'
      using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,
    'name',c.name,
    'isActive',c.is_active,
    'createdAt',c.created_at,
    'updatedAt',c.updated_at
  ) order by lower(c.name),c.id),'[]'::jsonb)
  into v_result
  from public.sellertray_expense_categories c
  where c.tenant_id=p_tenant_id
    and (coalesce(p_include_inactive,false) or c.is_active);

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_expense_category_list(uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_expense_category_list(uuid,boolean)
  to authenticated,service_role;

create or replace function public.create_sellertray_expense_category(
  p_tenant_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_name text:=nullif(btrim(coalesce(p_name,'')),'');
  v_row public.sellertray_expense_categories%rowtype;
begin
  if p_tenant_id is null or v_actor is null or v_name is null then
    raise exception 'Business, category name and authentication are required' using errcode='22023';
  end if;
  if char_length(v_name)>120 then
    raise exception 'Expense Category name is too long' using errcode='22023';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_actor;
  if v_role not in ('owner','manager') then
    raise exception 'Only the Business Owner or Manager can manage Expense Categories'
      using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  insert into public.sellertray_expense_categories(
    tenant_id,name,is_active,created_by_user_id,updated_by_user_id
  ) values(p_tenant_id,v_name,true,v_actor,v_actor)
  returning * into v_row;

  insert into public.sellertray_expense_category_audit(
    tenant_id,category_id,action,new_name,new_active,actor_user_id
  ) values(p_tenant_id,v_row.id,'created',v_row.name,true,v_actor);

  return jsonb_build_object('id',v_row.id,'name',v_row.name,'isActive',v_row.is_active);
exception when unique_violation then
  raise exception 'An Expense Category with this name already exists' using errcode='23505';
end;
$$;

revoke all on function public.create_sellertray_expense_category(uuid,text)
  from public,anon,authenticated;
grant execute on function public.create_sellertray_expense_category(uuid,text)
  to authenticated,service_role;

create or replace function public.rename_sellertray_expense_category(
  p_tenant_id uuid,
  p_category_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_name text:=nullif(btrim(coalesce(p_name,'')),'');
  v_row public.sellertray_expense_categories%rowtype;
  v_previous text;
begin
  if p_tenant_id is null or p_category_id is null or v_actor is null or v_name is null then
    raise exception 'Business, Expense Category, name and authentication are required' using errcode='22023';
  end if;
  if char_length(v_name)>120 then
    raise exception 'Expense Category name is too long' using errcode='22023';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_actor;
  if v_role not in ('owner','manager') then
    raise exception 'Only the Business Owner or Manager can manage Expense Categories'
      using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select c.name into v_previous
  from public.sellertray_expense_categories c
  where c.tenant_id=p_tenant_id and c.id=p_category_id
  for update;
  if not found then
    raise exception 'Expense Category not found' using errcode='22023';
  end if;

  update public.sellertray_expense_categories c
  set name=v_name,updated_by_user_id=v_actor,updated_at=now()
  where c.tenant_id=p_tenant_id and c.id=p_category_id
  returning * into v_row;

  if v_previous is distinct from v_row.name then
    insert into public.sellertray_expense_category_audit(
      tenant_id,category_id,action,previous_name,new_name,
      previous_active,new_active,actor_user_id
    ) values(
      p_tenant_id,p_category_id,'renamed',v_previous,v_row.name,
      v_row.is_active,v_row.is_active,v_actor
    );
  end if;

  return jsonb_build_object('id',v_row.id,'name',v_row.name,'isActive',v_row.is_active);
exception when unique_violation then
  raise exception 'An Expense Category with this name already exists' using errcode='23505';
end;
$$;

revoke all on function public.rename_sellertray_expense_category(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.rename_sellertray_expense_category(uuid,uuid,text)
  to authenticated,service_role;

create or replace function public.set_sellertray_expense_category_active(
  p_tenant_id uuid,
  p_category_id uuid,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_row public.sellertray_expense_categories%rowtype;
  v_previous boolean;
begin
  if p_tenant_id is null or p_category_id is null or v_actor is null or p_is_active is null then
    raise exception 'Business, Expense Category, status and authentication are required' using errcode='22023';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_actor;
  if v_role not in ('owner','manager') then
    raise exception 'Only the Business Owner or Manager can manage Expense Categories'
      using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select c.is_active into v_previous
  from public.sellertray_expense_categories c
  where c.tenant_id=p_tenant_id and c.id=p_category_id
  for update;
  if not found then
    raise exception 'Expense Category not found' using errcode='22023';
  end if;

  update public.sellertray_expense_categories c
  set is_active=p_is_active,updated_by_user_id=v_actor,updated_at=now()
  where c.tenant_id=p_tenant_id and c.id=p_category_id
  returning * into v_row;

  if v_previous is distinct from p_is_active then
    insert into public.sellertray_expense_category_audit(
      tenant_id,category_id,action,previous_name,new_name,
      previous_active,new_active,actor_user_id
    ) values(
      p_tenant_id,p_category_id,
      case when p_is_active then 'activated' else 'deactivated' end,
      v_row.name,v_row.name,v_previous,p_is_active,v_actor
    );
  end if;

  return jsonb_build_object('id',v_row.id,'name',v_row.name,'isActive',v_row.is_active);
end;
$$;

revoke all on function public.set_sellertray_expense_category_active(uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_expense_category_active(uuid,uuid,boolean)
  to authenticated,service_role;

-- Add the same category authority to the existing money-options response so Mobile
-- Business Expense and Merchant Web can resolve the shared list without parallel truth.
create or replace function public.get_sellertray_money_operation_options(
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
  v_user_id uuid:=auth.uid();
  v_role text;
  v_currency text;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role is null then
    raise exception 'SellerTray Business membership required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'You do not have access to this Branch' using errcode='42501';
  end if;

  select upper(coalesce(nullif(btrim(t.currency),''),'NGN')) into v_currency
  from public.tenants t where t.id=p_tenant_id;
  if v_currency is null then
    raise exception 'SellerTray Business not found' using errcode='22023';
  end if;

  return jsonb_build_object(
    'currency',v_currency,
    'canRecordBusinessExpense',
      v_role in ('owner','manager') and public.orderdesk_subscription_can_write(p_tenant_id),
    'expenseCategories',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by lower(c.name),c.id)
      from public.sellertray_expense_categories c
      where c.tenant_id=p_tenant_id and c.is_active=true
    ),'[]'::jsonb),
    'bankAccounts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'displayName',m.display_name,'bankName',m.bank_name,
        'accountName',m.bank_account_name,'accountNumber',m.bank_account_number
      ) order by m.sort_order,m.display_name,m.id)
      from public.merchant_payment_methods m
      where m.tenant_id=p_tenant_id
        and m.method_type='bank_transfer'
        and m.is_enabled=true
    ),'[]'::jsonb),
    'openCashDrawers',case when v_role in ('owner','manager') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'shiftId',s.id,'registerId',s.register_id,'registerName',r.name,
        'cashierUserId',s.opened_by_user_id,'openedAt',s.opened_at,
        'expectedCash',(select x.expected_cash from public.sellertray_cash_shift_totals(s.tenant_id,s.id) x)
      ) order by s.opened_at desc,s.id desc)
      from public.sellertray_cash_shifts s
      join public.sellertray_registers r
        on r.tenant_id=s.tenant_id and r.id=s.register_id
      where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id and s.status='open'
    ),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.get_sellertray_money_operation_options(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_money_operation_options(uuid,uuid)
  to authenticated,service_role;

commit;
