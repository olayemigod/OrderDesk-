begin;

alter table public.orders
  add column if not exists pos_operator_user_id uuid,
  add column if not exists pos_operator_name text;

alter table public.orders
  drop constraint if exists orders_pos_operator_snapshot_check,
  add constraint orders_pos_operator_snapshot_check check (
    (pos_operator_user_id is null and pos_operator_name is null)
    or (
      pos_operator_user_id is not null
      and pos_operator_name is not null
      and char_length(btrim(pos_operator_name)) between 1 and 120
    )
  );

create or replace function public.guard_sellertray_pos_operator_snapshot()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if old.pos_operator_user_id is not null then
    if new.pos_operator_user_id is distinct from old.pos_operator_user_id
       or new.pos_operator_name is distinct from old.pos_operator_name then
      raise exception 'POS cashier attribution is immutable' using errcode='55000';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_sellertray_pos_operator_snapshot() from public,anon,authenticated;

drop trigger if exists guard_sellertray_pos_operator_snapshot on public.orders;
create trigger guard_sellertray_pos_operator_snapshot
before update of pos_operator_user_id,pos_operator_name on public.orders
for each row execute function public.guard_sellertray_pos_operator_snapshot();

create or replace function public.set_sellertray_pos_operator_snapshot(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_name text;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null then
    raise exception 'Business, sale and cashier are required' using errcode='22023';
  end if;

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;

  if not found then
    raise exception 'SellerTray sale not found' using errcode='22023';
  end if;
  if v_order.source<>'pos' then
    raise exception 'Cashier attribution is only valid for POS sales' using errcode='23514';
  end if;
  if not exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id
  ) then
    raise exception 'SellerTray tenant membership required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to sell from this branch' using errcode='42501';
  end if;

  if v_order.pos_operator_user_id is not null then
    if v_order.pos_operator_user_id<>p_actor_user_id then
      raise exception 'This POS sale is already attributed to another cashier' using errcode='23514';
    end if;
    return jsonb_build_object(
      'orderId',v_order.id,
      'cashierUserId',v_order.pos_operator_user_id,
      'cashierName',v_order.pos_operator_name,
      'idempotentReplay',true
    );
  end if;

  select nullif(
    btrim(
      regexp_replace(
        coalesce(
          u.raw_user_meta_data->>'full_name',
          u.raw_user_meta_data->>'name',
          u.email,
          'Cashier'
        ),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  ) into v_name
  from auth.users u
  where u.id=p_actor_user_id;

  v_name := left(coalesce(v_name,'Cashier'),120);

  update public.orders
  set pos_operator_user_id=p_actor_user_id,
      pos_operator_name=v_name
  where tenant_id=p_tenant_id and id=p_order_id
  returning * into v_order;

  return jsonb_build_object(
    'orderId',v_order.id,
    'cashierUserId',v_order.pos_operator_user_id,
    'cashierName',v_order.pos_operator_name,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.set_sellertray_pos_operator_snapshot(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.set_sellertray_pos_operator_snapshot(uuid,uuid,uuid)
  to service_role;

create or replace function public.sellertray_snapshot_receipt_pos_operator()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_operator_name text;
begin
  if new.job_type='receipt' and new.order_id is not null then
    select o.pos_operator_name into v_operator_name
    from public.orders o
    where o.tenant_id=new.tenant_id and o.id=new.order_id;

    if v_operator_name is not null then
      new.content_snapshot := new.content_snapshot
        || jsonb_build_object('cashierName',v_operator_name);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sellertray_snapshot_receipt_pos_operator()
  from public,anon,authenticated;
grant execute on function public.sellertray_snapshot_receipt_pos_operator()
  to service_role;

drop trigger if exists sellertray_snapshot_receipt_pos_operator on public.sellertray_print_jobs;
create trigger sellertray_snapshot_receipt_pos_operator
before insert on public.sellertray_print_jobs
for each row execute function public.sellertray_snapshot_receipt_pos_operator();

commit;
