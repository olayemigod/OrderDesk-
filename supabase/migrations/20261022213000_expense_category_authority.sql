begin;

-- SellerTray Expense Category Authority.
-- Expense Category is a merchant-scoped Business master. Transactions keep the
-- category name as an immutable snapshot, while new writes use stable category
-- identity. Typed Cash Out (Bank Deposit / Owner Withdrawal) remains separate.

create or replace function public.sellertray_normalize_expense_category_name(p_name text)
returns text
language sql
immutable
set search_path=''
as $$
  select lower(pg_catalog.regexp_replace(btrim(coalesce(p_name,'')),'\s+',' ','g'));
$$;
revoke all on function public.sellertray_normalize_expense_category_name(text)
  from public,anon,authenticated;
grant execute on function public.sellertray_normalize_expense_category_name(text)
  to service_role;

create table public.sellertray_expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint sellertray_expense_categories_name_check check (
    char_length(name) between 1 and 120
    and name = btrim(pg_catalog.regexp_replace(name,'\s+',' ','g'))
  )
);

create unique index sellertray_expense_categories_tenant_name_unique
  on public.sellertray_expense_categories(
    tenant_id,
    public.sellertray_normalize_expense_category_name(name)
  );
create index sellertray_expense_categories_tenant_active_name_idx
  on public.sellertray_expense_categories(tenant_id,is_active,name,id);

alter table public.sellertray_expense_categories enable row level security;
revoke all on table public.sellertray_expense_categories from public,anon,authenticated;
grant all on table public.sellertray_expense_categories to service_role;

create table public.sellertray_expense_category_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null,
  action text not null check (action in ('create','rename','archive','reactivate')),
  previous_name text,
  new_name text,
  previous_active boolean,
  new_active boolean,
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint sellertray_expense_category_events_category_same_tenant
    foreign key (tenant_id,category_id)
    references public.sellertray_expense_categories(tenant_id,id)
    on delete cascade
);
create index sellertray_expense_category_events_category_created_idx
  on public.sellertray_expense_category_events(tenant_id,category_id,created_at desc,id desc);

alter table public.sellertray_expense_category_events enable row level security;
revoke all on table public.sellertray_expense_category_events from public,anon,authenticated;
grant all on table public.sellertray_expense_category_events to service_role;

