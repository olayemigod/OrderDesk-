begin;

-- One WhatsApp connection remains the business-wide provider connection for this
-- bounded slice. It now has one explicit receiving Branch so inbound commerce
-- never relies on an implicit Main Branch once a merchant has multiple branches.
alter table public.tenant_whatsapp_connections
  add column if not exists branch_id uuid;

update public.tenant_whatsapp_connections c
set branch_id = b.id
from public.branches b
where c.branch_id is null
  and b.tenant_id = c.tenant_id
  and b.is_default = true
  and b.is_active = true;

alter table public.tenant_whatsapp_connections
  add constraint tenant_whatsapp_connections_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict;

alter table public.tenant_whatsapp_connections
  alter column branch_id set not null;

create index if not exists tenant_whatsapp_connections_branch_idx
  on public.tenant_whatsapp_connections(tenant_id,branch_id,connection_status);

-- Preserve the Branch that actually received every inbound WhatsApp message.
alter table public.inbound_messages
  add column if not exists branch_id uuid;

-- Historical messages that already produced an order inherit that order's exact
-- Branch first. Messages without an order fall back to the current routed Branch,
-- then to the business default Branch as a final migration-only fallback.
update public.inbound_messages im
set branch_id = (
  select o.branch_id
  from public.orders o
  where o.tenant_id = im.tenant_id
    and o.source_message_id = im.id
  order by o.created_at asc, o.id asc
  limit 1
)
where im.branch_id is null
  and exists (
    select 1
    from public.orders o
    where o.tenant_id = im.tenant_id
      and o.source_message_id = im.id
  );

update public.inbound_messages im
set branch_id = c.branch_id
from public.tenant_whatsapp_connections c
where im.branch_id is null
  and c.tenant_id = im.tenant_id
  and c.connection_status = 'connected';

update public.inbound_messages im
set branch_id = b.id
from public.branches b
where im.branch_id is null
  and b.tenant_id = im.tenant_id
  and b.is_default = true
  and b.is_active = true;

alter table public.inbound_messages
  add constraint inbound_messages_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict;

alter table public.inbound_messages
  alter column branch_id set not null;

create index if not exists inbound_messages_tenant_branch_customer_received_idx
  on public.inbound_messages(tenant_id,branch_id,customer_id,received_at desc);

create or replace function public.sellertray_user_can_access_branch(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    join public.branches b
      on b.tenant_id = tm.tenant_id
     and b.id = p_branch_id
     and b.is_active = true
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
      and (
        tm.role in ('owner','manager')
        or exists (
          select 1
          from public.branch_user_access bua
          where bua.tenant_id = p_tenant_id
            and bua.branch_id = p_branch_id
            and bua.user_id = p_user_id
            and bua.can_operate = true
        )
        or (
          tm.role = 'staff'
          and b.is_default = true
          and not exists (
            select 1
            from public.branch_user_access any_bua
            where any_bua.tenant_id = p_tenant_id
              and any_bua.user_id = p_user_id
          )
        )
      )
  );
$$;

revoke all on function public.sellertray_user_can_access_branch(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_user_can_access_branch(uuid,uuid,uuid)
  to authenticated,service_role;

create or replace function public.apply_sellertray_inbound_message_branch()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op = 'UPDATE' and new.branch_id is distinct from old.branch_id then
    raise exception 'WhatsApp message Branch is immutable' using errcode='23514';
  end if;

  if new.branch_id is null then
    select c.branch_id into new.branch_id
    from public.tenant_whatsapp_connections c
    where c.tenant_id = new.tenant_id
      and c.connection_status = 'connected'
    limit 1;
  end if;

  if new.branch_id is null then
    select b.id into new.branch_id
    from public.branches b
    where b.tenant_id = new.tenant_id
      and b.is_default = true
      and b.is_active = true
    limit 1;
  end if;

  if new.branch_id is null or not exists (
    select 1
    from public.branches b
    where b.tenant_id = new.tenant_id
      and b.id = new.branch_id
      and b.is_active = true
  ) then
    raise exception 'An active receiving Branch is required for WhatsApp messages'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.apply_sellertray_inbound_message_branch()
  from public,anon,authenticated;

drop trigger if exists apply_sellertray_inbound_message_branch on public.inbound_messages;
create trigger apply_sellertray_inbound_message_branch
before insert or update of tenant_id,branch_id on public.inbound_messages
for each row execute function public.apply_sellertray_inbound_message_branch();

-- WhatsApp orders always inherit the immutable Branch of their source message.
-- Manual/POS callers retain the existing explicit-or-default Branch behavior.
create or replace function public.apply_sellertray_order_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_branch_id uuid;
begin
  if new.source = 'whatsapp' and new.source_message_id is not null then
    select im.branch_id into v_source_branch_id
    from public.inbound_messages im
    where im.tenant_id = new.tenant_id
      and im.id = new.source_message_id;

    if v_source_branch_id is null then
      raise exception 'WhatsApp source message is unavailable for this business'
        using errcode='23503';
    end if;

    if new.branch_id is null then
      new.branch_id := v_source_branch_id;
    elsif new.branch_id <> v_source_branch_id then
      raise exception 'WhatsApp order Branch must match its source message'
        using errcode='23514';
    end if;
  end if;

  if new.branch_id is null then
    select b.id into new.branch_id
    from public.branches b
    where b.tenant_id = new.tenant_id
      and b.is_default = true
      and b.is_active = true
    limit 1;
  end if;

  if new.branch_id is null then
    raise exception 'An active branch is required for this order' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.branches b
    where b.id = new.branch_id
      and b.tenant_id = new.tenant_id
      and b.is_active = true
  ) then
    raise exception 'Selected branch is unavailable for this business' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.apply_sellertray_order_branch() from public,anon,authenticated;

