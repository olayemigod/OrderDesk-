begin;

-- business_at is the commercial event time. created_at is the immutable
-- server recording time and must distinguish separate postings even when
-- they occur inside one database transaction. PostgreSQL now() is fixed at
-- transaction start, so use wall-clock time for future ledger inserts.
alter table public.inventory_movements
  alter column created_at set default clock_timestamp();

commit;
