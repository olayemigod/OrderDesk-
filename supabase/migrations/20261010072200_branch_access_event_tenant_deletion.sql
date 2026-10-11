begin;

alter table public.sellertray_branch_access_events
  drop constraint if exists sellertray_branch_access_events_branch_same_tenant;

alter table public.sellertray_branch_access_events
  add constraint sellertray_branch_access_events_branch_same_tenant
  foreign key (tenant_id,branch_id)
  references public.branches(tenant_id,id)
  on delete cascade;

commit;
