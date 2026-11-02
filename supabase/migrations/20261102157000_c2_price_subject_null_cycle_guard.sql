begin;

-- Preserve the pre-C2 commercial price subject contract while allowing the
-- additive Commercial V2 subjects introduced in this batch.
--
-- PostgreSQL CHECK constraints accept UNKNOWN, so `billing_cycle in (...)`
-- alone does not reject NULL. Recurring price subjects must therefore require
-- a non-null billing cycle explicitly. Branch setup remains the only current
-- price kind whose governed subject intentionally has no billing cycle.

alter table public.sellertray_commercial_price_versions
  drop constraint if exists sellertray_commercial_price_versions_subject_check;

alter table public.sellertray_commercial_price_versions
  add constraint sellertray_commercial_price_versions_subject_check
    check (
      (
        price_kind='subscription'
        and billing_cycle is not null
        and billing_cycle in ('monthly','yearly')
        and addon_version_id is null
        and (
          (
            plan_code is not null
            and plan_profile_version_id is null
            and (charge_type_code is null or charge_type_code='branch_subscription')
          )
          or
          (
            plan_code is null
            and plan_profile_version_id is not null
            and charge_type_code='branch_subscription'
          )
        )
      )
      or
      (
        price_kind='branch_setup'
        and plan_code is null
        and plan_profile_version_id is null
        and addon_version_id is null
        and billing_cycle is null
        and (charge_type_code is null or charge_type_code='branch_setup')
      )
      or
      (
        price_kind='addon'
        and plan_code is null
        and plan_profile_version_id is null
        and addon_version_id is not null
        and charge_type_code='addon'
        and billing_cycle is not null
        and billing_cycle in ('monthly','yearly','one_time')
      )
      or
      (
        price_kind='additional_staff'
        and plan_code is null
        and addon_version_id is null
        and charge_type_code='additional_staff'
        and billing_cycle is not null
        and billing_cycle in ('monthly','yearly')
      )
    );

comment on constraint sellertray_commercial_price_versions_subject_check
  on public.sellertray_commercial_price_versions is
  'Commercial price subject guard. Recurring subscription/add-on/staff prices require an explicit governed billing cycle; Branch setup remains cycle-less. Supports legacy plan-code and additive Commercial V2 subjects.';

commit;