create or replace function public.prevent_sellertray_expense_category_event_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE'
     and not exists (select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'SellerTray Expense Category history is immutable' using errcode='55000';
end;
$$;
revoke all on function public.prevent_sellertray_expense_category_event_mutation()
  from public,anon,authenticated;
create trigger prevent_sellertray_expense_category_event_mutation
before update or delete on public.sellertray_expense_category_events
for each row execute function public.prevent_sellertray_expense_category_event_mutation();

alter table public.sellertray_business_expenses
  add column expense_category_id uuid;
alter table public.sellertray_shift_cash_movements
  add column expense_category_id uuid;

with historical as (
  select
    e.tenant_id,
    e.id::text as source_id,
    e.created_at,
    e.actor_user_id,
    btrim(pg_catalog.regexp_replace(e.expense_category,'\s+',' ','g')) as clean_name,
    public.sellertray_normalize_expense_category_name(e.expense_category) as normalized_name
  from public.sellertray_business_expenses e
  where nullif(btrim(e.expense_category),'') is not null
  union all
  select
    m.tenant_id,
    m.id::text as source_id,
    m.created_at,
    m.actor_user_id,
    btrim(pg_catalog.regexp_replace(m.expense_category,'\s+',' ','g')) as clean_name,
    public.sellertray_normalize_expense_category_name(m.expense_category) as normalized_name
  from public.sellertray_shift_cash_movements m
  where m.movement_type='expense'
    and nullif(btrim(m.expense_category),'') is not null
), first_seen as (
  select distinct on (tenant_id,normalized_name)
    tenant_id,
    clean_name,
    actor_user_id,
    created_at
  from historical
  where normalized_name<>''
  order by tenant_id,normalized_name,created_at,source_id
)
insert into public.sellertray_expense_categories(
  tenant_id,name,is_active,created_by_user_id,updated_by_user_id,created_at,updated_at
)
select tenant_id,clean_name,true,actor_user_id,actor_user_id,created_at,created_at
from first_seen
on conflict do nothing;

-- Attach stable identity without changing historical label snapshots.
alter table public.sellertray_business_expenses
  disable trigger prevent_sellertray_business_expense_mutation;
alter table public.sellertray_shift_cash_movements
  disable trigger guard_sellertray_cash_movement_history;

update public.sellertray_business_expenses e
set expense_category_id=c.id
from public.sellertray_expense_categories c
where c.tenant_id=e.tenant_id
  and public.sellertray_normalize_expense_category_name(c.name)
      = public.sellertray_normalize_expense_category_name(e.expense_category)
  and e.expense_category_id is null;

update public.sellertray_shift_cash_movements m
set expense_category_id=c.id
from public.sellertray_expense_categories c
where m.movement_type='expense'
  and c.tenant_id=m.tenant_id
  and public.sellertray_normalize_expense_category_name(c.name)
      = public.sellertray_normalize_expense_category_name(m.expense_category)
  and m.expense_category_id is null;

alter table public.sellertray_business_expenses
  enable trigger prevent_sellertray_business_expense_mutation;
alter table public.sellertray_shift_cash_movements
  enable trigger guard_sellertray_cash_movement_history;

alter table public.sellertray_business_expenses
  alter column expense_category_id set not null,
  add constraint sellertray_business_expenses_category_same_tenant
    foreign key (tenant_id,expense_category_id)
    references public.sellertray_expense_categories(tenant_id,id)
    on delete no action deferrable initially deferred;

alter table public.sellertray_shift_cash_movements
  add constraint sellertray_shift_cash_movements_category_same_tenant
    foreign key (tenant_id,expense_category_id)
    references public.sellertray_expense_categories(tenant_id,id)
    on delete no action deferrable initially deferred,
  add constraint sellertray_shift_cash_movements_category_identity_shape_check
    check (
      (movement_type='expense' and expense_category_id is not null)
      or
      (movement_type<>'expense' and expense_category_id is null)
    );

create index sellertray_business_expenses_category_created_idx
  on public.sellertray_business_expenses(tenant_id,expense_category_id,created_at desc);
create index sellertray_shift_cash_movements_category_created_idx
  on public.sellertray_shift_cash_movements(tenant_id,expense_category_id,created_at desc)
  where expense_category_id is not null;

create or replace function public.resolve_sellertray_business_expense_category()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_category public.sellertray_expense_categories%rowtype;
begin
  if new.expense_category_id is not null then
    select * into v_category
    from public.sellertray_expense_categories c
    where c.tenant_id=new.tenant_id
      and c.id=new.expense_category_id
      and c.is_active=true
    for share;
  else
    select * into v_category
    from public.sellertray_expense_categories c
    where c.tenant_id=new.tenant_id
      and c.is_active=true
      and public.sellertray_normalize_expense_category_name(c.name)
          = public.sellertray_normalize_expense_category_name(new.expense_category)
    for share;
  end if;

  if not found then
    raise exception 'Choose an active Expense Category for this Business'
      using errcode='23514';
  end if;

  new.expense_category_id:=v_category.id;
  new.expense_category:=v_category.name;
  return new;
end;
$$;
revoke all on function public.resolve_sellertray_business_expense_category()
  from public,anon,authenticated;
create trigger resolve_sellertray_business_expense_category
before insert on public.sellertray_business_expenses
for each row execute function public.resolve_sellertray_business_expense_category();

create or replace function public.resolve_sellertray_cash_expense_category()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_category public.sellertray_expense_categories%rowtype;
begin
  if new.movement_type<>'expense' then
    new.expense_category_id:=null;
    new.expense_category:=null;
    return new;
  end if;

  if new.expense_category_id is not null then
    select * into v_category
    from public.sellertray_expense_categories c
    where c.tenant_id=new.tenant_id
      and c.id=new.expense_category_id
      and c.is_active=true
    for share;
  else
    select * into v_category
    from public.sellertray_expense_categories c
    where c.tenant_id=new.tenant_id
      and c.is_active=true
      and public.sellertray_normalize_expense_category_name(c.name)
          = public.sellertray_normalize_expense_category_name(new.expense_category)
    for share;
  end if;

  if not found then
    raise exception 'Choose an active Expense Category for this Business'
      using errcode='23514';
  end if;

  new.expense_category_id:=v_category.id;
  new.expense_category:=v_category.name;
  return new;
end;
$$;
revoke all on function public.resolve_sellertray_cash_expense_category()
  from public,anon,authenticated;
create trigger resolve_sellertray_cash_expense_category
before insert on public.sellertray_shift_cash_movements
for each row execute function public.resolve_sellertray_cash_expense_category();

create or replace function public.guard_sellertray_cash_movement_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    if not exists (select 1 from public.tenants t where t.id=old.tenant_id) then
      return old;
    end if;
    raise exception 'SellerTray cash history is immutable; use a correction'
      using errcode='55000';
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
     and new.expense_category_id is not distinct from old.expense_category_id
     and new.actor_user_id=old.actor_user_id
     and new.created_at=old.created_at
     and new.command_id_hash is not distinct from old.command_id_hash
     and (
       (
         old.superseded_at is null
         and new.superseded_at is not null
         and new.superseded_by_correction_id is not distinct from old.superseded_by_correction_id
       )
       or
       (
         old.superseded_at is not null
         and new.superseded_at is not distinct from old.superseded_at
         and old.superseded_by_correction_id is null
         and new.superseded_by_correction_id is not null
         and exists (
           select 1
           from public.sellertray_shift_cash_movement_corrections c
           where c.tenant_id=old.tenant_id
             and c.id=new.superseded_by_correction_id
             and c.original_movement_id=old.id
         )
       )
     ) then
    return new;
  end if;

  raise exception 'SellerTray cash history is immutable; use a correction'
    using errcode='55000';
end;
$$;
revoke all on function public.guard_sellertray_cash_movement_history()
  from public,anon,authenticated;

create or replace function public.get_sellertray_expense_categories(
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
  v_user_id uuid:=auth.uid();
  v_role text;
  v_can_manage boolean;
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
  if coalesce(p_include_inactive,false) and v_role not in ('owner','manager') then
    raise exception 'Only the Business Owner or Manager can review archived Expense Categories'
      using errcode='42501';
  end if;

  v_can_manage:=v_role in ('owner','manager')
    and public.orderdesk_subscription_can_write(p_tenant_id);

  return jsonb_build_object(
    'canManage',v_can_manage,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,
        'name',c.name,
        'isActive',c.is_active,
        'createdAt',c.created_at,
        'updatedAt',c.updated_at
      ) order by c.is_active desc,lower(c.name),c.id)
      from public.sellertray_expense_categories c
      where c.tenant_id=p_tenant_id
        and (coalesce(p_include_inactive,false) or c.is_active=true)
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_sellertray_expense_categories(uuid,boolean)
  from public,anon;
grant execute on function public.get_sellertray_expense_categories(uuid,boolean)
  to authenticated,service_role;

create or replace function public.manage_sellertray_expense_category(
  p_tenant_id uuid,
  p_action text,
  p_category_id uuid default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_role text;
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_name text:=nullif(btrim(pg_catalog.regexp_replace(coalesce(p_name,''),'\s+',' ','g')),'');
  v_category public.sellertray_expense_categories%rowtype;
  v_previous_name text;
  v_previous_active boolean;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Only the Business Owner or Manager can manage Expense Categories'
      using errcode='42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_action not in ('create','rename','archive','reactivate') then
    raise exception 'Choose create, rename, archive or reactivate' using errcode='22023';
  end if;

  if v_action='create' then
    if v_name is null or char_length(v_name)>120 then
      raise exception 'Expense Category name is required and must be 120 characters or fewer'
        using errcode='22023';
    end if;
    begin
      insert into public.sellertray_expense_categories(
        tenant_id,name,is_active,created_by_user_id,updated_by_user_id
      ) values (
        p_tenant_id,v_name,true,v_user_id,v_user_id
      ) returning * into v_category;
    exception when unique_violation then
      raise exception 'An Expense Category with this name already exists'
        using errcode='23505';
    end;
    insert into public.sellertray_expense_category_events(
      tenant_id,category_id,action,new_name,new_active,actor_user_id
    ) values (p_tenant_id,v_category.id,'create',v_category.name,true,v_user_id);
  else
    if p_category_id is null then
      raise exception 'Expense Category is required' using errcode='22023';
    end if;
    select * into v_category
    from public.sellertray_expense_categories c
    where c.tenant_id=p_tenant_id and c.id=p_category_id
    for update;
    if not found then raise exception 'Expense Category not found' using errcode='P0002'; end if;
    v_previous_name:=v_category.name;
    v_previous_active:=v_category.is_active;

    if v_action='rename' then
      if v_name is null or char_length(v_name)>120 then
        raise exception 'Expense Category name is required and must be 120 characters or fewer'
          using errcode='22023';
      end if;
      begin
        update public.sellertray_expense_categories c
        set name=v_name,updated_by_user_id=v_user_id,updated_at=now()
        where c.tenant_id=p_tenant_id and c.id=p_category_id
        returning * into v_category;
      exception when unique_violation then
        raise exception 'An Expense Category with this name already exists'
          using errcode='23505';
      end;
    elsif v_action='archive' then
      if not v_category.is_active then
        return jsonb_build_object(
          'id',v_category.id,'name',v_category.name,'isActive',v_category.is_active,'changed',false
        );
      end if;
      update public.sellertray_expense_categories c
      set is_active=false,updated_by_user_id=v_user_id,updated_at=now()
      where c.tenant_id=p_tenant_id and c.id=p_category_id
      returning * into v_category;
    else
      if v_category.is_active then
        return jsonb_build_object(
          'id',v_category.id,'name',v_category.name,'isActive',v_category.is_active,'changed',false
        );
      end if;
      update public.sellertray_expense_categories c
      set is_active=true,updated_by_user_id=v_user_id,updated_at=now()
      where c.tenant_id=p_tenant_id and c.id=p_category_id
      returning * into v_category;
    end if;

    if v_previous_name is not distinct from v_category.name
       and v_previous_active is not distinct from v_category.is_active then
      return jsonb_build_object(
        'id',v_category.id,'name',v_category.name,'isActive',v_category.is_active,'changed',false
      );
    end if;

    insert into public.sellertray_expense_category_events(
      tenant_id,category_id,action,previous_name,new_name,previous_active,new_active,actor_user_id
    ) values (
      p_tenant_id,v_category.id,v_action,v_previous_name,v_category.name,
      v_previous_active,v_category.is_active,v_user_id
    );
  end if;

  return jsonb_build_object(
    'id',v_category.id,
    'name',v_category.name,
    'isActive',v_category.is_active,
    'changed',true
  );
end;
$$;
revoke all on function public.manage_sellertray_expense_category(uuid,text,uuid,text)
  from public,anon;
grant execute on function public.manage_sellertray_expense_category(uuid,text,uuid,text)
  to authenticated,service_role;

create or replace function public.record_sellertray_shift_cash_movement(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_expense_category_id uuid,
  p_command_id text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_type text:=lower(btrim(coalesce(p_movement_type,'')));
  v_command_id text:=nullif(btrim(coalesce(p_command_id,'')),'');
  v_reference text:=nullif(btrim(coalesce(p_reference,'')),'');
  v_category_name text;
  v_existing_id uuid;
  v_existing_category_id uuid;
begin
  if v_type='expense' then
    if p_expense_category_id is null then
      raise exception 'Expense Category is required' using errcode='22023';
    end if;

    if v_command_id is not null then
      select m.id,m.expense_category_id,m.expense_category
      into v_existing_id,v_existing_category_id,v_category_name
      from public.sellertray_shift_cash_movements m
      where m.tenant_id=p_tenant_id
        and m.command_id_hash=pg_catalog.md5(p_tenant_id::text||'|'||v_command_id)
      limit 1;
      if found and v_existing_category_id is distinct from p_expense_category_id then
        raise exception 'Cash activity retry identity is already used for different facts'
          using errcode='23505';
      end if;
    end if;

    if v_existing_id is null and v_reference is not null then
      select m.id,m.expense_category_id,m.expense_category
      into v_existing_id,v_existing_category_id,v_category_name
      from public.sellertray_shift_cash_movements m
      where m.tenant_id=p_tenant_id
        and m.shift_id=p_shift_id
        and m.movement_type='expense'
        and m.superseded_at is null
        and lower(btrim(m.reference))=lower(v_reference)
      limit 1;
      if found and v_existing_category_id is distinct from p_expense_category_id then
        raise exception 'This cash reference is already used for different facts'
          using errcode='23505';
      end if;
    end if;

    if v_existing_id is null then
      select c.name into v_category_name
      from public.sellertray_expense_categories c
      where c.tenant_id=p_tenant_id
        and c.id=p_expense_category_id
        and c.is_active=true
      for share;
      if not found then
        raise exception 'Choose an active Expense Category for this Business'
          using errcode='23514';
      end if;
    end if;
  elsif p_expense_category_id is not null then
    raise exception 'Expense Category applies only to Expense cash activity'
      using errcode='22023';
  end if;

  return public.record_sellertray_shift_cash_movement(
    p_tenant_id,p_shift_id,p_movement_type,p_amount,p_reference,p_reason,
    v_category_name,p_command_id,p_actor_user_id
  );
end;
$$;
revoke all on function public.record_sellertray_shift_cash_movement(
  uuid,uuid,text,numeric,text,text,uuid,text,uuid
) from public,anon,authenticated;
grant execute on function public.record_sellertray_shift_cash_movement(
  uuid,uuid,text,numeric,text,text,uuid,text,uuid
) to service_role;

create or replace function public.record_sellertray_business_expense(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_funding_source text,
  p_payment_method_id uuid,
  p_cash_shift_id uuid,
  p_expense_category_id uuid,
  p_amount numeric,
  p_reference text,
  p_reason text,
  p_command_id text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_command_id text:=nullif(btrim(coalesce(p_command_id,'')),'');
  v_category_name text;
  v_existing_id uuid;
  v_existing_category_id uuid;
begin
  if p_expense_category_id is null then
    raise exception 'Expense Category is required' using errcode='22023';
  end if;

  if v_command_id is not null then
    select e.id,e.expense_category_id,e.expense_category
    into v_existing_id,v_existing_category_id,v_category_name
    from public.sellertray_business_expenses e
    where e.tenant_id=p_tenant_id
      and e.command_id_hash=pg_catalog.md5(p_tenant_id::text||'|business-expense|'||v_command_id)
    limit 1;
    if found and v_existing_category_id is distinct from p_expense_category_id then
      raise exception 'Business Expense retry identity is already used for different facts'
        using errcode='23505';
    end if;
  end if;

  if v_existing_id is null then
    select c.name into v_category_name
    from public.sellertray_expense_categories c
    where c.tenant_id=p_tenant_id
      and c.id=p_expense_category_id
      and c.is_active=true
    for share;
    if not found then
      raise exception 'Choose an active Expense Category for this Business'
        using errcode='23514';
    end if;
  end if;

  return public.record_sellertray_business_expense(
    p_tenant_id,p_branch_id,p_funding_source,p_payment_method_id,p_cash_shift_id,
    v_category_name,p_amount,p_reference,p_reason,p_command_id,p_actor_user_id
  );
end;
$$;
revoke all on function public.record_sellertray_business_expense(
  uuid,uuid,text,uuid,uuid,uuid,numeric,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.record_sellertray_business_expense(
  uuid,uuid,text,uuid,uuid,uuid,numeric,text,text,text,uuid
) to service_role;

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
  p_replacement_expense_category_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_kind text:=lower(btrim(coalesce(p_correction_kind,'')));
  v_type text:=lower(btrim(coalesce(p_replacement_type,'')));
  v_command_id text:=nullif(btrim(coalesce(p_command_id,'')),'');
  v_category_name text;
  v_existing_correction_id uuid;
  v_existing_category_id uuid;
begin
  if v_kind='replace' and v_type='expense' then
    if p_replacement_expense_category_id is null then
      raise exception 'Expense Category is required' using errcode='22023';
    end if;

    if v_command_id is not null then
      select c.id,m.expense_category_id,m.expense_category
      into v_existing_correction_id,v_existing_category_id,v_category_name
      from public.sellertray_shift_cash_movement_corrections c
      left join public.sellertray_shift_cash_movements m
        on m.tenant_id=c.tenant_id and m.id=c.replacement_movement_id
      where c.tenant_id=p_tenant_id
        and c.command_id_hash=pg_catalog.md5(p_tenant_id::text||'|'||p_shift_id::text||'|'||v_command_id)
      limit 1;
      if found and v_existing_category_id is distinct from p_replacement_expense_category_id then
        raise exception 'Cash correction retry identity is already used for different facts'
          using errcode='23505';
      end if;
    end if;

    if v_existing_correction_id is null then
      select c.name into v_category_name
      from public.sellertray_expense_categories c
      where c.tenant_id=p_tenant_id
        and c.id=p_replacement_expense_category_id
        and c.is_active=true
      for share;
      if not found then
        raise exception 'Choose an active Expense Category for this Business'
          using errcode='23514';
      end if;
    end if;
  elsif p_replacement_expense_category_id is not null then
    raise exception 'Replacement Expense Category applies only to an Expense replacement'
      using errcode='22023';
  end if;

  return public.correct_sellertray_shift_cash_movement(
    p_tenant_id,p_shift_id,p_movement_id,p_correction_kind,p_correction_reason,
    p_command_id,p_replacement_type,p_replacement_amount,p_replacement_reference,
    p_replacement_reason,v_category_name,p_actor_user_id
  );
end;
$$;
revoke all on function public.correct_sellertray_shift_cash_movement(
  uuid,uuid,uuid,text,text,text,text,numeric,text,text,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.correct_sellertray_shift_cash_movement(
  uuid,uuid,uuid,text,text,text,text,numeric,text,text,uuid,uuid
) to service_role;

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
      where m.tenant_id=p_tenant_id and m.method_type='bank_transfer' and m.is_enabled=true
    ),'[]'::jsonb),
    'openCashDrawers',case when v_role in ('owner','manager') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'shiftId',s.id,'registerId',s.register_id,'registerName',r.name,
        'cashierUserId',s.opened_by_user_id,'openedAt',s.opened_at,
        'expectedCash',(select x.expected_cash from public.sellertray_cash_shift_totals(s.tenant_id,s.id) x)
      ) order by s.opened_at desc,s.id desc)
      from public.sellertray_cash_shifts s
      join public.sellertray_registers r on r.tenant_id=s.tenant_id and r.id=s.register_id
      where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id and s.status='open'
    ),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
revoke all on function public.get_sellertray_money_operation_options(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_money_operation_options(uuid,uuid)
  to authenticated,service_role;

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
  v_user_id uuid:=(select auth.uid());
  v_role text;
  v_shift public.sellertray_cash_shifts%rowtype;
  v_register_name text;
  v_totals record;
  v_movements jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  select * into v_shift from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id;
  if not found then return null; end if;
  if not public.sellertray_user_can_read_branch(p_tenant_id,v_shift.branch_id,v_user_id) then
    raise exception 'You do not have access to this cashier shift' using errcode='42501';
  end if;
  select tm.role into v_role from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;
  if v_role='staff' and v_shift.opened_by_user_id<>v_user_id then
    raise exception 'Staff can view only their own cashier shifts' using errcode='42501';
  end if;
  select r.name into v_register_name from public.sellertray_registers r
  where r.tenant_id=p_tenant_id and r.id=v_shift.register_id;
  select * into v_totals from public.sellertray_cash_shift_totals(p_tenant_id,p_shift_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'movementId',m.id,'movementType',m.movement_type,'amount',m.amount,'currency',m.currency,
    'reference',m.reference,'reason',m.reason,'expenseCategory',m.expense_category,
    'expenseCategoryId',m.expense_category_id,'actorUserId',m.actor_user_id,'createdAt',m.created_at
  ) order by m.created_at desc,m.id desc),'[]'::jsonb)
  into v_movements
  from public.sellertray_shift_cash_movements m
  where m.tenant_id=p_tenant_id and m.shift_id=p_shift_id and m.superseded_at is null;

  return jsonb_build_object(
    'shiftId',v_shift.id,'branchId',v_shift.branch_id,'registerId',v_shift.register_id,
    'registerName',v_register_name,'status',v_shift.status,'currency',v_shift.currency,
    'openingCash',v_totals.opening_cash,'cashSales',v_totals.cash_sales,
    'cashRefunds',v_totals.cash_refunds,'cashIn',v_totals.cash_in,'cashOut',v_totals.cash_out,
    'expenses',v_totals.expenses,
    'expectedCash',case when v_shift.status='open' then v_totals.expected_cash else v_shift.expected_cash end,
    'declaredCash',v_shift.declared_cash,'variance',v_shift.variance,'closeNote',v_shift.close_note,
    'reviewDecision',v_shift.review_decision,'reviewNote',v_shift.review_note,
    'openedByUserId',v_shift.opened_by_user_id,'openedAt',v_shift.opened_at,
    'closedAt',v_shift.closed_at,'reviewedAt',v_shift.reviewed_at,'movements',v_movements
  );
