-- Preserve the original client event time for governed mobile inventory commands
-- without changing the authoritative RPC signature or weakening idempotency.
-- Internal/server inventory workflows keep server transaction time.

create or replace function public.sellertray_inventory_command_business_at(
  p_command_id text,
  p_fallback timestamptz
)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path=''
as $$
declare
  v_command_id text := lower(btrim(coalesce(p_command_id,'')));
  v_timestamp_token text;
  v_value numeric := 0;
  v_digit integer;
  v_index integer;
  v_char text;
  v_decoded timestamptz;
begin
  if p_fallback is null then
    return null;
  end if;

  if v_command_id !~ '^invop:(receive|adjust):[0-9a-z]+:[0-9a-z]+$' then
    return p_fallback;
  end if;

  v_timestamp_token := split_part(v_command_id,':',3);
  if length(v_timestamp_token)<6 or length(v_timestamp_token)>16 then
    return p_fallback;
  end if;

  for v_index in 1..length(v_timestamp_token) loop
    v_char := substr(v_timestamp_token,v_index,1);
    v_digit := strpos('0123456789abcdefghijklmnopqrstuvwxyz',v_char)-1;
    if v_digit<0 then
      return p_fallback;
    end if;
    v_value := (v_value*36)+v_digit;
    if v_value>253402300799999 then
      return p_fallback;
    end if;
  end loop;

  v_decoded := pg_catalog.to_timestamp((v_value/1000)::double precision);
  if v_decoded<timestamptz '2020-01-01 00:00:00+00'
     or v_decoded>p_fallback+interval '5 minutes' then
    return p_fallback;
  end if;

  return v_decoded;
exception when others then
  return p_fallback;
end;
$$;

revoke all on function public.sellertray_inventory_command_business_at(text,timestamptz)
  from public,anon,authenticated;

-- Patch only the command-aware inventory authority. Fail closed if its known
-- ledger-posting anchor changed, rather than silently rewriting a newer body.
do $$
declare
  v_definition text;
  v_anchor text := E'        v_idempotency_key,\n        now(),\n        p_actor_user_id,';
  v_replacement text := E'        v_idempotency_key,\n        public.sellertray_inventory_command_business_at(v_command_id,now()),\n        p_actor_user_id,';
  v_hits integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.apply_sellertray_inventory_operation(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::pg_catalog.regprocedure
  ) into v_definition;

  v_hits := (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor);
  if v_hits<>1 then
    raise exception 'SellerTray inventory authority body changed; expected exactly one business-time anchor, found %',v_hits;
  end if;

  execute replace(v_definition,v_anchor,v_replacement);
end;
$$;

revoke all on function public.apply_sellertray_inventory_operation(
  uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.apply_sellertray_inventory_operation(
  uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid
) to service_role;
