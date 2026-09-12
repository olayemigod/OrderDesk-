-- SellerTray Build 7 P1: merchant-owned payment-method settings.
-- Safe metadata is public-to-tenant under RLS. Gateway secrets stay in sellertray_private.

begin;

create table public.merchant_payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  method_type text not null,
  display_name text not null,
  is_enabled boolean not null default false,
  is_default boolean not null default false,
  sort_order smallint not null default 100,
  mode text not null default 'live',
  configuration_status text not null default 'ready',
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  bank_code text,
  instructions text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_payment_methods_tenant_id_id_key unique (tenant_id,id),
  constraint merchant_payment_methods_type_check
    check (method_type=any(array[
      'bank_transfer'::text,'paystack'::text,'flutterwave'::text,
      'cash_on_delivery'::text,'pay_on_pickup'::text
    ])),
  constraint merchant_payment_methods_display_name_check
    check (char_length(btrim(display_name)) between 1 and 80),
  constraint merchant_payment_methods_sort_order_check
    check (sort_order between 0 and 1000),
  constraint merchant_payment_methods_mode_check
    check (mode=any(array['test'::text,'live'::text])),
  constraint merchant_payment_methods_configuration_status_check
    check (configuration_status=any(array[
      'ready'::text,'credentials_required'::text,'configured'::text,'error'::text
    ])),
  constraint merchant_payment_methods_bank_fields_check
    check (
      (
        method_type='bank_transfer'
        and nullif(btrim(bank_name),'') is not null
        and nullif(btrim(bank_account_name),'') is not null
        and nullif(btrim(bank_account_number),'') is not null
      )
      or
      (
        method_type<>'bank_transfer'
        and bank_name is null
        and bank_account_name is null
        and bank_account_number is null
        and bank_code is null
      )
    ),
  constraint merchant_payment_methods_gateway_status_check
    check (
      (
        method_type in ('paystack','flutterwave')
        and configuration_status in ('credentials_required','configured','error')
      )
      or
      (
        method_type not in ('paystack','flutterwave')
        and configuration_status='ready'
      )
    ),
  constraint merchant_payment_methods_gateway_enable_check
    check (
      not is_enabled
      or method_type not in ('paystack','flutterwave')
      or configuration_status='configured'
    ),
  constraint merchant_payment_methods_default_check
    check (not is_default or is_enabled),
  constraint merchant_payment_methods_instructions_check
    check (instructions is null or char_length(instructions)<=500)
);

create unique index merchant_payment_methods_singleton_idx
  on public.merchant_payment_methods(tenant_id,method_type)
  where method_type<>'bank_transfer';

create unique index merchant_payment_methods_one_default_idx
  on public.merchant_payment_methods(tenant_id)
  where is_default=true;

create index merchant_payment_methods_tenant_enabled_idx
  on public.merchant_payment_methods(tenant_id,is_enabled,sort_order);

create index merchant_payment_methods_created_by_idx
  on public.merchant_payment_methods(created_by_user_id);

create index merchant_payment_methods_updated_by_idx
  on public.merchant_payment_methods(updated_by_user_id);

alter table public.merchant_payment_methods enable row level security;
revoke all on table public.merchant_payment_methods from public,anon,authenticated;
grant select on table public.merchant_payment_methods to authenticated;
grant all on table public.merchant_payment_methods to service_role;

create policy merchant_payment_methods_select_member
on public.merchant_payment_methods
for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=merchant_payment_methods.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create table sellertray_private.merchant_gateway_credentials (
  payment_method_id uuid primary key,
  tenant_id uuid not null,
  provider text not null,
  credentials_ciphertext text not null,
  credentials_iv text not null,
  encryption_key_version integer not null default 1,
  credential_fingerprint text not null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_gateway_credentials_method_same_tenant
    foreign key (tenant_id,payment_method_id)
    references public.merchant_payment_methods(tenant_id,id)
    on delete cascade,
  constraint merchant_gateway_credentials_provider_check
    check (provider=any(array['paystack'::text,'flutterwave'::text])),
  constraint merchant_gateway_credentials_key_version_check
    check (encryption_key_version>=1),
  constraint merchant_gateway_credentials_fingerprint_check
    check (credential_fingerprint ~ '^[A-F0-9]{12}$')
);