end;
$$;
revoke all on function public.get_sellertray_cash_shift(uuid,uuid) from public,anon;
grant execute on function public.get_sellertray_cash_shift(uuid,uuid) to authenticated;

create or replace function public.get_sellertray_cash_shift_management_detail_with_categories(
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
  v_result jsonb;
  v_movements jsonb;
begin
  v_result:=public.get_sellertray_cash_shift_management_detail(p_tenant_id,p_shift_id);
  if v_result is null then return null; end if;

  select coalesce(jsonb_agg(
    movement.value || jsonb_build_object('expenseCategoryId',m.expense_category_id)
    order by movement.ordinality
  ),'[]'::jsonb)
  into v_movements
  from jsonb_array_elements(coalesce(v_result->'movements','[]'::jsonb))
       with ordinality as movement(value,ordinality)
  left join public.sellertray_shift_cash_movements m
    on m.tenant_id=p_tenant_id
   and m.id=nullif(movement.value->>'movementId','')::uuid;

  return jsonb_set(v_result,'{movements}',v_movements,true);
end;
$$;
revoke all on function public.get_sellertray_cash_shift_management_detail_with_categories(uuid,uuid)
  from public,anon;
grant execute on function public.get_sellertray_cash_shift_management_detail_with_categories(uuid,uuid)
  to authenticated,service_role;

commit;
