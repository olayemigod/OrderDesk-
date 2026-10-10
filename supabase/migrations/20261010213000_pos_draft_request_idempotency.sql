begin;

create table public.sellertray_pos_draft_requests (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null,
  order_id uuid not null,
  request_fingerprint text not null check (char_length(request_fingerprint)=64),
  created_at timestamptz not null default now(),
  primary key (tenant_id,request_id),
  unique (tenant_id,order_id),
  constraint sellertray_pos_draft_requests_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete cascade
);

create index sellertray_pos_draft_requests_created_idx
  on public.sellertray_pos_draft_requests(tenant_id,created_at desc);

alter table public.sellertray_pos_draft_requests enable row level security;
revoke all on table public.sellertray_pos_draft_requests from public,anon,authenticated;
grant all on table public.sellertray_pos_draft_requests to service_role;

create policy sellertray_pos_draft_requests_deny_clients
on public.sellertray_pos_draft_requests
for all to anon,authenticated
using(false)
with check(false);

create or replace function public.prevent_sellertray_pos_draft_request_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' and not exists(
    select 1 from public.tenants t where t.id=old.tenant_id
  ) then
    return old;
  end if;
  raise exception 'SellerTray POS request history is immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_pos_draft_request_mutation()
  from public,anon,authenticated;

drop trigger if exists prevent_sellertray_pos_draft_request_update
  on public.sellertray_pos_draft_requests;
create trigger prevent_sellertray_pos_draft_request_update
before update on public.sellertray_pos_draft_requests
for each row execute function public.prevent_sellertray_pos_draft_request_mutation();

drop trigger if exists prevent_sellertray_pos_draft_request_delete
  on public.sellertray_pos_draft_requests;
create trigger prevent_sellertray_pos_draft_request_delete
before delete on public.sellertray_pos_draft_requests
for each row execute function public.prevent_sellertray_pos_draft_request_mutation();

create or replace function public.create_sellertray_pos_order_idempotent(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
  v_existing_order_id uuid;
  v_existing_fingerprint text;
  v_customer_name text;
  v_customer_phone text;
  v_note text;
  v_request_material jsonb;
  v_fingerprint text;
begin
  if p_tenant_id is null or p_request_id is null then
    raise exception 'Business and request are required' using errcode='22023';
  end if;

  v_customer_name:=nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_customer_name,'')),'\s+',' ','g'),'');
  v_customer_phone:=nullif(pg_catalog.btrim(coalesce(p_customer_phone,'')),'');
  v_note:=nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_note,'')),'\s+',' ','g'),'');

  v_request_material:=jsonb_build_object(
    'branchId',p_branch_id,
    'customerName',v_customer_name,
    'customerPhone',v_customer_phone,
    'note',v_note,
    'items',p_items
  );
  v_fingerprint:=pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_request_material::text,'UTF8')),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text||':'||p_request_id::text,0)
  );

  select r.order_id,r.request_fingerprint
  into v_existing_order_id,v_existing_fingerprint
  from public.sellertray_pos_draft_requests r
  where r.tenant_id=p_tenant_id
    and r.request_id=p_request_id;

  if found then
    if v_existing_fingerprint<>v_fingerprint then
      raise exception 'SellerTray POS request key was already used for different sale details'
        using errcode='23505';
    end if;

    if not exists(
      select 1 from public.orders o
      where o.tenant_id=p_tenant_id and o.id=v_existing_order_id
    ) then
      raise exception 'SellerTray POS request has inconsistent order state' using errcode='23514';
    end if;

    return jsonb_build_object(
      'orderId',v_existing_order_id,
      'idempotentReplay',true
    );
  end if;

  v_order_id:=public.create_sellertray_pos_order_atomic(
    p_tenant_id,
    p_branch_id,
    v_customer_name,
    v_customer_phone,
    v_note,
    p_items
  );

  insert into public.sellertray_pos_draft_requests(
    tenant_id,request_id,order_id,request_fingerprint
  ) values(
    p_tenant_id,p_request_id,v_order_id,v_fingerprint
  );

  return jsonb_build_object(
    'orderId',v_order_id,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.create_sellertray_pos_order_idempotent(
  uuid,uuid,text,text,text,jsonb,uuid
) from public,anon,authenticated;
grant execute on function public.create_sellertray_pos_order_idempotent(
  uuid,uuid,text,text,text,jsonb,uuid
) to service_role;

commit;
