begin;

-- Split current Order Form legal administration from universal Master publication
-- and retire the service-role mutation surface of legacy C1A agreement APIs.
alter table public.platform_admin_capability_grant_versions
  drop constraint if exists platform_admin_capability_code_check,
  add constraint platform_admin_capability_code_check
  check (capability_code = any (array[
    'admin.pricing.manage'::text,
    'admin.payments.reconcile'::text,
    'admin.installments.manage'::text,
    'admin.branch_setup.manage'::text,
    'admin.agreements.publish'::text,
    'admin.order_forms.publish'::text,
    'admin.order_forms.issue'::text
  ]));

create or replace function public.publish_sellertray_order_form_template_admin(
  p_agreement_family text,
  p_version_code text,
  p_title text,
  p_content_body text,
  p_effective_from timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_family text:=lower(btrim(coalesce(p_agreement_family,'')));
  v_reason text:=btrim(coalesce(p_reason,''));
  v_id uuid;
begin
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.order_forms.publish',null,now()
  ) then
    raise exception 'Order Form template publication capability required' using errcode='42501';
  end if;
  if v_family not in ('subscription_order','installment_agreement') then
    raise exception 'Only SellerTray Order Form template families may be published here' using errcode='23514';
  end if;
  if char_length(v_reason) not between 6 and 1000 then
    raise exception 'Order Form template publication reason must be between 6 and 1000 characters' using errcode='22023';
  end if;

  v_id:=public.publish_sellertray_commercial_agreement_template_version(
    v_family,p_version_code,p_title,p_content_body,p_effective_from,p_actor_user_id
  );
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values (p_actor_user_id,null,'sellertray_order_form_template_published',jsonb_build_object(
    'templateVersionId',v_id,
    'agreementFamily',v_family,
    'versionCode',btrim(coalesce(p_version_code,'')),
    'effectiveFrom',p_effective_from,
    'reason',v_reason
  ));
  return v_id;
end;
$$;
revoke all on function public.publish_sellertray_order_form_template_admin(text,text,text,text,timestamptz,text,uuid)
  from public,anon,authenticated;
grant execute on function public.publish_sellertray_order_form_template_admin(text,text,text,text,timestamptz,text,uuid)
  to service_role;

-- Preserve legacy rows/read models, but old web boundaries may no longer create
-- or accept legacy merchant-specific agreements/templates.
revoke execute on function public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)
  from service_role;
revoke execute on function public.issue_sellertray_commercial_agreement_admin(uuid,uuid,uuid,uuid,text,text,uuid,text,uuid)
  from service_role;
revoke execute on function public.publish_sellertray_commercial_agreement_template_admin(text,text,text,text,timestamptz,text,uuid)
  from service_role;
revoke execute on function public.publish_sellertray_commercial_agreement_template_version(text,text,text,text,timestamptz,uuid)
  from service_role;

commit;
