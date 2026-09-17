-- SellerTray P0 shared inbox: expose a tenant-guarded chronological WhatsApp thread
-- without granting clients broader direct access to internal operational tables.

begin;

create or replace function public.sellertray_list_conversation_messages(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_limit integer default 100
)
returns table(
  message_id uuid,
  direction text,
  actor text,
  message_text text,
  message_type text,
  delivery_status text,
  event_key text,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_limit integer := greatest(1,least(coalesce(p_limit,100),200));
begin
  if p_tenant_id is null or p_customer_id is null then
    raise exception 'Business and customer are required' using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=(select auth.uid())
  ) then
    raise exception 'You do not have access to this business' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.tenant_id=p_tenant_id
      and c.id=p_customer_id
  ) then
    raise exception 'Customer not found' using errcode='P0002';
  end if;

  return query
  select e.message_id,
         e.direction,
         e.actor,
         e.message_text,
         e.message_type,
         e.delivery_status,
         e.event_key,
         e.occurred_at
  from (
    select recent.*
    from (
      select
        im.id as message_id,
        'inbound'::text as direction,
        'customer'::text as actor,
        coalesce(
          nullif(btrim(im.text_body),''),
          '[' || coalesce(nullif(btrim(im.message_type),''),'message') || ']'
        ) as message_text,
        coalesce(nullif(btrim(im.message_type),''),'message')::text as message_type,
        null::text as delivery_status,
        null::text as event_key,
        im.received_at as occurred_at
      from public.inbound_messages im
      where im.tenant_id=p_tenant_id
        and im.customer_id=p_customer_id

      union all

      select
        n.id as message_id,
        'outbound'::text as direction,
        case
          when n.event_key='merchant_conversation_reply' then 'merchant'
          else 'sellertray'
        end::text as actor,
        n.message_body::text as message_text,
        case when n.media_type is null then 'text' else n.media_type end::text as message_type,
        n.delivery_status::text as delivery_status,
        n.event_key::text as event_key,
        coalesce(n.sent_at,n.created_at) as occurred_at
      from public.outbound_notifications n
      where n.tenant_id=p_tenant_id
        and n.customer_id=p_customer_id
    ) recent
    order by recent.occurred_at desc,recent.message_id desc
    limit v_limit
  ) e
  order by e.occurred_at asc,e.message_id asc;
end;
$$;

revoke all on function public.sellertray_list_conversation_messages(uuid,uuid,integer)
from public,anon;
grant execute on function public.sellertray_list_conversation_messages(uuid,uuid,integer)
to authenticated;

commit;
