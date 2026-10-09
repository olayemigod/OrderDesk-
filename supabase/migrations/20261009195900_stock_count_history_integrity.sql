begin;

create or replace function public.guard_sellertray_stock_count_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
      return old;
    end if;
    raise exception 'Stock count history cannot be deleted while this business exists'
      using errcode='55000';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.branch_id is distinct from old.branch_id
     or new.stock_location_id is distinct from old.stock_location_id
     or new.reference is distinct from old.reference
     or new.reason is distinct from old.reason
     or new.started_by_user_id is distinct from old.started_by_user_id
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Stock count identity and start facts are immutable'
      using errcode='55000';
  end if;

  if old.status in ('applied','cancelled') then
    raise exception 'Completed stock count history is immutable'
      using errcode='55000';
  end if;

  if old.status='counting' then
    if new.status='counting' then
      if new.submitted_by_user_id is distinct from old.submitted_by_user_id
         or new.submitted_at is distinct from old.submitted_at
         or new.applied_by_user_id is distinct from old.applied_by_user_id
         or new.applied_at is distinct from old.applied_at
         or new.cancelled_by_user_id is distinct from old.cancelled_by_user_id
         or new.cancelled_at is distinct from old.cancelled_at
         or new.cancel_reason is distinct from old.cancel_reason then
        raise exception 'Stock count state history cannot be rewritten'
          using errcode='55000';
      end if;
      return new;
    end if;

    if new.status='review' then
      if old.submitted_at is not null
         or new.submitted_by_user_id is null
         or new.submitted_at is null
         or new.applied_by_user_id is not null
         or new.applied_at is not null
         or new.cancelled_by_user_id is not null
         or new.cancelled_at is not null
         or new.cancel_reason is not null then
        raise exception 'Invalid stock count review transition'
          using errcode='55000';
      end if;
      return new;
    end if;

    if new.status='cancelled' then
      if new.cancelled_by_user_id is null
         or new.cancelled_at is null
         or nullif(btrim(coalesce(new.cancel_reason,'')),'') is null
         or new.applied_by_user_id is not null
         or new.applied_at is not null
         or new.submitted_by_user_id is distinct from old.submitted_by_user_id
         or new.submitted_at is distinct from old.submitted_at then
        raise exception 'Invalid stock count cancellation transition'
          using errcode='55000';
      end if;
      return new;
    end if;

    raise exception 'Invalid stock count state transition'
      using errcode='55000';
  end if;

  if old.status='review' then
    if new.submitted_by_user_id is distinct from old.submitted_by_user_id
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'Stock count review evidence is immutable'
        using errcode='55000';
    end if;

    if new.status='review' then
      if new.applied_by_user_id is distinct from old.applied_by_user_id
         or new.applied_at is distinct from old.applied_at
         or new.cancelled_by_user_id is distinct from old.cancelled_by_user_id
         or new.cancelled_at is distinct from old.cancelled_at
         or new.cancel_reason is distinct from old.cancel_reason then
        raise exception 'Stock count review state cannot be rewritten'
          using errcode='55000';
      end if;
      return new;
    end if;

    if new.status='applied' then
      if new.applied_by_user_id is null
         or new.applied_at is null
         or new.cancelled_by_user_id is not null
         or new.cancelled_at is not null
         or new.cancel_reason is not null then
        raise exception 'Invalid stock count apply transition'
          using errcode='55000';
      end if;
      return new;
    end if;

    if new.status='cancelled' then
      if new.cancelled_by_user_id is null
         or new.cancelled_at is null
         or nullif(btrim(coalesce(new.cancel_reason,'')),'') is null
         or new.applied_by_user_id is not null
         or new.applied_at is not null then
        raise exception 'Invalid stock count cancellation transition'
          using errcode='55000';
      end if;
      return new;
    end if;

    raise exception 'Invalid stock count state transition'
      using errcode='55000';
  end if;

  raise exception 'Unsupported stock count state'
    using errcode='55000';
end;
$$;

revoke all on function public.guard_sellertray_stock_count_history()
  from public,anon,authenticated;

drop trigger if exists guard_sellertray_stock_count_history on public.stock_counts;
create trigger guard_sellertray_stock_count_history
before update or delete on public.stock_counts
for each row execute function public.guard_sellertray_stock_count_history();

create or replace function public.guard_sellertray_stock_count_item_history()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_count_status text;
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
      return old;
    end if;
    raise exception 'Stock count item history cannot be deleted while this business exists'
      using errcode='55000';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.stock_count_id is distinct from old.stock_count_id
     or new.catalog_item_id is distinct from old.catalog_item_id
     or new.product_name is distinct from old.product_name
     or new.stock_uom is distinct from old.stock_uom
     or new.created_at is distinct from old.created_at then
    raise exception 'Stock count item identity is immutable'
      using errcode='55000';
  end if;

  select sc.status into v_count_status
  from public.stock_counts sc
  where sc.tenant_id=old.tenant_id and sc.id=old.stock_count_id;

  if v_count_status is null then
    raise exception 'Stock count not found for item history update'
      using errcode='55000';
  end if;
  if v_count_status<>'counting' then
    raise exception 'Stock count item facts are immutable after review begins'
      using errcode='55000';
  end if;

  if old.is_captured and new.expected_stock_quantity is distinct from old.expected_stock_quantity then
    raise exception 'Original expected stock snapshot cannot be changed by a count correction'
      using errcode='55000';
  end if;
  if old.is_captured and new.is_captured is distinct from true then
    raise exception 'A captured stock count item cannot be reset to uncounted'
      using errcode='55000';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_sellertray_stock_count_item_history()
  from public,anon,authenticated;

drop trigger if exists guard_sellertray_stock_count_item_history on public.stock_count_items;
create trigger guard_sellertray_stock_count_item_history
before update or delete on public.stock_count_items
for each row execute function public.guard_sellertray_stock_count_item_history();

commit;