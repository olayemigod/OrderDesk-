begin;

-- Enforce Branch identity through composite foreign keys so service-side callers
-- cannot attach lifecycle/add-on evidence to a different Branch in the same Business.
alter table public.sellertray_branch_subscriptions
  add constraint sellertray_branch_subscriptions_tenant_id_id_branch_id_key
  unique (tenant_id,id,branch_id);

alter table public.sellertray_branch_subscription_events
  add constraint sellertray_branch_subscription_events_subscription_branch_fk
  foreign key (tenant_id,branch_subscription_id,branch_id)
  references public.sellertray_branch_subscriptions(tenant_id,id,branch_id)
  on delete restrict;

alter table public.sellertray_branch_subscription_addons
  add constraint sellertray_branch_subscription_addons_subscription_branch_fk
  foreign key (tenant_id,branch_subscription_id,branch_id)
  references public.sellertray_branch_subscriptions(tenant_id,id,branch_id)
  on delete restrict;

-- Lifecycle history must be chronological. Creation and first activation may
-- legitimately share committed_at/effective_at; after a non-created event exists,
-- a second transition at the same timestamp is ambiguous and fails closed.
create or replace function public.validate_sellertray_branch_subscription_event_insert()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if exists(
    select 1
    from public.sellertray_branch_subscription_events e
    where e.tenant_id=new.tenant_id
      and e.branch_subscription_id=new.branch_subscription_id
      and (
        e.effective_at>new.effective_at
        or (e.effective_at=new.effective_at and e.event_type<>'created')
      )
  ) then
    raise exception 'Branch Subscription lifecycle events must be recorded in effective-time order' using errcode='23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_sellertray_branch_subscription_event_insert()
  from public,anon,authenticated;

create trigger validate_sellertray_branch_subscription_event_insert
before insert on public.sellertray_branch_subscription_events
for each row execute function public.validate_sellertray_branch_subscription_event_insert();

-- Add-on evidence is immutable, so validate its Branch/commit/order lineage once
-- at insertion rather than depending on every future C2 purchase caller.
create or replace function public.validate_sellertray_branch_subscription_addon_insert()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_line public.sellertray_commercial_order_price_snapshots%rowtype;
begin
  select s.* into strict v_subscription
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=new.tenant_id and s.id=new.branch_subscription_id;

  if new.branch_id<>v_subscription.branch_id then
    raise exception 'Branch add-on assignment must belong to the Branch Subscription Branch' using errcode='23514';
  end if;
  if new.entitlement_from<v_subscription.committed_at then
    raise exception 'Branch add-on entitlement cannot begin before its Branch Subscription commitment' using errcode='23514';
  end if;

  if new.commercial_order_line_id is not null then
    if new.commercial_order_id is null then
      raise exception 'Branch add-on commercial order line requires its commercial order' using errcode='23514';
    end if;
    select l.* into strict v_line
    from public.sellertray_commercial_order_price_snapshots l
    where l.tenant_id=new.tenant_id and l.id=new.commercial_order_line_id;
    if v_line.commercial_order_id<>new.commercial_order_id then
      raise exception 'Branch add-on commercial order line must belong to its commercial order' using errcode='23514';
    end if;
    if v_line.branch_id is not null and v_line.branch_id<>v_subscription.branch_id then
      raise exception 'Branch add-on commercial order line must belong to the Branch Subscription Branch' using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_sellertray_branch_subscription_addon_insert()
  from public,anon,authenticated;

create trigger validate_sellertray_branch_subscription_addon_insert
before insert on public.sellertray_branch_subscription_addons
for each row execute function public.validate_sellertray_branch_subscription_addon_insert();

commit;
