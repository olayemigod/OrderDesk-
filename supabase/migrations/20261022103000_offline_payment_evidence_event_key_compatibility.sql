begin;

-- Keep historical Bank evidence event identity stable while the generic offline
-- payment allocator adds Card/terminal evidence. This prevents a previously
-- replayed Bank allocation from gaining a second audit row solely because the
-- mobile payment surface was generalized.
create or replace function public.record_sellertray_payment_event(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_id uuid,
  p_provider text,
  p_event_key text,
  p_event_type text,
  p_source text,
  p_verification_status text,
  p_provider_event_id text default null,
  p_provider_transaction_id text default null,
  p_payload_sha256 text default null,
  p_verification_result jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_id uuid;
  v_event_key text:=p_event_key;
begin
  if p_provider='manual_bank'
     and p_event_type='offline_bank_evidence'
     and p_event_key like 'offline-payment-evidence:%' then
    v_event_key:='offline-bank-evidence:'||substr(p_event_key,length('offline-payment-evidence:')+1);
  elsif p_provider='manual_card'
        and p_event_type='offline_card_evidence'
        and p_event_key like 'offline-payment-evidence:%' then
    v_event_key:='offline-card-evidence:'||substr(p_event_key,length('offline-payment-evidence:')+1);
  end if;

  insert into public.order_payment_events (
    tenant_id,order_id,payment_id,provider,event_key,event_type,source,
    verification_status,provider_event_id,provider_transaction_id,payload_sha256,
    verification_result,processed_at
  ) values (
    p_tenant_id,p_order_id,p_payment_id,p_provider,v_event_key,p_event_type,p_source,
    p_verification_status,nullif(btrim(p_provider_event_id),''),
    nullif(btrim(p_provider_transaction_id),''),
    nullif(upper(btrim(p_payload_sha256)),''),
    coalesce(p_verification_result,'{}'::jsonb),
    case when p_verification_status<>'received' then now() else null end
  )
  on conflict (tenant_id,provider,event_key) do update
  set verification_status=excluded.verification_status,
      provider_event_id=coalesce(public.order_payment_events.provider_event_id,excluded.provider_event_id),
      provider_transaction_id=coalesce(public.order_payment_events.provider_transaction_id,excluded.provider_transaction_id),
      payload_sha256=coalesce(public.order_payment_events.payload_sha256,excluded.payload_sha256),
      verification_result=excluded.verification_result,
      processed_at=case when excluded.verification_status<>'received' then now()
                        else public.order_payment_events.processed_at end
  returning id into v_id;

  return v_id;
end;
$function$;

commit;
