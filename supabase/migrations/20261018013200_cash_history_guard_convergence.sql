begin;

-- Cash movements gained a correction-aware immutable-history guard after the
-- original cash-shift foundation. Keep that newer guard as the single movement
-- authority and retire only the overlapping legacy movement trigger. The
-- shared legacy function remains in use by cash-sale and cash-refund history.
drop trigger if exists prevent_sellertray_shift_cash_movements_mutation
  on public.sellertray_shift_cash_movements;

create or replace function public.guard_sellertray_cash_movement_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    -- Direct cash-ledger deletion stays forbidden while the Business exists.
    -- The governed tenant lifecycle may cascade historical evidence once the
    -- parent tenant row is no longer visible to this trigger.
    if not exists (
      select 1
      from public.tenants t
      where t.id=old.tenant_id
    ) then
      return old;
    end if;

    raise exception 'SellerTray cash history is immutable; use a correction'
      using errcode='55000';
  end if;

  if current_setting('sellertray.cash_correction',true)='1'
     and new.tenant_id=old.tenant_id
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
     and new.command_id_hash is not distinct from old.command_id_hash
     and (
       (
         old.superseded_at is null
         and new.superseded_at is not null
         and new.superseded_by_correction_id is not distinct from old.superseded_by_correction_id
       )
       or
       (
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
         )
       )
     ) then
    return new;
  end if;

  raise exception 'SellerTray cash history is immutable; use a correction'
    using errcode='55000';
end;
$$;

revoke all on function public.guard_sellertray_cash_movement_history()
  from public,anon,authenticated;

-- Correction rows are immutable during normal Business life, but they must
-- follow the governed parent-tenant deletion just like the cash evidence they
-- describe.
create or replace function public.prevent_sellertray_cash_correction_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE'
     and not exists (
       select 1
       from public.tenants t
       where t.id=old.tenant_id
     ) then
    return old;
  end if;

  raise exception 'SellerTray cash corrections are immutable'
    using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_cash_correction_mutation()
  from public,anon,authenticated;

-- Correction evidence and its original/replacement movements form a protected
-- graph. RESTRICT links in both directions can prevent the existing governed
-- tenant cascade from removing that graph. CASCADE is safe here because normal
-- direct movement/correction deletion is still stopped by the immutable BEFORE
-- triggers above; it only lets an already-authorised parent Business teardown
-- carry the whole graph with it.
alter table public.sellertray_shift_cash_movement_corrections
  drop constraint if exists sellertray_cash_correction_shift_same_branch,
  add constraint sellertray_cash_correction_shift_same_branch
    foreign key (tenant_id,branch_id,register_id,shift_id)
    references public.sellertray_cash_shifts(tenant_id,branch_id,register_id,id)
    on delete cascade,
  drop constraint if exists sellertray_cash_correction_original_same_tenant,
  add constraint sellertray_cash_correction_original_same_tenant
    foreign key (tenant_id,original_movement_id)
    references public.sellertray_shift_cash_movements(tenant_id,id)
    on delete cascade,
  drop constraint if exists sellertray_cash_correction_replacement_same_tenant,
  add constraint sellertray_cash_correction_replacement_same_tenant
    foreign key (tenant_id,replacement_movement_id)
    references public.sellertray_shift_cash_movements(tenant_id,id)
    on delete cascade;

alter table public.sellertray_shift_cash_movements
  drop constraint if exists sellertray_shift_cash_movements_superseded_correction_same_tenant,
  add constraint sellertray_shift_cash_movements_superseded_correction_same_tenant
    foreign key (tenant_id,superseded_by_correction_id)
    references public.sellertray_shift_cash_movement_corrections(tenant_id,id)
    on delete cascade;

commit;
