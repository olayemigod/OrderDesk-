alter table public.customers
  drop constraint if exists customers_display_name_length_check,
  drop constraint if exists customers_email_format_check;

alter table public.customers
  add constraint customers_display_name_length_check
    check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  add constraint customers_email_format_check
    check (
      email is null or (
        char_length(email)<=254
        and email=lower(btrim(email))
        and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      )
    );

revoke update on public.customers from authenticated;
grant update(display_name,email) on public.customers to authenticated;

drop policy if exists customers_update_member on public.customers;
drop policy if exists customers_update_owner_manager on public.customers;
create policy customers_update_owner_manager
on public.customers for update to authenticated
using (
  exists(select 1 from public.tenant_members tm
    where tm.tenant_id=customers.tenant_id
      and tm.user_id=(select auth.uid())
      and tm.role in ('owner','manager'))
)
with check (
  exists(select 1 from public.tenant_members tm
    where tm.tenant_id=customers.tenant_id
      and tm.user_id=(select auth.uid())
      and tm.role in ('owner','manager'))
);

alter function public.update_sellertray_customer_profile(uuid,uuid,text,text) security invoker;
revoke all on function public.update_sellertray_customer_profile(uuid,uuid,text,text) from public,anon;
grant execute on function public.update_sellertray_customer_profile(uuid,uuid,text,text) to authenticated;
