do $$
declare v_oid oid;v_def text;v_fixed text;
begin
 select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellertray_report_center' and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_days integer';
 if v_oid is null then raise exception 'sellertray_report_center signature not found';end if;
 v_def:=pg_get_functiondef(v_oid);
 v_fixed:=replace(v_def,'po.deleted_at is null and o.status=''completed'' and o.created_at>=v_since','po.created_at>=v_since');
 v_fixed:=replace(v_fixed,'and o.created_at>=v_since','and o.deleted_at is null and o.status=''completed'' and o.created_at>=v_since');
 if position('po.deleted_at is null and o.status=''completed''' in v_fixed)>0 then raise exception 'sellertray_report_center purchase scope is still corrupted';end if;
 if position('o.deleted_at is null and o.status=''completed'' and o.created_at>=v_since' in v_fixed)=0 then raise exception 'sellertray_report_center sales scope was not hardened';end if;
 execute v_fixed;
end$$;
revoke all on function public.sellertray_report_center(uuid,integer) from public,anon;
grant execute on function public.sellertray_report_center(uuid,integer) to authenticated,service_role;
