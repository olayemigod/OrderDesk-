begin;

-- A cash correction is intentionally a two-stage metadata transition on the
-- immutable original movement:
--   1. mark the original movement superseded so it leaves effective totals;
--   2. after the immutable correction row exists, link that row back to the
--      superseded movement.
-- No commercial cash facts may change during either transition.
create or replace function public.guard_sellertray_cash_movement_history()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_business_facts_unchanged boolean;
  v_is_supersede_transition boolean;
  v_is_correction_link_transition boolean;
begin
  if tg_op='DELETE' then
    raise exception 'SellerTray cash history is immutable; use a correction' using errcode='55000';
  end if;

  v_business_facts_unchanged :=
    new.tenant_id=old.tenant_id
    and new.branch_id=old.branch_id
    and new.register_id=old.register_id
    and new.shift_id=old.shift_id
    and new.movement_type=old.movement_type
    and new.amount=old.amount
    and new.currency=old.currency
    and new.reference=old.reference
    and new.reason=old.reason
    and new.expense_category is not distinct from old.expense_category
    and new.actor_user_id=old.actor_user_id
    and new.created_at=old.created_at
    and new.command_id_hash is not distinct from old.command_id_hash;

  v_is_supersede_transition :=
    old.superseded_at is null
    and new.superseded_at is not null
    and old.superseded_by_correction_id is null
    and new.superseded_by_correction_id is null;

  v_is_correction_link_transition :=
    old.superseded_at is not null
    and new.superseded_at is not distinct from old.superseded_at
    and old.superseded_by_correction_id is null
    and new.superseded_by_correction_id is not null
    and exists (
      select 1
      from public.sellertray_shift_cash_movement_corrections c
      where c.tenant_id=old.tenant_id
        and c.id=new.superseded_by_correction_id
        and c.original_movement_id=old.id
        and c.branch_id=old.branch_id
        and c.register_id=old.register_id
        and c.shift_id=old.shift_id
    );

  if current_setting('sellertray.cash_correction',true)='1'
     and v_business_facts_unchanged
     and (v_is_supersede_transition or v_is_correction_link_transition) then
    return new;
  end if;

  raise exception 'SellerTray cash history is immutable; use a correction' using errcode='55000';
end;
$$;

revoke all on function public.guard_sellertray_cash_movement_history() from public,anon,authenticated;

drop trigger if exists guard_sellertray_cash_movement_history on public.sellertray_shift_cash_movements;
create trigger guard_sellertray_cash_movement_history
before update or delete on public.sellertray_shift_cash_movements
for each row execute function public.guard_sellertray_cash_movement_history();

commit;