drop trigger if exists apply_sellertray_order_branch on public.orders;
create trigger apply_sellertray_order_branch
before insert or update of tenant_id,branch_id,source,source_message_id on public.orders
for each row execute function public.apply_sellertray_order_branch();

-- Tighten direct message reads to the user's effective Branch scope. Service
-- workers retain service_role access and are unaffected by this RLS policy.
drop policy if exists inbound_messages_select_member on public.inbound_messages;
create policy inbound_messages_select_member
on public.inbound_messages
for select to authenticated
using (
  public.sellertray_user_can_access_branch(
    inbound_messages.tenant_id,
    inbound_messages.branch_id,
    (select auth.uid())
  )
);

-- Route changes are management configuration, not provider credential changes.
-- Owner/Manager may select the active receiving Branch; connection/disconnection
-- remains governed by the existing Owner-only WhatsApp connection boundary.
create or replace function public.set_sellertray_whatsapp_branch(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_connection public.tenant_whatsapp_connections%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = v_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Only business management can change the WhatsApp receiving Branch'
      using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.branches b
    where b.tenant_id = p_tenant_id
      and b.id = p_branch_id
      and b.is_active = true
  ) then
    raise exception 'Selected WhatsApp receiving Branch is unavailable'
      using errcode='23514';
  end if;

  update public.tenant_whatsapp_connections c
  set branch_id = p_branch_id,
      updated_by_user_id = v_user_id,
      updated_at = now()
  where c.tenant_id = p_tenant_id
  returning c.* into v_connection;

  if not found then
    raise exception 'Connect WhatsApp before choosing a receiving Branch'
      using errcode='23514';
  end if;

  return jsonb_build_object(
    'connectionId', v_connection.id,
    'tenantId', v_connection.tenant_id,
    'branchId', v_connection.branch_id,
    'connectionStatus', v_connection.connection_status
  );
end;
$$;

revoke all on function public.set_sellertray_whatsapp_branch(uuid,uuid)
  from public,anon;
grant execute on function public.set_sellertray_whatsapp_branch(uuid,uuid)
  to authenticated;

-- Existing connection creation callers remain compatible. New connections route
-- to the business default Branch until management deliberately selects another.
create or replace function public.apply_sellertray_whatsapp_connection_branch()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.branch_id is null then
    select b.id into new.branch_id
    from public.branches b
    where b.tenant_id = new.tenant_id
      and b.is_default = true
      and b.is_active = true
    limit 1;
  end if;

  if new.branch_id is null or not exists (
    select 1
    from public.branches b
    where b.tenant_id = new.tenant_id
      and b.id = new.branch_id
      and b.is_active = true
  ) then
    raise exception 'An active WhatsApp receiving Branch is required'
      using errcode='23514';
  end if;

  return new;
end;
$$;

revoke all on function public.apply_sellertray_whatsapp_connection_branch()
  from public,anon,authenticated;

drop trigger if exists apply_sellertray_whatsapp_connection_branch
  on public.tenant_whatsapp_connections;
create trigger apply_sellertray_whatsapp_connection_branch
before insert or update of tenant_id,branch_id
on public.tenant_whatsapp_connections
for each row execute function public.apply_sellertray_whatsapp_connection_branch();

-- Read cursors become Branch-specific so reading a customer chat in Branch A can
-- never clear unread work for the same customer in Branch B.
alter table public.merchant_conversation_reads
  add column if not exists branch_id uuid;

update public.merchant_conversation_reads r
set branch_id = b.id
from public.branches b
where r.branch_id is null
  and b.tenant_id = r.tenant_id
  and b.is_default = true
  and b.is_active = true;

alter table public.merchant_conversation_reads
  add constraint merchant_conversation_reads_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade;

alter table public.merchant_conversation_reads
  alter column branch_id set not null;

alter table public.merchant_conversation_reads
  drop constraint if exists merchant_conversation_reads_pkey;
