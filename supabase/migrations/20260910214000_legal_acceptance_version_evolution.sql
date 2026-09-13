alter table public.user_legal_acceptances
  drop constraint if exists user_legal_acceptances_current_terms_check,
  drop constraint if exists user_legal_acceptances_current_privacy_check;

alter table public.user_legal_acceptances
  add constraint user_legal_acceptances_terms_version_check
    check (
      char_length(btrim(terms_version)) between 1 and 64
      and terms_version = btrim(terms_version)
    ),
  add constraint user_legal_acceptances_privacy_version_check
    check (
      char_length(btrim(privacy_version)) between 1 and 64
      and privacy_version = btrim(privacy_version)
    );
