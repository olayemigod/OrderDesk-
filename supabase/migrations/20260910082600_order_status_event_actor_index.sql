create index if not exists order_status_events_actor_user_idx
  on public.order_status_events (actor_user_id)
  where actor_user_id is not null;