revoke all on table sellertray_private.merchant_gateway_credentials from public,anon,authenticated;
grant all on table sellertray_private.merchant_gateway_credentials to service_role;

alter table public.order_payments
  add column payment_method_id uuid;

alter table public.order_payments
  add constraint order_payments_method_same_tenant
  foreign key (tenant_id,payment_method_id)
  references public.merchant_payment_methods(tenant_id,id)
  on delete restrict;

create index order_payments_payment_method_idx
  on public.order_payments(tenant_id,payment_method_id);

create or replace function public.upsert_sellertray_payment_method(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_method_id uuid,
  p_method_type text,
  p_display_name text,
  p_is_enabled boolean,
  p_is_default boolean,
  p_sort_order integer,
  p_mode text,
  p_bank_name text,
  p_bank_account_name text,
  p_bank_account_number text,
  p_bank_code text,
  p_instructions text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_id uuid;
  v_existing public.merchant_payment_methods%rowtype;
  v_status text;
  v_row public.merchant_payment_methods%rowtype;
begin
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Only the business Owner or Manager can change payment methods' using errcode='42501';
  end if;

  if p_method_type in ('paystack','flutterwave') and v_role<>'owner' then
    raise exception 'Only the business Owner can change gateway payment methods' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  if p_method_id is not null then
    select * into v_existing
    from public.merchant_payment_methods m
    where m.id=p_method_id and m.tenant_id=p_tenant_id;

    if not found then
      raise exception 'SellerTray payment method not found' using errcode='22023';
    end if;

    if v_existing.method_type<>p_method_type then
      raise exception 'SellerTray payment method type is immutable' using errcode='23514';
    end if;

    v_status := v_existing.configuration_status;
    v_id := v_existing.id;
  else
    v_status := case when p_method_type in ('paystack','flutterwave') then 'credentials_required' else 'ready' end;
    v_id := gen_random_uuid();
  end if;

  if p_method_type='bank_transfer' then
    if nullif(btrim(coalesce(p_bank_name,'')),'') is null
       or nullif(btrim(coalesce(p_bank_account_name,'')),'') is null
       or nullif(btrim(coalesce(p_bank_account_number,'')),'') is null then
      raise exception 'Bank name, account name and account number are required' using errcode='22023';
    end if;
  end if;

  if p_method_type in ('paystack','flutterwave')
     and coalesce(p_is_enabled,false)
     and v_status<>'configured' then
    raise exception 'Connect gateway credentials before enabling this payment method' using errcode='23514';
  end if;

  if coalesce(p_is_default,false) then
    update public.merchant_payment_methods
    set is_default=false,updated_at=now(),updated_by_user_id=p_actor_user_id
    where tenant_id=p_tenant_id and id<>v_id and is_default=true;
  end if;

  insert into public.merchant_payment_methods (
    id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,
    configuration_status,bank_name,bank_account_name,bank_account_number,bank_code,
    instructions,created_by_user_id,updated_by_user_id
  ) values (
    v_id,p_tenant_id,p_method_type,btrim(p_display_name),coalesce(p_is_enabled,false),
    coalesce(p_is_default,false),coalesce(p_sort_order,100)::smallint,coalesce(p_mode,'live'),
    v_status,
    case when p_method_type='bank_transfer' then nullif(btrim(p_bank_name),'') else null end,
    case when p_method_type='bank_transfer' then nullif(btrim(p_bank_account_name),'') else null end,
    case when p_method_type='bank_transfer' then nullif(btrim(p_bank_account_number),'') else null end,
    case when p_method_type='bank_transfer' then nullif(btrim(p_bank_code),'') else null end,
    nullif(btrim(p_instructions),''),
    p_actor_user_id,p_actor_user_id
  )
  on conflict (id) do update
  set display_name=excluded.display_name,
      is_enabled=excluded.is_enabled,
      is_default=excluded.is_default,
      sort_order=excluded.sort_order,
      mode=excluded.mode,
      bank_name=excluded.bank_name,
      bank_account_name=excluded.bank_account_name,
      bank_account_number=excluded.bank_account_number,
      bank_code=excluded.bank_code,
      instructions=excluded.instructions,
      updated_by_user_id=excluded.updated_by_user_id,
      updated_at=now()
  returning * into v_row;

  return jsonb_build_object(
    'id',v_row.id,
    'tenantId',v_row.tenant_id,
    'methodType',v_row.method_type,
    'displayName',v_row.display_name,
    'isEnabled',v_row.is_enabled,
    'isDefault',v_row.is_default,
    'sortOrder',v_row.sort_order,
    'mode',v_row.mode,
    'configurationStatus',v_row.configuration_status
  );
end;
$$;

revoke all on function public.upsert_sellertray_payment_method(uuid,uuid,uuid,text,text,boolean,boolean,integer,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.upsert_sellertray_payment_method(uuid,uuid,uuid,text,text,boolean,boolean,integer,text,text,text,text,text,text) to service_role;

create or replace function public.save_sellertray_gateway_credentials(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_payment_method_id uuid,
  p_provider text,
  p_ciphertext text,
  p_iv text,
  p_fingerprint text,
  p_key_version integer
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
  v_method public.merchant_payment_methods%rowtype;
begin
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role<>'owner' then
    raise exception 'Only the business Owner can connect payment gateways' using errcode='42501';
  end if;

  if not public.orderdesk_subscription_can_write(p_tenant_id) then
    raise exception 'SellerTray subscription is read-only' using errcode='42501';
  end if;

  select * into v_method
  from public.merchant_payment_methods m
  where m.tenant_id=p_tenant_id and m.id=p_payment_method_id;

  if not found or v_method.method_type not in ('paystack','flutterwave') or v_method.method_type<>p_provider then
    raise exception 'SellerTray gateway payment method mismatch' using errcode='23514';
  end if;

  insert into sellertray_private.merchant_gateway_credentials (
    payment_method_id,tenant_id,provider,credentials_ciphertext,credentials_iv,
    encryption_key_version,credential_fingerprint,updated_by_user_id
  ) values (
    p_payment_method_id,p_tenant_id,p_provider,p_ciphertext,p_iv,
    p_key_version,p_fingerprint,p_actor_user_id
  )
  on conflict (payment_method_id) do update
  set provider=excluded.provider,
      credentials_ciphertext=excluded.credentials_ciphertext,
      credentials_iv=excluded.credentials_iv,
      encryption_key_version=excluded.encryption_key_version,
      credential_fingerprint=excluded.credential_fingerprint,
      updated_by_user_id=excluded.updated_by_user_id,
      updated_at=now();

  update public.merchant_payment_methods
  set configuration_status='configured',
      updated_by_user_id=p_actor_user_id,
      updated_at=now()
  where id=p_payment_method_id and tenant_id=p_tenant_id;
end;
$$;

revoke all on function public.save_sellertray_gateway_credentials(uuid,uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.save_sellertray_gateway_credentials(uuid,uuid,uuid,text,text,text,text,integer) to service_role;

create or replace function public.clear_sellertray_gateway_credentials(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_payment_method_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text;
begin
  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role<>'owner' then
    raise exception 'Only the business Owner can disconnect payment gateways' using errcode='42501';
  end if;

  delete from sellertray_private.merchant_gateway_credentials
  where tenant_id=p_tenant_id and payment_method_id=p_payment_method_id;

  update public.merchant_payment_methods
  set configuration_status='credentials_required',
      is_enabled=false,
      is_default=false,
      updated_by_user_id=p_actor_user_id,
      updated_at=now()
  where tenant_id=p_tenant_id
    and id=p_payment_method_id
    and method_type in ('paystack','flutterwave');
end;
$$;

revoke all on function public.clear_sellertray_gateway_credentials(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.clear_sellertray_gateway_credentials(uuid,uuid,uuid) to service_role;

create or replace function public.get_sellertray_gateway_credentials(
  p_tenant_id uuid,
  p_payment_method_id uuid
)
returns table(
  provider text,
  credentials_ciphertext text,
  credentials_iv text,
  encryption_key_version integer,
  credential_fingerprint text
)
language sql
security definer
set search_path=''
as $$
  select c.provider,c.credentials_ciphertext,c.credentials_iv,
         c.encryption_key_version,c.credential_fingerprint
  from sellertray_private.merchant_gateway_credentials c
  where c.tenant_id=p_tenant_id and c.payment_method_id=p_payment_method_id;
$$;

revoke all on function public.get_sellertray_gateway_credentials(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_gateway_credentials(uuid,uuid) to service_role;

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

revoke all on function public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.create_sellertray_order_payment_for_method(uuid,uuid,uuid,text,text,text,timestamptz) to service_role;

commit;