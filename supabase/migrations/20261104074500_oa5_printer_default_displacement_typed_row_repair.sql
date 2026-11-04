-- OA5 forward-only convergence: a second default printer currently causes
-- 42846 in save_sellertray_printer's displaced-default loop.
-- The canonical function declares v_other as untyped record while
-- sellertray_printer_state expects public.sellertray_printers. This affects
-- merchant and ProcessEdge installer printer setup equally.
--
-- Recompile ONLY this local row declaration from the currently installed
-- canonical function. Do not fork or copy the Merchant/Branch/installer
-- authorization, default-printer transaction logic or immutable print events.
-- Keeping the existing function body preserves future approved capability
-- gates and the intentionally unchanged merchant printer contract.
begin;

do $printer_type_repair$
declare
  v_target regprocedure :=
    'public.save_sellertray_printer(uuid,uuid,uuid,uuid,text,text,integer,boolean,boolean,uuid)'::regprocedure;
  v_source text;
  v_old text := 'v_other record;';
  v_new text := 'v_other public.sellertray_printers%rowtype;';
begin
  select pg_get_functiondef(v_target::oid) into v_source;

  if v_source is null then
    raise exception 'Canonical SellerTray printer save function is missing'
      using errcode='55000';
  end if;

  if strpos(v_source,v_new)>0 and strpos(v_source,v_old)=0 then
    -- Safe replay on a schema that already received this exact correction.
    return;
  end if;

  if strpos(v_source,v_old)=0
    or strpos(substring(v_source from strpos(v_source,v_old)+length(v_old)),v_old)>0
    or strpos(v_source,'sellertray_setup_installer_device_allowed')=0
    or strpos(v_source,'sellertray_printer_events')=0
    or strpos(v_source,'sellertray_printer_state(v_other)')=0 then
    raise exception 'Unexpected canonical printer authority version; manually reconcile typed row fix'
      using errcode='55000';
  end if;

  execute replace(v_source,v_old,v_new);
end;
$printer_type_repair$;

-- This is only a type-correctness repair. The original function identity,
-- execution grants, security definer, Branch gates and event hooks remain.
commit;
