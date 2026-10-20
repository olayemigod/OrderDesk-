begin;

-- C1 helper functions are service-role-only and do not need owner-privilege
-- execution. Keep them SECURITY INVOKER so RLS/table grants remain authoritative.

alter function public.resolve_sellertray_commercial_price_version(
  text,text,text,text,timestamptz
) security invoker;

alter function public.append_sellertray_commercial_entitlement_event(
  uuid,text,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid,text
) security invoker;

commit;
