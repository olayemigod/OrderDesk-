begin;

-- SellerTray C2-4/C2-5 exact-head review hardening.
--
-- This remains additive and does not cut any operational surface over from the
-- legacy Business subscription runtime. It closes three concurrency/temporal
-- gaps in the new parallel Branch Subscription authority:
-- 1) deterministic ordering when creation and first activation share an
--    effective timestamp inside one transaction;
-- 2) overlap validation for every entitlement-bearing resulting range,
--    including provisional -> full activation extensions;
-- 3) Branch serialization before add-on term validation so a concurrent
--    activation cannot leave an add-on outside the committed term.

alter table public.sellertray_branch_subscription_events
  add column lifecycle_sequence bigint generated always as identity;

create unique index sellertray_branch_subscription_events_sequence_key
  on public.sellertray_branch_subscription_events(lifecycle_sequence);

create or replace function public.sellertray_branch_subscription_effective_status(
  p_branch_subscription_id uuid,
  p_as_of timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_event public.sellertray_branch_subscription_events%rowtype;
  v_status text;
  v_event_period_end timestamptz;
begin
  if p_branch_subscription_id is null or p_as_of is null then
    return null;
  end if;

  select s.* into v_subscription
  from public.sellertray_branch_subscriptions s
  where s.id=p_branch_subscription_id;
  if not found then return null; end if;

  select e.* into v_event
  from public.sellertray_branch_subscription_events e
  where e.branch_subscription_id=p_branch_subscription_id
    and e.effective_at<=p_as_of
  order by e.effective_at desc,e.lifecycle_sequence desc
  limit 1;

  if not found then return 'not_started'; end if;

  v_status:=case v_event.event_type
    when 'created' then 'pending'
    when 'provisional_activated' then 'provisional'
    when 'activated' then 'active'
    when 'resumed' then 'active'
    when 'suspended' then 'suspended'
    when 'expired' then 'expired'
    when 'cancelled' then 'cancelled'
    else 'pending'
  end;

  v_event_period_end:=nullif(v_event.details->>'entitlementPeriodEnd','')::timestamptz;

  if v_status in ('provisional','active','suspended') then
    if v_subscription.entitlement_period_start is not null
       and p_as_of<v_subscription.entitlement_period_start then
      return 'not_started';
    end if;
    if v_event_period_end is not null and p_as_of>=v_event_period_end then
      return 'expired';
    end if;
  end if;

  return v_status;
end;
$function$;

revoke all on function public.sellertray_branch_subscription_effective_status(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.sellertray_branch_subscription_effective_status(uuid,timestamptz)
  to service_role;

-- This trigger is a database-boundary backstop. Governed lifecycle commands
-- serialize by Branch; the trigger then validates the final row shape, so a
-- provisional term cannot be expanded across another entitled/suspended term.
create or replace function public.validate_sellertray_branch_subscription_entitlement_overlap()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if new.lifecycle_status in ('provisional','active','suspended')
     and new.entitlement_period_start is not null
     and new.entitlement_period_end is not null
     and exists(
       select 1
       from public.sellertray_branch_subscriptions other
       where other.tenant_id=new.tenant_id
         and other.branch_id=new.branch_id
         and other.id<>new.id
         and other.lifecycle_status in ('provisional','active','suspended')
         and other.entitlement_period_start is not null
         and other.entitlement_period_end is not null
         and tstzrange(other.entitlement_period_start,other.entitlement_period_end,'[)')
             && tstzrange(new.entitlement_period_start,new.entitlement_period_end,'[)')
     ) then
    raise exception 'Branch Subscription entitlement periods cannot overlap' using errcode='23P01';
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_sellertray_branch_subscription_entitlement_overlap()
  from public,anon,authenticated;

drop trigger if exists validate_sellertray_branch_subscription_entitlement_overlap
  on public.sellertray_branch_subscriptions;
create trigger validate_sellertray_branch_subscription_entitlement_overlap
before insert or update on public.sellertray_branch_subscriptions
for each row execute function public.validate_sellertray_branch_subscription_entitlement_overlap();

create or replace function public.register_sellertray_branch_subscription_addon(
  p_tenant_id uuid,
  p_branch_subscription_id uuid,
  p_addon_version_id uuid,
  p_billing_cycle text,
  p_entitlement_from timestamptz,
  p_entitlement_until timestamptz,
  p_commercial_order_id uuid,
  p_commercial_order_line_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_provenance jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_branch_id uuid;
  v_subscription public.sellertray_branch_subscriptions%rowtype;
  v_addon public.sellertray_addon_versions%rowtype;
  v_existing public.sellertray_branch_subscription_addons%rowtype;
  v_definition_id uuid;
  v_id uuid;
begin
  if p_tenant_id is null or p_branch_subscription_id is null or p_addon_version_id is null
     or p_command_id is null or p_billing_cycle not in ('monthly','yearly','one_time')
     or p_entitlement_from is null or p_entitlement_until is null or p_entitlement_until<=p_entitlement_from
     or jsonb_typeof(coalesce(p_provenance,'{}'::jsonb))<>'object' then
    raise exception 'Valid Branch add-on entitlement facts are required' using errcode='22023';
  end if;

  -- Command identity is global to this add-on authority and is serialized before
  -- any mutable Branch-state decision.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-addon-command|'||p_command_id::text,0
  ));

  select a.* into v_existing
  from public.sellertray_branch_subscription_addons a
  where a.tenant_id=p_tenant_id and a.creation_command_id=p_command_id;

  if found then
    if v_existing.branch_subscription_id=p_branch_subscription_id
       and v_existing.addon_version_id=p_addon_version_id
       and v_existing.billing_cycle=p_billing_cycle
       and v_existing.entitlement_from=p_entitlement_from
       and v_existing.entitlement_until=p_entitlement_until
       and v_existing.commercial_order_id is not distinct from p_commercial_order_id
       and v_existing.commercial_order_line_id is not distinct from p_commercial_order_line_id
       and v_existing.actor_user_id is not distinct from p_actor_user_id
       and v_existing.provenance=coalesce(p_provenance,'{}'::jsonb) then
      return v_existing.id;
    end if;
    raise exception 'Branch add-on creation command is already used for different facts' using errcode='23505';
  end if;

  -- Branch identity is immutable. Read only that identity before the Branch lock,
  -- then re-read all subscription state after acquiring the same serialization
  -- lock used by lifecycle transitions.
  select s.branch_id into strict v_branch_id
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=p_tenant_id and s.id=p_branch_subscription_id;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sellertray-branch-subscription|'||p_tenant_id::text||'|'||v_branch_id::text,0
  ));

  select s.* into strict v_subscription
  from public.sellertray_branch_subscriptions s
  where s.tenant_id=p_tenant_id and s.id=p_branch_subscription_id;

  select a.* into strict v_addon
  from public.sellertray_addon_versions a
  where a.id=p_addon_version_id;

  if v_addon.status not in ('published','retired')
     or v_addon.effective_from is null
     or v_addon.effective_from>p_entitlement_from
     or (v_addon.effective_until is not null and v_addon.effective_until<=p_entitlement_from)
     or not (p_billing_cycle=any(v_addon.allowed_billing_cycles)) then
    raise exception 'Add-on Version is not eligible for this Branch Subscription term' using errcode='23514';
  end if;

  if p_entitlement_from<v_subscription.committed_at then
    raise exception 'Branch add-on entitlement cannot begin before its Branch Subscription commitment' using errcode='23514';
  end if;

  if v_subscription.entitlement_period_start is not null and (
       p_entitlement_from<v_subscription.entitlement_period_start
       or p_entitlement_until>coalesce(v_subscription.expected_full_term_end,v_subscription.entitlement_period_end)
     ) then
    raise exception 'Add-on entitlement must remain within the Branch Subscription term' using errcode='23514';
  end if;

  select a.addon_definition_id into v_definition_id
  from public.sellertray_addon_versions a where a.id=p_addon_version_id;

  if exists(
    select 1
    from public.sellertray_branch_subscription_addons current_addon
    join public.sellertray_addon_versions current_version on current_version.id=current_addon.addon_version_id
    where current_addon.tenant_id=p_tenant_id
      and current_addon.branch_subscription_id=p_branch_subscription_id
      and current_version.addon_definition_id=v_definition_id
      and tstzrange(current_addon.entitlement_from,current_addon.entitlement_until,'[)')
          && tstzrange(p_entitlement_from,p_entitlement_until,'[)')
  ) then
    raise exception 'Overlapping versions of one add-on cannot apply to the same Branch Subscription term' using errcode='23P01';
  end if;

  insert into public.sellertray_branch_subscription_addons(
    tenant_id,branch_subscription_id,branch_id,addon_version_id,billing_cycle,
    entitlement_from,entitlement_until,commercial_order_id,commercial_order_line_id,
    creation_command_id,actor_user_id,provenance
  ) values (
    p_tenant_id,p_branch_subscription_id,v_subscription.branch_id,p_addon_version_id,p_billing_cycle,
    p_entitlement_from,p_entitlement_until,p_commercial_order_id,p_commercial_order_line_id,
    p_command_id,p_actor_user_id,coalesce(p_provenance,'{}'::jsonb)
  ) returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.register_sellertray_branch_subscription_addon(
  uuid,uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.register_sellertray_branch_subscription_addon(
  uuid,uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,jsonb
) to service_role;

commit;
