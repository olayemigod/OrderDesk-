begin;

-- Business Expense categories are Business-scoped master data. Expense history
-- keeps the selected label snapshot, while new expenses must resolve through the
-- governed active master so Merchant Web, Mobile and future channels share one truth.

create table public.sellertray_expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint sellertray_expense_categories_name_check
    check (char_length(btrim(name)) between 1 and 120)
);

create unique index sellertray_expense_categories_tenant_name_unique
  on public.sellertray_expense_categories (tenant_id, lower(btrim(name)));
create index sellertray_expense_categories_tenant_active_name_idx
  on public.sellertray_expense_categories (tenant_id, is_active, lower(btrim(name)));

alter table public.sellertray_expense_categories enable row level security;
revoke all on table public.sellertray_expense_categories from public, anon, authenticated;
grant all on table public.sellertray_expense_categories to service_role;

-- Preserve every category already used in immutable Business Expense history.
insert into public.sellertray_expense_categories (
  tenant_id,
  name,
  is_active,
  created_by,
  created_at
)
select distinct on (e.tenant_id, lower(btrim(e.expense_category)))
  e.tenant_id,
  btrim(e.expense_category),
  true,
  e.actor_user_id,
  e.created_at
from public.sellertray_business_expenses e
where nullif(btrim(e.expense_category), '') is not null
order by e.tenant_id, lower(btrim(e.expense_category)), e.created_at, e.id
on conflict do nothing;

create or replace function public.get_sellertray_expense_category_list(
  p_tenant_id uuid,
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if p_tenant_id is null then
    raise exception 'Business is required' using errcode = '22023';
  end if;
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = v_actor
  ) then
    raise exception 'You do not have access to this Business' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'isActive', c.is_active,
        'createdAt', c.created_at
      )
      order by lower(c.name), c.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.sellertray_expense_categories c
  where c.tenant_id = p_tenant_id
    and (p_include_inactive or c.is_active);

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_expense_category_list(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.get_sellertray_expense_category_list(uuid, boolean)
  to authenticated, service_role;

create or replace function public.create_sellertray_expense_category(
  p_tenant_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_row public.sellertray_expense_categories%rowtype;
begin
  if p_tenant_id is null or v_name is null then
    raise exception 'Business and category name are required' using errcode = '22023';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Expense category name is too long' using errcode = '22023';
  end if;
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = v_actor;

  if v_role not in ('owner', 'manager') then
    raise exception 'Only the Business Owner or Manager can manage Expense Categories' using errcode = '42501';
  end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode = '42501';
  end if;

  insert into public.sellertray_expense_categories (
    tenant_id,
    name,
    is_active,
    created_by
  ) values (
    p_tenant_id,
    v_name,
    true,
    v_actor
  )
  on conflict (tenant_id, (lower(btrim(name)))) do nothing
  returning * into v_row;

  if not found then
    select * into v_row
    from public.sellertray_expense_categories c
    where c.tenant_id = p_tenant_id
      and lower(btrim(c.name)) = lower(v_name)
    limit 1;
  end if;

  if not v_row.is_active then
    raise exception 'This Expense Category is inactive' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'isActive', v_row.is_active,
    'createdAt', v_row.created_at
  );
end;
$$;

revoke all on function public.create_sellertray_expense_category(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_sellertray_expense_category(uuid, text)
  to authenticated, service_role;

create or replace function public.enforce_sellertray_business_expense_category_master()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select c.name into v_name
  from public.sellertray_expense_categories c
  where c.tenant_id = new.tenant_id
    and c.is_active
    and lower(btrim(c.name)) = lower(btrim(new.expense_category))
  limit 1;

  if v_name is null then
    raise exception 'Choose an active Business Expense category' using errcode = '23514';
  end if;

  new.expense_category := v_name;
  return new;
end;
$$;

revoke all on function public.enforce_sellertray_business_expense_category_master()
  from public, anon, authenticated;

create trigger enforce_sellertray_business_expense_category_master
before insert on public.sellertray_business_expenses
for each row execute function public.enforce_sellertray_business_expense_category_master();

commit;
