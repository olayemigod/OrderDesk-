begin;

-- Clean-schema replay compatibility for the Build 42 first-purchase core extraction.
--
-- 20261030090000_merchant_first_purchase_authority.sql deliberately derives the
-- shared commercial constructor from the already-governed C1B Admin implementation
-- so Merchant Web and Admin keep one commercial/pricing truth. PostgreSQL preserves
-- the historical PL/pgSQL body formatting on a clean replay, where the Admin guard
-- spans multiple lines. The extraction migration also supports the compact form that
-- existed in the live environment when Build 42 was first applied.
--
-- Normalize only that historical authorization block before extraction. This does
-- not change authorization or commercial behavior: the function remains Admin-only
-- until the next migration extracts the shared core and recreates the guarded Admin
-- wrapper. Keeping this as a separate pre-extraction compatibility migration avoids
-- rewriting the already-applied Build 42 migration in production.

do $migration$
declare
  v_source text;
  v_multiline_guard text := E'  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;\n  if v_role<>''admin'' then\n    raise exception ''Platform admin role required for this action'' using errcode=''42501'';\n  end if;\n';
  v_compact_guard text := E'  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;\n  if v_role<>''admin'' then raise exception ''Platform admin role required for this action'' using errcode=''42501''; end if;\n';
begin
  select pg_get_functiondef(p.oid)
  into v_source
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='create_sellertray_initial_installment_purchase_admin_impl'
  limit 1;

  if v_source is null then
    raise exception 'Initial installment purchase implementation is missing';
  end if;

  if position(v_compact_guard in v_source)>0 then
    -- Already compatible with the extraction migration; leave it unchanged.
    return;
  end if;

  if position(v_multiline_guard in v_source)=0 then
    raise exception 'Initial purchase Admin authorization block has an unexpected shape';
  end if;

  v_source:=replace(v_source,v_multiline_guard,v_compact_guard);
  execute v_source;
end
$migration$;

commit;