alter table public.merchant_conversation_reads
  add constraint merchant_conversation_reads_pkey
  primary key (tenant_id,user_id,branch_id,customer_id);

drop index if exists public.merchant_conversation_reads_user_idx;
create index merchant_conversation_reads_user_idx
  on public.merchant_conversation_reads(user_id,tenant_id,branch_id,last_read_at desc);

drop policy if exists merchant_conversation_reads_own on public.merchant_conversation_reads;
create policy merchant_conversation_reads_own
on public.merchant_conversation_reads
for all to authenticated
using (
  user_id = (select auth.uid())
  and public.sellertray_user_can_access_branch(
    tenant_id,
    branch_id,
    (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and public.sellertray_user_can_access_branch(
    tenant_id,
    branch_id,
    (select auth.uid())
  )
);

-- New branch-specific read API for the redesigned runtime.
create or replace function public.sellertray_conversation_unread_counts(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table (
  customer_id uuid,
  unread_count bigint,
  latest_received_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.sellertray_user_can_access_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'SellerTray Branch access required' using errcode='42501';
  end if;

  return query
  select im.customer_id,
         count(*) filter (
           where im.received_at > coalesce(r.last_read_at,'epoch'::timestamptz)
         ) as unread_count,
         max(im.received_at) as latest_received_at
  from public.inbound_messages im
  left join public.merchant_conversation_reads r
    on r.tenant_id = im.tenant_id
   and r.user_id = v_user_id
   and r.branch_id = im.branch_id
   and r.customer_id = im.customer_id
  where im.tenant_id = p_tenant_id
    and im.branch_id = p_branch_id
  group by im.customer_id,r.last_read_at;
end;
$$;

revoke all on function public.sellertray_conversation_unread_counts(uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_conversation_unread_counts(uuid,uuid)
  to authenticated,service_role;

create or replace function public.sellertray_mark_conversation_read(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_through timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.sellertray_user_can_access_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'SellerTray Branch access required' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.tenant_id = p_tenant_id
      and c.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  insert into public.merchant_conversation_reads(
    tenant_id,user_id,branch_id,customer_id,last_read_at,updated_at
  ) values (
    p_tenant_id,v_user_id,p_branch_id,p_customer_id,coalesce(p_through,now()),now()
  )
  on conflict (tenant_id,user_id,branch_id,customer_id)
  do update
  set last_read_at = greatest(
        public.merchant_conversation_reads.last_read_at,
        excluded.last_read_at
      ),
      updated_at = now();
end;
$$;

revoke all on function public.sellertray_mark_conversation_read(uuid,uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.sellertray_mark_conversation_read(uuid,uuid,uuid,timestamptz)
  to authenticated;

-- Preserve legacy tenant-wide APIs for the default runtime. They now aggregate
-- only Branches the user may access and maintain one cursor per accessible Branch.
create or replace function public.sellertray_conversation_unread_counts(
  p_tenant_id uuid
)
returns table (
  customer_id uuid,
  unread_count bigint,
  latest_received_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  return query
  select im.customer_id,
         count(*) filter (
           where im.received_at > coalesce(r.last_read_at,'epoch'::timestamptz)
         ) as unread_count,
         max(im.received_at) as latest_received_at
  from public.inbound_messages im
  left join public.merchant_conversation_reads r
    on r.tenant_id = im.tenant_id
   and r.user_id = v_user_id
   and r.branch_id = im.branch_id
   and r.customer_id = im.customer_id
  where im.tenant_id = p_tenant_id
    and public.sellertray_user_can_access_branch(
      im.tenant_id,
      im.branch_id,
      v_user_id
    )
  group by im.customer_id;
end;
$$;

revoke all on function public.sellertray_conversation_unread_counts(uuid)
  from public,anon;
grant execute on function public.sellertray_conversation_unread_counts(uuid)
  to authenticated,service_role;

create or replace function public.sellertray_mark_conversation_read(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_through timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.tenant_id = p_tenant_id
      and c.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  insert into public.merchant_conversation_reads(
    tenant_id,user_id,branch_id,customer_id,last_read_at,updated_at
  )
  select distinct
    im.tenant_id,
    v_user_id,
    im.branch_id,
    im.customer_id,
    coalesce(p_through,now()),
    now()
  from public.inbound_messages im
  where im.tenant_id = p_tenant_id
    and im.customer_id = p_customer_id
    and public.sellertray_user_can_access_branch(
      im.tenant_id,
      im.branch_id,
      v_user_id
    )
  on conflict (tenant_id,user_id,branch_id,customer_id)
  do update
  set last_read_at = greatest(
        public.merchant_conversation_reads.last_read_at,
        excluded.last_read_at
      ),
      updated_at = now();
end;
$$;

revoke all on function public.sellertray_mark_conversation_read(uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.sellertray_mark_conversation_read(uuid,uuid,timestamptz)
  to authenticated;

commit;
