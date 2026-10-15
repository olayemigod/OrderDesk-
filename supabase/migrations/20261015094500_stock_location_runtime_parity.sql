begin;

revoke all privileges on table public.stock_locations from anon,authenticated;
grant select on table public.stock_locations to authenticated;
grant all privileges on table public.stock_locations to service_role;

drop policy if exists stock_locations_select_branch_member on public.stock_locations;
create policy stock_locations_select_branch_member
on public.stock_locations
for select to authenticated
using (
  public.sellertray_current_user_can_read_branch(
    stock_locations.tenant_id,
    stock_locations.branch_id
  )
);

commit;
