create table if not exists public.user_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  accepted_via text not null,
  created_at timestamptz not null default now(),
  constraint user_legal_acceptances_current_terms_check
    check (terms_version = '2026-09-10'),
  constraint user_legal_acceptances_current_privacy_check
    check (privacy_version = '2026-09-10'),
  constraint user_legal_acceptances_via_check
    check (accepted_via in ('sellertray_mobile')),
  unique (user_id, terms_version, privacy_version)
);

alter table public.user_legal_acceptances enable row level security;

revoke all on table public.user_legal_acceptances from anon, authenticated;
grant select on table public.user_legal_acceptances to authenticated;

drop policy if exists user_legal_acceptances_select_own on public.user_legal_acceptances;
create policy user_legal_acceptances_select_own
on public.user_legal_acceptances
for select
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists user_legal_acceptances_user_accepted_idx
  on public.user_legal_acceptances (user_id, accepted_at desc);
