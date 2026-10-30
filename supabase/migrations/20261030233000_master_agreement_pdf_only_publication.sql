-- SellerTray Master Agreement publication convergence.
-- The reviewed source PDF is now the required Admin publication authority.
-- Keep the older text publisher as an internal implementation primitive because
-- publish_sellertray_master_agreement_pdf_admin invokes it under SECURITY DEFINER,
-- but prevent service_role/PostgREST callers from invoking the weaker path directly.

revoke execute on function public.publish_sellertray_master_agreement_admin(
  text,
  text,
  text,
  timestamptz,
  text,
  uuid
) from service_role;

grant execute on function public.publish_sellertray_master_agreement_pdf_admin(
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  bigint,
  integer,
  text,
  uuid,
  uuid
) to service_role;

comment on function public.publish_sellertray_master_agreement_admin(text,text,text,timestamptz,text,uuid) is
  'Internal SellerTray Master Agreement version primitive. Direct service-role publication is retired; publish reviewed legal versions through publish_sellertray_master_agreement_pdf_admin.';

comment on function public.publish_sellertray_master_agreement_pdf_admin(text,text,text,timestamptz,text,text,text,bigint,integer,text,uuid,uuid) is
  'Authoritative ProcessEdge Admin publication path for immutable SellerTray Master Agreement versions. Requires reviewed source PDF evidence and admin.agreements.publish authority.';