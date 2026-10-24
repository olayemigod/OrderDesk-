begin;

create table public.sellertray_pos_draft_requests (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_reference uuid not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id,client_reference),
  unique (order_id)
);

create index sellertray_pos_draft_requests_created_idx
  on public.sellertray_pos_draft_requests(tenant_id,created_at desc);

alter table public.sellertray_pos_draft_requests enable row level security;
revoke all on table public.sellertray_pos_draft_requests from public,anon,authenticated;
grant all on table public.sellertray_pos_draft_requests to service_role;

create or replace function public.create_sellertray_pos_order_idempotent(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_note text,
  p_items jsonb,
  p_client_reference uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_fingerprint text;
  v_existing_order_id uuid;
  v_existing_fingerprint text;
  v_order_id uuid;
begin
  if p_client_reference is null then
    raise exception 'Sale reference is required' using errcode='22023';
  end if;

  -- Serialize retries for the same tenant/reference. The advisory lock exists
  -- only for this transaction and prevents two concurrent replays from creating
  -- separate draft orders before the unique request row becomes visible.
  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(p_client_reference::text)
  );

  v_fingerprint := md5(jsonb_build_object(
    'branchId',p_branch_id,
    'customerName',p_customer_name,
    'customerPhone',p_customer_phone,
    'note',p_note,
    'items',p_items
  )::text);

  select r.order_id,r.payload_fingerprint
  into v_existing_order_id,v_existing_fingerprint
  from public.sellertray_pos_draft_requests r
  where r.tenant_id=p_tenant_id
    and r.client_reference=p_client_reference;

  if v_existing_order_id is not null then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'Sale reference was reused with different details'
        using errcode='23505';
    end if;
    return v_existing_order_id;
  end if;

  v_order_id := public.create_sellertray_pos_order_atomic(
    p_tenant_id,
    p_branch_id,
    p_customer_name,
    p_customer_phone,
    p_note,
    p_items
  );

  insert into public.sellertray_pos_draft_requests(
    tenant_id,client_reference,order_id,payload_fingerprint
  ) values(
    p_tenant_id,p_client_reference,v_order_id,v_fingerprint
  );

  return v_order_id;
end;
$$;

revoke all on function public.create_sellertray_pos_order_idempotent(
  uuid,uuid,text,text,text,jsonb,uuid
) from public,anon,authenticated;
grant execute on function public.create_sellertray_pos_order_idempotent(
  uuid,uuid,text,text,text,jsonb,uuid
) to service_role;

commit;