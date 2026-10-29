alter table public.commercial_action_ledger
  drop constraint if exists commercial_action_ledger_actor_user_id_fkey;

alter table public.commercial_action_ledger
  add constraint commercial_action_ledger_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete set null;

create or replace function public.sellertray_commercial_actor_kind(
  p_tenant_id uuid,
  p_user_id uuid
)
returns text
language sql
security definer
set search_path=''
stable
as $$
  select case
    when p_user_id is null then 'system'
    when exists(
      select 1 from public.tenant_members tm
      where tm.tenant_id=p_tenant_id
        and tm.user_id=p_user_id
        and tm.role='staff'
    ) then 'staff'
    when exists(
      select 1 from public.tenant_members tm
      where tm.tenant_id=p_tenant_id
        and tm.user_id=p_user_id
    ) then 'merchant'
    else 'system'
  end;
$$;

drop function if exists public.sellertray_list_commercial_actions(uuid,integer);

create function public.sellertray_list_commercial_actions(
  p_tenant_id uuid,
  p_limit integer default 100
)
returns table(
  id uuid,
  created_at timestamptz,
  action_type text,
  risk_class text,
  requested_by text,
  actor_user_id uuid,
  actor_name text,
  interpretation_source text,
  interpretation_confidence numeric,
  policy_result text,
  action_status text,
  customer_name text,
  order_ref text,
  channel text,
  financial_impact numeric,
  currency text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Owner or Manager access is required for commercial audit';
  end if;

  return query
  select
    a.id,a.created_at,a.action_type,a.risk_class,a.requested_by,a.actor_user_id,
    case
      when a.actor_user_id is null then initcap(replace(a.requested_by,'_',' '))
      else coalesce(
        nullif(btrim(au.raw_user_meta_data->>'full_name'),''),
        nullif(btrim(au.raw_user_meta_data->>'name'),''),
        nullif(btrim(au.email),''),
        initcap(replace(a.requested_by,'_',' '))
      )
    end as actor_name,
    a.interpretation_source,a.interpretation_confidence,
    a.policy_result,a.action_status,
    coalesce(nullif(btrim(c.display_name),''),c.phone,c.wa_id,'Customer'),
    o.public_order_id,a.channel,a.financial_impact,a.currency,
    a.before_state,a.after_state,a.metadata
  from public.commercial_action_ledger a
  left join public.customers c on c.id=a.customer_id and c.tenant_id=a.tenant_id
  left join public.orders o on o.id=a.target_order_id and o.tenant_id=a.tenant_id
  left join auth.users au on au.id=a.actor_user_id
  where a.tenant_id=p_tenant_id
  order by a.created_at desc
  limit greatest(1,least(coalesce(p_limit,100),500));
end;
$$;

revoke all on function public.sellertray_list_commercial_actions(uuid,integer)
from public,anon;
grant execute on function public.sellertray_list_commercial_actions(uuid,integer)
to authenticated,service_role;
