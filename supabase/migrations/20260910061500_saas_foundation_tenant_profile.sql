alter table public.tenants
  add column if not exists business_email text,
  add column if not exists business_phone text,
  add column if not exists business_type text,
  add column if not exists logo_url text,
  add column if not exists currency text not null default 'NGN',
  add column if not exists timezone text not null default 'Africa/Lagos',
  add column if not exists onboarding_status text not null default 'profile',
  add column if not exists subscription_status text not null default 'trial',
  add column if not exists whatsapp_connection_status text not null default 'not_connected',
  add column if not exists updated_at timestamptz not null default now();

alter table public.tenants
  add constraint tenants_currency_code_check check (char_length(currency) = 3),
  add constraint tenants_onboarding_status_check check (
    onboarding_status in ('profile', 'catalogue', 'whatsapp', 'test_order', 'ready')
  ),
  add constraint tenants_subscription_status_check check (
    subscription_status in ('trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled')
  ),
  add constraint tenants_whatsapp_connection_status_check check (
    whatsapp_connection_status in ('not_connected', 'pending', 'connected', 'error')
  );

update public.tenants
set whatsapp_connection_status = case
      when whatsapp_phone_number_id is not null then 'connected'
      else 'not_connected'
    end,
    updated_at = now();

update public.tenants
set onboarding_status = case
      when slug = 'processedge-meta-test' then 'ready'
      when whatsapp_phone_number_id is not null then 'catalogue'
      else 'profile'
    end,
    updated_at = now();
