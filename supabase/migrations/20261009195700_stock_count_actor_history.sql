begin;

alter table public.stock_counts
  drop constraint if exists stock_counts_started_by_user_id_fkey,
  drop constraint if exists stock_counts_submitted_by_user_id_fkey,
  drop constraint if exists stock_counts_applied_by_user_id_fkey,
  drop constraint if exists stock_counts_cancelled_by_user_id_fkey;

alter table public.stock_count_items
  drop constraint if exists stock_count_items_captured_by_user_id_fkey;

commit;