create or replace function public.audit_sellertray_change_request()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_actor uuid;
  v_requested_by text;
  v_action_type text;
  v_risk text;
  v_policy text;
  v_action_status text;
begin
  select * into v_order
  from public.orders o
  where o.id=coalesce(new.order_id,old.order_id)
    and o.tenant_id=coalesce(new.tenant_id,old.tenant_id);

  if tg_op='INSERT' then
    v_action_type := case new.request_kind
      when 'add_items' then 'order_add_items_requested'
      when 'remove_items' then 'order_remove_items_requested'
      when 'change_items' then 'order_change_requested'
      when 'cancel_order' then 'order_cancel_requested'
      else 'order_change_requested'
    end;
    v_risk := case when new.request_kind='cancel_order' then 'high' else 'medium' end;

    insert into public.commercial_action_ledger(
      tenant_id,action_key,channel,source_inbound_message_id,customer_id,target_order_id,
      action_type,risk_class,requested_by,policy_result,action_status,
      before_state,after_state,metadata
    )
    values(
      new.tenant_id,new.source_inbound_message_id::text||':'||v_action_type,
      'whatsapp',new.source_inbound_message_id,new.customer_id,new.order_id,
      v_action_type,v_risk,'customer','pending','requested',
      jsonb_build_object(
        'status',v_order.status,'payment_status',v_order.payment_status,
        'amount_paid',v_order.amount_paid,'total_amount',v_order.total_amount,
        'fulfillment_status',v_order.fulfillment_status
      ),
      '{}'::jsonb,
      jsonb_build_object('request_id',new.id,'request_kind',new.request_kind,'request_text',new.request_text)
    )
    on conflict(tenant_id,action_key) do update
    set before_state=excluded.before_state,
        metadata=excluded.metadata;
    return new;
  end if;

  if old.status is distinct from new.status and new.status <> 'pending' then
    v_actor := coalesce(new.resolved_by_user_id,auth.uid());
    v_requested_by := public.sellertray_commercial_actor_kind(new.tenant_id,v_actor);

    v_policy := case
      when new.status='resolved' then 'allowed'
      when new.status='rejected' then 'blocked'
      else 'pending'
    end;
    v_action_status := case
      when new.status='resolved' then 'applied'
      when new.status='rejected' then 'rejected'
      else 'requested'
    end;

    insert into public.commercial_action_ledger(
      tenant_id,action_key,channel,source_inbound_message_id,customer_id,target_order_id,
      action_type,risk_class,requested_by,actor_user_id,
      policy_result,action_status,before_state,after_state,metadata,applied_at
    )
    values(
      new.tenant_id,'change-resolution:'||new.id::text||':'||new.status,
      'merchant_app',new.source_inbound_message_id,new.customer_id,new.order_id,
      'order_change_request_'||new.status,
      case when new.request_kind='cancel_order' then 'high' else 'medium' end,
      v_requested_by,v_actor,
      v_policy,v_action_status,
      jsonb_build_object(
        'request_status',old.status,'order_status',v_order.status,
        'payment_status',v_order.payment_status,'fulfillment_status',v_order.fulfillment_status
      ),
      jsonb_build_object(
        'request_status',new.status,'order_status',v_order.status,
        'payment_status',v_order.payment_status,'fulfillment_status',v_order.fulfillment_status
      ),
      jsonb_build_object('request_id',new.id,'request_kind',new.request_kind,'request_text',new.request_text),
      case when new.status in ('resolved','rejected') then now() else null end
    )
    on conflict(tenant_id,action_key) do nothing;
  end if;

  return new;
end;
$$;
