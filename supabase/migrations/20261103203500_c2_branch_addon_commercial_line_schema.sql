begin;
-- C2-6 additive branch add-on commercial line schema.
alter table public.sellertray_commercial_order_price_snapshots
  add column if not exists addon_version_id uuid
  references public.sellertray_addon_versions(id) on delete restrict;
alter table public.sellertray_commercial_order_price_snapshots
  drop constraint sellertray_commercial_order_price_snapshots_type_check,
  add constraint sellertray_commercial_order_price_snapshots_type_check
    check (line_type in ('subscription','branch_subscription','branch_setup','branch_addon')),
  drop constraint sellertray_commercial_order_price_snapshots_subject_check,
  add constraint sellertray_commercial_order_price_snapshots_subject_check check (
    (line_type='subscription' and plan_code is not null and branch_id is null
      and plan_profile_version_id is null and addon_version_id is null
      and billing_cycle in ('monthly','yearly') and quantity=1)
    or (line_type='branch_subscription' and plan_code is null and branch_id is not null
      and plan_profile_version_id is not null and addon_version_id is null
      and billing_cycle in ('monthly','yearly') and charge_type_code='branch_subscription' and quantity=1)
    or (line_type='branch_setup' and plan_code is null and branch_id is not null
      and plan_profile_version_id is null and addon_version_id is null
      and billing_cycle is null and quantity=1)
    or (line_type='branch_addon' and plan_code is null and branch_id is not null
      and plan_profile_version_id is null and addon_version_id is not null
      and billing_cycle in ('monthly','yearly','one_time') and charge_type_code='addon' and quantity=1)
  );
create unique index sellertray_c2_branch_order_addon_line_key
  on public.sellertray_commercial_order_price_snapshots(commercial_order_id,branch_id,addon_version_id)
  where line_type='branch_addon';
commit;
