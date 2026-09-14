create or replace function public.audit_sellertray_order_item_commercial_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order_id uuid;
  v_customer_id uuid;
  v_currency text;
  v_requested_by text;
  v_action_type text;
  v_action_key text;
  v_risk text := 'medium';
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_financial_impact numeric;
  v_catalogue_created_now boolean := false;
begin
  v_tenant_id := coalesce(new.tenant_id,old.tenant_id);
  v_order_id := coalesce(new.order_id,old.order_id);

  if v_actor is null and tg_op in ('INSERT','DELETE') then
    return coalesce(new,old);
  end if;

  select o.customer_id,o.currency
  into v_customer_id,v_currency
  from public.orders o
  where o.id=v_order_id and o.tenant_id=v_tenant_id;

  v_requested_by := public.sellertray_commercial_actor_kind(v_tenant_id,v_actor);

  if tg_op='INSERT' then
    v_action_type := 'order_item_added';
    v_action_key := 'order-item:add:'||new.id::text;
    v_after := jsonb_build_object(
      'order_item_id',new.id,'catalog_item_id',new.catalog_item_id,
      'item_name',new.item_name,'original_item_name',new.original_item_name,
      'quantity',new.quantity,'unit_price',new.unit_price,
      'match_source',new.match_source,'match_confidence',new.match_confidence
    );
    if new.unit_price is not null then
      v_financial_impact := new.quantity * new.unit_price;
    end if;
  elsif tg_op='DELETE' then
    v_action_type := 'order_item_removed';
    v_action_key := 'order-item:remove:'||old.id::text;
    v_before := jsonb_build_object(
      'order_item_id',old.id,'catalog_item_id',old.catalog_item_id,
      'item_name',old.item_name,'original_item_name',old.original_item_name,
      'quantity',old.quantity,'unit_price',old.unit_price,
      'match_source',old.match_source,'match_confidence',old.match_confidence
    );
    if old.unit_price is not null then
      v_financial_impact := -(old.quantity * old.unit_price);
    end if;
  else
    if row(
      old.catalog_item_id,old.item_name,old.quantity,old.unit_price,old.match_source,old.match_confidence
    ) is not distinct from row(
      new.catalog_item_id,new.item_name,new.quantity,new.unit_price,new.match_source,new.match_confidence
    ) then
      return new;
    end if;

    if old.match_source='unmatched'
       and new.match_source='merchant_match'
       and new.catalog_item_id is not null then
      select ci.created_at = transaction_timestamp()
      into v_catalogue_created_now
      from public.catalog_items ci
      where ci.id=new.catalog_item_id and ci.tenant_id=new.tenant_id;

      if coalesce(v_catalogue_created_now,false) then
        v_action_type := 'catalogue_item_created_from_order';
        v_action_key := 'catalogue-create:'||new.id::text||':'||new.catalog_item_id::text;
      else
        v_action_type := 'order_item_matched_to_catalogue';
        v_action_key := 'catalogue-match:'||new.id::text||':'||new.catalog_item_id::text;
      end if;
    elsif old.match_source='unmatched' and new.match_source='one_off' then
      v_action_type := 'order_item_kept_one_off';
      v_action_key := 'catalogue-one-off:'||new.id::text;
    else
      v_action_type := 'order_item_updated';
      v_action_key := 'order-item:update:'||new.id::text||':'||
        md5(
          jsonb_build_object(
            'old_name',old.item_name,'new_name',new.item_name,
            'old_qty',old.quantity,'new_qty',new.quantity,
            'old_price',old.unit_price,'new_price',new.unit_price,
            'old_catalog',old.catalog_item_id,'new_catalog',new.catalog_item_id,
            'old_match',old.match_source,'new_match',new.match_source
          )::text
        );
    end if;

    v_before := jsonb_build_object(
      'order_item_id',old.id,'catalog_item_id',old.catalog_item_id,
      'item_name',old.item_name,'original_item_name',old.original_item_name,
      'quantity',old.quantity,'unit_price',old.unit_price,
      'match_source',old.match_source,'match_confidence',old.match_confidence
    );
    v_after := jsonb_build_object(
      'order_item_id',new.id,'catalog_item_id',new.catalog_item_id,
      'item_name',new.item_name,'original_item_name',new.original_item_name,
      'quantity',new.quantity,'unit_price',new.unit_price,
      'match_source',new.match_source,'match_confidence',new.match_confidence
    );

    v_financial_impact :=
      coalesce(new.quantity * new.unit_price,0) -
      coalesce(old.quantity * old.unit_price,0);
  end if;

  insert into public.commercial_action_ledger(
    tenant_id,action_key,channel,customer_id,target_order_id,
    action_type,risk_class,requested_by,actor_user_id,
    policy_result,action_status,financial_impact,currency,
    before_state,after_state,metadata,applied_at
  )
  values(
    v_tenant_id,v_action_key,'merchant_app',v_customer_id,v_order_id,
    v_action_type,v_risk,v_requested_by,v_actor,
    'allowed','applied',v_financial_impact,v_currency,
    v_before,v_after,
    jsonb_build_object(
      'order_item_id',coalesce(new.id,old.id),
      'customer_wording',coalesce(new.original_item_name,old.original_item_name,new.item_name,old.item_name)
    ),
    now()
  )
  on conflict(tenant_id,action_key) do nothing;

  return coalesce(new,old);
end;
$$;

revoke all on function public.audit_sellertray_order_item_commercial_change()
from public,anon,authenticated;

drop trigger if exists audit_sellertray_order_item_commercial_change on public.order_items;
create trigger audit_sellertray_order_item_commercial_change
after insert or update or delete on public.order_items
for each row execute function public.audit_sellertray_order_item_commercial_change();
