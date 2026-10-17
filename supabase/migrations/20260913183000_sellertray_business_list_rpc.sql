create or replace function public.sellertray_list_businesses_for_current_user()
returns table (
  id uuid,
  name text,
  slug text,
  merchant_code text,
  role text,
  business_email text,
  business_phone text,
  business_type text,
  logo_url text,
  currency text,
  timezone text,
  onboarding_status text,
  subscription_status text,
  whatsapp_connection_status text,
  membership_created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id,
    t.name,
    t.slug,
    t.merchant_code,
    tm.role,
    t.business_email,
    t.business_phone,
    t.business_type,
    t.logo_url,
    t.currency,
    t.timezone,
    t.onboarding_status,
    t.subscription_status,
    t.whatsapp_connection_status,
    tm.created_at
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  where tm.user_id = auth.uid()
  order by tm.created_at asc;
$$;

revoke all on function public.sellertray_list_businesses_for_current_user() from public;
revoke all on function public.sellertray_list_businesses_for_current_user() from anon;
grant execute on function public.sellertray_list_businesses_for_current_user() to authenticated;

comment on function public.sellertray_list_businesses_for_current_user()
is 'Returns only the signed-in user''s SellerTray business memberships and tenant profile fields.';
