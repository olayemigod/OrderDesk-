begin;

create table if not exists public.sellertray_product_activity_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  catalog_item_id uuid not null,
  event_type text not null,
  actor_user_id uuid,
  actor_name text not null default 'SellerTray system',
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

alter table public.sellertray_product_activity_events enable row level security;

create index if not exists sellertray_product_activity_product_time_idx
  on public.sellertray_product_activity_events(tenant_id,catalog_item_id,occurred_at desc,id desc);

create or replace function public.guard_sellertray_product_activity_immutability()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception 'SellerTray Product activity history is immutable' using errcode='23514';
end;
$$;

revoke all on function public.guard_sellertray_product_activity_immutability() from public,anon,authenticated;

drop trigger if exists guard_sellertray_product_activity_immutability on public.sellertray_product_activity_events;
create trigger guard_sellertray_product_activity_immutability
before update or delete on public.sellertray_product_activity_events
for each row execute function public.guard_sellertray_product_activity_immutability();

create or replace function public.capture_sellertray_product_activity()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_name text := 'SellerTray system';
  v_event_type text;
  v_before jsonb;
  v_after jsonb;
begin
  if v_actor_user_id is not null then
    select coalesce(
      nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
      nullif(btrim(u.raw_user_meta_data->>'name'),''),
      nullif(btrim(u.email),''),
      'SellerTray team member'
    )
    into v_actor_name
    from auth.users u
    where u.id=v_actor_user_id;
    v_actor_name := coalesce(v_actor_name,'SellerTray team member');
  end if;

  if tg_table_name='catalog_items' then
    if tg_op='INSERT' then
      v_event_type := 'product_created';
      v_after := to_jsonb(new)-'created_at'-'updated_at';
    elsif tg_op='UPDATE' then
      v_before := to_jsonb(old)-'created_at'-'updated_at';
      v_after := to_jsonb(new)-'created_at'-'updated_at';
      if v_before=v_after then return new; end if;
      if old.is_active is distinct from new.is_active then
        v_event_type := case when new.is_active then 'product_restored' else 'product_archived' end;
      else
        v_event_type := 'product_updated';
      end if;
    else
      return coalesce(new,old);
    end if;

    insert into public.sellertray_product_activity_events(
      tenant_id,catalog_item_id,event_type,actor_user_id,actor_name,details
    ) values (
      new.tenant_id,new.id,v_event_type,v_actor_user_id,v_actor_name,
      jsonb_strip_nulls(jsonb_build_object('before',v_before,'after',v_after))
    );
    return new;
  end if;

  if tg_table_name='catalog_item_uoms' then
    if tg_op='INSERT' then
      v_event_type := 'unit_added';
      v_after := to_jsonb(new)-'created_at'-'updated_at';
      insert into public.sellertray_product_activity_events(
        tenant_id,catalog_item_id,event_type,actor_user_id,actor_name,details
      ) values (
        new.tenant_id,new.catalog_item_id,v_event_type,v_actor_user_id,v_actor_name,
        jsonb_build_object('after',v_after)
      );
      return new;
    elsif tg_op='UPDATE' then
      v_before := to_jsonb(old)-'created_at'-'updated_at';
      v_after := to_jsonb(new)-'created_at'-'updated_at';
      if v_before=v_after then return new; end if;
      insert into public.sellertray_product_activity_events(
        tenant_id,catalog_item_id,event_type,actor_user_id,actor_name,details
      ) values (
        new.tenant_id,new.catalog_item_id,'unit_updated',v_actor_user_id,v_actor_name,
        jsonb_build_object('before',v_before,'after',v_after)
      );
      return new;
    elsif tg_op='DELETE' then
      v_before := to_jsonb(old)-'created_at'-'updated_at';
      insert into public.sellertray_product_activity_events(
        tenant_id,catalog_item_id,event_type,actor_user_id,actor_name,details
      ) values (
        old.tenant_id,old.catalog_item_id,'unit_removed',v_actor_user_id,v_actor_name,
        jsonb_build_object('before',v_before)
      );
      return old;
    end if;
  end if;

  return coalesce(new,old);
end;
$$;

revoke all on function public.capture_sellertray_product_activity() from public,anon,authenticated;

drop trigger if exists capture_sellertray_product_activity on public.catalog_items;
create trigger capture_sellertray_product_activity
after insert or update on public.catalog_items
for each row execute function public.capture_sellertray_product_activity();

drop trigger if exists capture_sellertray_product_uom_activity on public.catalog_item_uoms;
create trigger capture_sellertray_product_uom_activity
after insert or update or delete on public.catalog_item_uoms
for each row execute function public.capture_sellertray_product_activity();

