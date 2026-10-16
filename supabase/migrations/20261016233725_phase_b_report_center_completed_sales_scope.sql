do $$
declare v_oid oid;v_def text;v_hardened text;
begin
 select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellertray_report_center' and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_days integer';
 if v_oid is null then raise exception 'sellertray_report_center signature not found';end if;
 v_def:=pg_get_functiondef(v_oid);
 if position('o.created_at>=v_since' in v_def)=0 then raise exception 'sellertray_report_center expected sales scope not found';end if;
 v_hardened:=replace(v_def,'o.created_at>=v_since','o.deleted_at is null and o.status=''completed'' and o.created_at>=v_since');
 execute v_hardened;
end$$;
revoke all on function public.sellertray_report_center(uuid,integer) from public,anon;
grant execute on function public.sellertray_report_center(uuid,integer) to authenticated,service_role;
