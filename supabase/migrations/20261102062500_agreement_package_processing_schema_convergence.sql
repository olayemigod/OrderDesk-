-- Restore the internal agreement-package processing table to repository history.
--
-- Production received this table through the hosted
-- 20261028093719_agreement_package_processing_self_healing migration, while that
-- migration never entered the repository migration chain. Replaying that hosted
-- migration would also replay stale function/trigger bodies over newer OA5 authority,
-- so this convergence migration restores only the durable table contract.
--
-- The table remains internal: RLS is enabled with no client policies and all direct
-- privileges are revoked from public/anon/authenticated/service_role here. The next
-- forward migration grants service_role only the SELECT privilege required by the
-- current commercial-billing server read path.

create table if not exists public.sellertray_agreement_package_processing (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  installment_obligation_id uuid,
  subject_kind text not null,
  subject_id uuid not null,
  order_form_family text not null,
  orchestration_actor_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_result_code text,
  last_error_detail text,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, subject_kind, subject_id),
  constraint sellertray_agreement_processing_order_same_tenant
    foreign key (tenant_id, commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id, id) on delete cascade,
  constraint sellertray_agreement_processing_obligation_same_order
    foreign key (tenant_id, commercial_order_id, installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id, commercial_order_id, id) on delete cascade,
  constraint sellertray_agreement_processing_subject_check check (
    (subject_kind = 'commercial_order'
      and installment_obligation_id is null
      and subject_id = commercial_order_id
      and order_form_family = 'subscription_order')
    or
    (subject_kind = 'installment_obligation'
      and installment_obligation_id is not null
      and subject_id = installment_obligation_id
      and order_form_family = 'installment_agreement')
  ),
  constraint sellertray_agreement_processing_status_check check (
    status in ('pending', 'retryable', 'resolved', 'manual_attention')
  ),
  constraint sellertray_agreement_processing_attempt_check check (attempt_count >= 0),
  constraint sellertray_agreement_processing_result_code_check check (
    last_result_code is null or char_length(last_result_code) between 1 and 100
  ),
  constraint sellertray_agreement_processing_error_detail_check check (
    last_error_detail is null or char_length(last_error_detail) <= 1000
  )
);

create index if not exists sellertray_agreement_processing_due_idx
  on public.sellertray_agreement_package_processing(status, next_retry_at, updated_at)
  where status in ('pending', 'retryable');

create index if not exists sellertray_agreement_processing_tenant_idx
  on public.sellertray_agreement_package_processing(tenant_id, status, updated_at desc);

create index if not exists sellertray_agreement_processing_order_idx
  on public.sellertray_agreement_package_processing(tenant_id, commercial_order_id, updated_at desc);

alter table public.sellertray_agreement_package_processing enable row level security;
revoke all on table public.sellertray_agreement_package_processing from public, anon, authenticated, service_role;
