-- Forward-only follow-up for the live membership audit ledger.
-- Keep the original applied migration immutable while covering the actor FK used by audit review.

create index if not exists sellertray_membership_events_actor_idx
  on public.sellertray_membership_events(actor_user_id, created_at desc)
  where actor_user_id is not null;
