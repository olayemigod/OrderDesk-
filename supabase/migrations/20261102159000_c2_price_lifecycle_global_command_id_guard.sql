begin;

-- Restore the global lifecycle command-ID contract while retaining the per-price
-- serialization added by the prior review repair. Command identity is acquired
-- first; only a new command then acquires the price lifecycle lock and evaluates
-- current state. This keeps retries deterministic and prevents one command ID
-- from mutating different price versions.
create or replace function public.control_sellertray_commercial_v2_price_version_admin(
  p_price_version_id uuid,
  p_action text,
  p_reason text,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_target public.sellertray_commercial_price_versions%rowtype;
  v_state text;
  v_existing_ids uuid[];
  v_existing_action_min text;
  v_existing_action_max text;
  v_existing_reason_min text;
  v_existing_reason_max text;
  v_lock_identity text;
  v_control_at timestamptz;
begin
  if p_price_version_id is null
     or p_command_id is null
     or v_action not in ('pause','resume','deactivate','void')
     or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Price version, valid lifecycle action, command id and reason are required' using errcode='22023';
  end if;

  select p.* into strict v_target
  from public.sellertray_commercial_price_versions p
  where p.id=p_price_version_id;

  if v_target.plan_code is not null and v_target.price_kind='subscription' then
    raise exception 'Legacy plan-code subscription prices remain governed by the compatibility lifecycle command' using errcode='22023';
  end if;

  if v_target.price_scope='standard' then
    if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',null,now()) then
      raise exception 'Platform pricing management capability required' using errcode='42501';
    end if;
  else
    if not public.platform_admin_has_capability(p_actor_user_id,'admin.pricing.manage',v_target.tenant_id,now()) then
      raise exception 'Business pricing management capability required' using errcode='42501';
    end if;
  end if;

  -- A lifecycle command ID is global business identity, not scoped to one row.
  -- Serialize it before checking prior facts so two concurrent uses on different
  -- price versions cannot both pass an empty-ledger read.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sellertray-price-control-command|'||p_command_id::text,0)
  );

  select
    array_agg(c.price_version_id order by c.price_version_id),
    min(c.control_action),max(c.control_action),min(c.reason),max(c.reason)
  into
    v_existing_ids,
    v_existing_action_min,v_existing_action_max,
    v_existing_reason_min,v_existing_reason_max
  from public.sellertray_commercial_price_version_controls c
  where c.command_id=p_command_id;

  if coalesce(cardinality(v_existing_ids),0)>0 then
    if v_existing_ids=array[p_price_version_id]
       and v_existing_action_min=v_action
       and v_existing_action_max=v_action
       and v_existing_reason_min=v_reason
       and v_existing_reason_max=v_reason then
      return jsonb_build_object(
        'priceVersionId',p_price_version_id,
        'action',v_action,
        'state',public.sellertray_commercial_price_version_state(p_price_version_id,clock_timestamp()),
        'alreadyApplied',true
      );
    end if;
    raise exception 'Price lifecycle command id already belongs to different facts' using errcode='23505';
  end if;

  -- Branch setup remains reachable through the compatibility controller, so use
  -- its exact lifecycle lock. Other C2 subjects serialize by immutable price row.
  if v_target.price_kind='branch_setup' then
    v_lock_identity:=concat_ws(
      '|','sellertray-price-lifecycle-v1','branch_setup',v_target.id::text
    );
  else
    v_lock_identity:=concat_ws(
      '|','sellertray-price-lifecycle-v2',v_target.price_kind,v_target.id::text
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_identity,0));
  v_control_at:=clock_timestamp();

  v_state:=public.sellertray_commercial_price_version_state(p_price_version_id,v_control_at);
  if v_action='pause' and v_state<>'active' then
    raise exception 'Only an active price version can be paused' using errcode='23514';
  end if;
  if v_action='resume' and v_state<>'paused' then
    raise exception 'Only a paused price version can be resumed' using errcode='23514';
  end if;
  if v_action in ('deactivate','void') and v_state in ('deactivated','voided') then
    raise exception 'A deactivated or voided price version is terminal' using errcode='23514';
  end if;
  if v_action='void' then
    if v_target.effective_from<=v_control_at then
      raise exception 'Void is only allowed before a price version becomes effective' using errcode='23514';
    end if;
    if exists(
      select 1 from public.sellertray_commercial_order_price_snapshots s
      where s.source_price_version_id=p_price_version_id
    ) then
      raise exception 'A price version already used by an order cannot be voided' using errcode='23514';
    end if;
    if exists(
      select 1 from public.sellertray_commercial_price_versions p
      where p.source_standard_price_version_id=p_price_version_id
    ) then
      raise exception 'A standard price referenced by a Business override cannot be voided' using errcode='23514';
    end if;
  end if;

  insert into public.sellertray_commercial_price_version_controls(
    price_version_id,control_action,command_id,controlled_by_user_id,effective_at,reason
  ) values(
    p_price_version_id,v_action,p_command_id,p_actor_user_id,v_control_at,v_reason
  );

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,v_target.tenant_id,'sellertray_control_commercial_v2_price_version',
    jsonb_build_object(
      'priceVersionId',p_price_version_id,
      'controlAction',v_action,
      'priceKind',v_target.price_kind,
      'planProfileVersionId',v_target.plan_profile_version_id,
      'addonVersionId',v_target.addon_version_id,
      'commandId',p_command_id,
      'controlAt',v_control_at,
      'reason',v_reason
    )
  );

  return jsonb_build_object(
    'priceVersionId',p_price_version_id,
    'action',v_action,
    'state',public.sellertray_commercial_price_version_state(p_price_version_id,v_control_at),
    'alreadyApplied',false
  );
end;
$function$;

revoke all on function public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.control_sellertray_commercial_v2_price_version_admin(uuid,text,text,uuid,uuid)
  to service_role;

commit;
