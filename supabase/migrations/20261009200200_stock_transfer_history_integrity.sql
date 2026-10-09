begin;

create or replace function public.guard_sellertray_stock_transfer_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
      return old;
    end if;
    raise exception 'Stock transfer history cannot be deleted while this business exists'
      using errcode='55000';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.source_branch_id is distinct from old.source_branch_id
     or new.source_stock_location_id is distinct from old.source_stock_location_id
     or new.destination_branch_id is distinct from old.destination_branch_id
     or new.destination_stock_location_id is distinct from old.destination_stock_location_id
     or new.reference is distinct from old.reference
     or new.reason is distinct from old.reason
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.items_fingerprint is distinct from old.items_fingerprint
     or new.created_at is distinct from old.created_at then
    raise exception 'Stock transfer identity and draft facts are immutable'
      using errcode='55000';
  end if;

  if old.status in ('received','cancelled') then
    raise exception 'Completed stock transfer history is immutable'
      using errcode='55000';
  end if;

  if old.status='draft' then
    if new.status='dispatched' then
      if new.dispatched_by_user_id is null
         or new.dispatched_at is null
         or new.received_by_user_id is not null
         or new.received_at is not null
         or new.cancelled_by_user_id is not null
         or new.cancelled_at is not null
         or new.cancel_reason is not null then
        raise exception 'Invalid stock transfer dispatch transition'
          using errcode='55000';
      end if;
      return new;
    end if;

    if new.status='cancelled' then
      if new.cancelled_by_user_id is null
         or new.cancelled_at is null
         or nullif(btrim(coalesce(new.cancel_reason,'')),'') is null
         or new.dispatched_by_user_id is not null
         or new.dispatched_at is not null
         or new.received_by_user_id is not null
         or new.received_at is not null then
        raise exception 'Invalid stock transfer cancellation transition'
          using errcode='55000';
      end if;
      return new;
    end if;

    raise exception 'Draft stock transfer facts cannot be rewritten'
      using errcode='55000';
  end if;

  if old.status='dispatched' then
    if new.dispatched_by_user_id is distinct from old.dispatched_by_user_id
       or new.dispatched_at is distinct from old.dispatched_at then
      raise exception 'Stock transfer dispatch evidence is immutable'
        using errcode='55000';
    end if;

    if new.status='received' then
      if new.received_by_user_id is null
         or new.received_at is null
         or new.cancelled_by_user_id is not null
         or new.cancelled_at is not null
         or new.cancel_reason is not null then
        raise exception 'Invalid stock transfer receipt transition'
          using errcode='55000';
      end if;
      return new;
    end if;

    raise exception 'Dispatched stock transfer history cannot be rewritten'
      using errcode='55000';
  end if;

  raise exception 'Unsupported stock transfer state'
    using errcode='55000';
end;
$$;

revoke all on function public.guard_sellertray_stock_transfer_history()
  from public,anon,authenticated;

drop trigger if exists guard_sellertray_stock_transfer_history on public.stock_transfers;
create trigger guard_sellertray_stock_transfer_history
before update or delete on public.stock_transfers
for each row execute function public.guard_sellertray_stock_transfer_history();

create or replace function public.guard_sellertray_stock_transfer_item_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
      return old;
    end if;
    raise exception 'Stock transfer item history cannot be deleted while this business exists'
      using errcode='55000';
  end if;

  raise exception 'Stock transfer item facts are immutable; cancel the draft and create a new transfer'
    using errcode='55000';
end;
$$;

revoke all on function public.guard_sellertray_stock_transfer_item_history()
  from public,anon,authenticated;

drop trigger if exists guard_sellertray_stock_transfer_item_history on public.stock_transfer_items;
create trigger guard_sellertray_stock_transfer_item_history
before update or delete on public.stock_transfer_items
for each row execute function public.guard_sellertray_stock_transfer_item_history();

commit;