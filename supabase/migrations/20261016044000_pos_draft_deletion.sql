begin;

alter table public.orders
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists deletion_reason text,
  add column if not exists deletion_command_hash text;

alter table public.orders
  drop constraint if exists orders_draft_deletion_state_check,
  add constraint orders_draft_deletion_state_check check (
    (deleted_at is null and deleted_by_user_id is null and deletion_reason is null and deletion_command_hash is null)
    or
    (deleted_at is not null and source='pos' and status='draft'
      and deleted_by_user_id is not null
      and nullif(btrim(coalesce(deletion_reason,'')),'') is not null
      and deletion_command_hash ~ '^[0-9a-f]{32}$')
  );

create index if not exists orders_visible_tenant_created_idx
  on public.orders(tenant_id,created_at desc,id)
  where deleted_at is null;

create or replace function public.prevent_sellertray_deleted_draft_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if old.deleted_at is not null then
    raise exception 'Deleted SellerTray drafts are immutable' using errcode='55000';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_sellertray_deleted_draft_mutation()
  from public,anon,authenticated;

drop trigger if exists prevent_sellertray_deleted_draft_mutation on public.orders;
create trigger prevent_sellertray_deleted_draft_mutation
before update or delete on public.orders
for each row
when (old.deleted_at is not null)
execute function public.prevent_sellertray_deleted_draft_mutation();

create or replace function public.delete_sellertray_pos_draft(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_command_id text := nullif(btrim(coalesce(p_command_id,'')),'');
  v_command_hash text;
begin
  if p_tenant_id is null or p_order_id is null or p_actor_user_id is null
     or v_reason is null or v_command_id is null then
    raise exception 'Business, draft, operator, reason and retry identity are required' using errcode='22023';
  end if;
  if char_length(v_reason)>500 then
    raise exception 'Deletion reason is too long' using errcode='22023';
  end if;
  if char_length(v_command_id)<8 or char_length(v_command_id)>160
     or v_command_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$' then
    raise exception 'Deletion retry identity is invalid' using errcode='22023';
  end if;

  v_command_hash := pg_catalog.md5(p_tenant_id::text||'|'||p_order_id::text||'|'||v_command_id);

  select * into v_order
  from public.orders o
  where o.tenant_id=p_tenant_id and o.id=p_order_id
  for update;

  if not found or v_order.source<>'pos' then
    raise exception 'SellerTray POS draft not found' using errcode='22023';
  end if;
  if v_order.deleted_at is not null then
    if v_order.deletion_command_hash=v_command_hash then
      return jsonb_build_object(
        'orderId',p_order_id,'deleted',true,'deletedAt',v_order.deleted_at,'idempotentReplay',true
      );
    end if;
    raise exception 'This POS draft has already been deleted' using errcode='23514';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;
  if v_order.branch_id is null
     or not public.sellertray_user_can_operate_branch(p_tenant_id,v_order.branch_id,p_actor_user_id) then
    raise exception 'You do not have access to delete drafts from this Branch' using errcode='42501';
  end if;
  if v_order.status<>'draft' or v_order.payment_status<>'unpaid'
     or coalesce(v_order.amount_paid,0)<>0 then
    raise exception 'Only an unpaid POS draft can be deleted' using errcode='23514';
  end if;
  if exists(
    select 1 from public.order_payments p
    where p.tenant_id=p_tenant_id and p.order_id=p_order_id
  ) then
    raise exception 'A POS draft with payment activity cannot be deleted' using errcode='23514';
  end if;
  if exists(
    select 1 from public.inventory_movements im
    where im.tenant_id=p_tenant_id
      and im.reference_type='order'
      and im.reference_id=p_order_id::text
  ) then
    raise exception 'A POS draft with stock activity cannot be deleted' using errcode='23514';
  end if;
  if exists(
    select 1 from public.financial_documents fd
    where fd.tenant_id=p_tenant_id and fd.order_id=p_order_id
  ) then
    raise exception 'A POS draft with financial documents cannot be deleted' using errcode='23514';
  end if;

  update public.orders
  set deleted_at=now(),
      deleted_by_user_id=p_actor_user_id,
      deletion_reason=left(v_reason,500),
      deletion_command_hash=v_command_hash,
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_order_id;

  return jsonb_build_object(
    'orderId',p_order_id,'deleted',true,
    'deletedAt',(select o.deleted_at from public.orders o where o.tenant_id=p_tenant_id and o.id=p_order_id),
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.delete_sellertray_pos_draft(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.delete_sellertray_pos_draft(uuid,uuid,uuid,text,text)
  to service_role;

commit;