insert into public.sellertray_product_activity_events(
  tenant_id,catalog_item_id,event_type,actor_user_id,actor_name,details,occurred_at,created_at
)
select
  ci.tenant_id,
  ci.id,
  'tracking_started',
  null,
  'SellerTray system',
  jsonb_build_object(
    'current',jsonb_build_object(
      'name',ci.name,
      'sku',ci.sku,
      'category',ci.category,
      'stockUom',ci.stock_uom,
      'sellingPrice',ci.price_ngn,
      'isActive',ci.is_active
    )
  ),
  clock_timestamp(),
  clock_timestamp()
from public.catalog_items ci
where not exists (
  select 1
  from public.sellertray_product_activity_events e
  where e.tenant_id=ci.tenant_id
    and e.catalog_item_id=ci.id
);

create or replace function public.get_sellertray_product_activity(
  p_tenant_id uuid,
  p_product_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(10,least(coalesce(p_limit,100),100));
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then
    raise exception 'You do not have permission to review Product activity' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.catalog_items ci
    where ci.tenant_id=p_tenant_id and ci.id=p_product_id
  ) then
    raise exception 'Product not found' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId',x.event_id,
    'kind',x.kind,
    'eventType',x.event_type,
    'summary',x.summary,
    'occurredAt',x.occurred_at,
    'recordedAt',x.recorded_at,
    'actorName',x.actor_name,
    'branchId',x.branch_id,
    'branchName',x.branch_name,
    'quantityDelta',x.quantity_delta,
    'stockUom',x.stock_uom,
    'referenceType',x.reference_type,
    'referenceId',x.reference_id,
    'details',x.details
  ) order by x.occurred_at desc,x.recorded_at desc,x.event_id desc),'[]'::jsonb)
  into v_result
  from (
    select *
    from (
      select
        e.id::text as event_id,
        'configuration'::text as kind,
        e.event_type,
        case e.event_type
          when 'product_created' then 'Product created'
          when 'product_updated' then 'Product details updated'
          when 'product_archived' then 'Product archived'
          when 'product_restored' then 'Product restored'
          when 'unit_added' then 'Unit added'
          when 'unit_updated' then 'Unit updated'
          when 'unit_removed' then 'Unit removed'
          when 'tracking_started' then 'Product activity tracking started'
          else initcap(replace(e.event_type,'_',' '))
        end as summary,
        e.occurred_at,
        e.created_at as recorded_at,
        e.actor_name,
        null::uuid as branch_id,
        null::text as branch_name,
        null::numeric as quantity_delta,
        null::text as stock_uom,
        null::text as reference_type,
        null::text as reference_id,
        e.details
      from public.sellertray_product_activity_events e
      where e.tenant_id=p_tenant_id
        and e.catalog_item_id=p_product_id

      union all

      select
        im.id::text as event_id,
        'stock'::text as kind,
        im.movement_type as event_type,
        initcap(replace(im.movement_type,'_',' ')) as summary,
        im.business_at as occurred_at,
        im.created_at as recorded_at,
        coalesce(
          nullif(btrim(au.raw_user_meta_data->>'full_name'),''),
          nullif(btrim(au.raw_user_meta_data->>'name'),''),
          nullif(btrim(au.email),''),
          'SellerTray system'
        ) as actor_name,
        im.branch_id,
        b.name as branch_name,
        im.quantity_delta,
        im.stock_uom,
        im.reference_type,
        im.reference_id,
        jsonb_strip_nulls(jsonb_build_object(
          'reason',im.reason,
          'sourceQuantity',im.source_quantity,
          'sourceUom',im.source_uom,
          'conversionFactor',im.conversion_factor,
          'reversalOfMovementId',im.reversal_of_movement_id
        )) as details
      from public.inventory_movements im
      join public.branches b
        on b.tenant_id=im.tenant_id and b.id=im.branch_id
      left join auth.users au on au.id=im.actor_user_id
      where im.tenant_id=p_tenant_id
        and im.catalog_item_id=p_product_id
        and public.sellertray_user_can_read_branch(p_tenant_id,im.branch_id,v_user_id)
    ) activity
    order by activity.occurred_at desc,activity.recorded_at desc,activity.event_id desc
    limit v_limit
  ) x;

  return v_result;
end;
$$;

revoke all on table public.sellertray_product_activity_events from public,anon,authenticated;
revoke all on function public.get_sellertray_product_activity(uuid,uuid,integer) from public,anon;
grant execute on function public.get_sellertray_product_activity(uuid,uuid,integer) to authenticated,service_role;

commit;
