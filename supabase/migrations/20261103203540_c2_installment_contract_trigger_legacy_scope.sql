begin;

-- C2-6: C1's legacy after-insert snapshot bridge expects a Business-level
-- subscription price line. Branch obligations have no such line and carry
-- their own explicit, immutable C2 policy/template snapshot in the creator.
-- Scope the existing C1 bridge to its original obligation kind rather than
-- rewriting its policy resolver or allowing Branch orders to trip C1 checks.
drop trigger if exists snapshot_sellertray_inserted_installment_contract
  on public.sellertray_commercial_installment_obligations;
create trigger snapshot_sellertray_inserted_installment_contract
after insert on public.sellertray_commercial_installment_obligations
for each row
when (new.obligation_scope = 'commercial_order')
execute function public.snapshot_sellertray_inserted_installment_contract();

commit;
