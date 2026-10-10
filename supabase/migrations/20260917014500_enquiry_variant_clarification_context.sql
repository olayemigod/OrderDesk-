-- SellerTray: persist the catalogue-backed options offered during an
-- ambiguous product enquiry so a short customer reply can safely resolve one.

begin;

alter table public.customer_enquiries
  add column if not exists clarification_candidates jsonb not null default '[]'::jsonb;

alter table public.customer_enquiries
  drop constraint if exists customer_enquiries_clarification_candidates_array_check,
  add constraint customer_enquiries_clarification_candidates_array_check
    check (jsonb_typeof(clarification_candidates) = 'array');

commit;
