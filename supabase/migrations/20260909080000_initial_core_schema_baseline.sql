-- SellerTray / historical OrderDesk initial schema baseline.
-- This captures only the core schema that existed before the first tracked
-- incremental migration. Later migrations remain authoritative for all
-- subsequent feature evolution.

create extension if not exists pgcrypto with schema extensions;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  whatsapp_phone_number_id text unique,
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff'
    check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id,user_id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  wa_id text not null,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text,
  unique (tenant_id,id),
  unique (tenant_id,wa_id)
);

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  provider_message_id text not null unique,
  message_type text not null,
  text_body text,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint inbound_messages_customer_same_tenant
    foreign key (tenant_id,customer_id)
    references public.customers(tenant_id,id)
    on delete cascade
);

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sku text,
  price_ngn numeric(14,2)
    check (price_ngn is null or price_ngn >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,sku)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  source_message_id uuid,
  status text not null default 'needs_review'
    check (status in ('draft','needs_review','accepted','rejected','processing','ready','completed','cancelled')),
  source text not null default 'whatsapp'
    check (source in ('whatsapp','manual')),
  customer_note text,
  parser_confidence numeric(5,4)
    check (parser_confidence is null or (parser_confidence >= 0 and parser_confidence <= 1)),
  currency text not null default 'NGN',
  total_amount numeric(14,2)
    check (total_amount is null or total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint orders_customer_same_tenant
    foreign key (tenant_id,customer_id)
    references public.customers(tenant_id,id)
    on delete restrict,
  constraint orders_source_message_same_tenant
    foreign key (tenant_id,source_message_id)
    references public.inbound_messages(tenant_id,id)
    on delete restrict
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  catalog_item_id uuid,
  item_name text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(14,2)
    check (unit_price is null or unit_price >= 0),
  line_total numeric(14,2)
    generated always as (
      case when unit_price is null then null::numeric else quantity * unit_price end
    ) stored,
  created_at timestamptz not null default now(),
  constraint order_items_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete cascade,
  constraint order_items_catalog_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete restrict
);

create index tenant_members_user_idx on public.tenant_members(user_id);
create index customers_tenant_created_idx on public.customers(tenant_id,created_at desc);
create index inbound_messages_tenant_customer_received_idx
  on public.inbound_messages(tenant_id,customer_id,received_at desc);
create index catalog_items_tenant_active_name_idx
  on public.catalog_items(tenant_id,is_active,name);
create index orders_tenant_status_created_idx
  on public.orders(tenant_id,status,created_at desc);
create index orders_customer_created_idx
  on public.orders(tenant_id,customer_id,created_at desc);
create index order_items_order_idx
  on public.order_items(tenant_id,order_id);

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.customers enable row level security;
alter table public.inbound_messages enable row level security;
alter table public.catalog_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on table public.tenants from anon,authenticated;
revoke all on table public.tenant_members from anon,authenticated;
revoke all on table public.customers from anon,authenticated;
revoke all on table public.inbound_messages from anon,authenticated;
revoke all on table public.catalog_items from anon,authenticated;
revoke all on table public.orders from anon,authenticated;
revoke all on table public.order_items from anon,authenticated;

grant all on table public.tenants to service_role;
grant all on table public.tenant_members to service_role;
grant all on table public.customers to service_role;
grant all on table public.inbound_messages to service_role;
grant all on table public.catalog_items to service_role;
grant all on table public.orders to service_role;
grant all on table public.order_items to service_role;

grant select,update on table public.tenants to authenticated;
grant select on table public.tenant_members to authenticated;
grant select,insert,update on table public.customers to authenticated;
grant select on table public.inbound_messages to authenticated;
grant select,insert,update on table public.catalog_items to authenticated;
grant select,insert,update on table public.orders to authenticated;
grant select,insert,update,delete on table public.order_items to authenticated;

create policy tenants_select_member
on public.tenants for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=tenants.id
      and tm.user_id=(select auth.uid())
  )
);

create policy tenant_members_select_own
on public.tenant_members for select to authenticated
using ((select auth.uid())=user_id);

create policy customers_select_member
on public.customers for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=customers.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy customers_insert_member
on public.customers for insert to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=customers.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy customers_update_member
on public.customers for update to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=customers.tenant_id
      and tm.user_id=(select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=customers.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy inbound_messages_select_member
on public.inbound_messages for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=inbound_messages.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy catalog_items_select_member
on public.catalog_items for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=catalog_items.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy catalog_items_insert_member
on public.catalog_items for insert to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=catalog_items.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy catalog_items_update_member
on public.catalog_items for update to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=catalog_items.tenant_id
      and tm.user_id=(select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=catalog_items.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy orders_select_member
on public.orders for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=orders.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy orders_insert_member
on public.orders for insert to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=orders.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy orders_update_member
on public.orders for update to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=orders.tenant_id
      and tm.user_id=(select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=orders.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy order_items_select_member
on public.order_items for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=order_items.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy order_items_insert_member
on public.order_items for insert to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=order_items.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy order_items_update_member
on public.order_items for update to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=order_items.tenant_id
      and tm.user_id=(select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=order_items.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy order_items_delete_member
on public.order_items for delete to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=order_items.tenant_id
      and tm.user_id=(select auth.uid())
  )
);
