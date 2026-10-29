-- Merchant Agreement Center response hardening.
-- Keep agreement/payment authority unchanged while returning only the summary
-- needed by Merchant Web. Full legal text remains in immutable Master/Order Form
-- records and in the governed Agreement Package PDF generated server-side.

create or replace function public.get_sellertray_agreement_package_center(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_can_accept boolean:=false;
  v_master_id uuid;
  v_master jsonb:=null;
  v_master_accepted boolean:=false;
  v_forms jsonb:='[]'::jsonb;
begin
  select tm.role
  into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id
    and tm.user_id=p_actor_user_id;

  if coalesce(v_role,'') not in ('owner','manager') then
    raise exception 'Agreement access requires a Business Owner or Manager' using errcode='42501';
  end if;

  v_can_accept:=public.sellertray_user_has_capability(
    p_tenant_id,
    p_actor_user_id,
    'can_accept_commercial_agreements'
  );
  v_master_id:=public.resolve_sellertray_master_agreement_version_id(now());

  if v_master_id is not null then
    select
      jsonb_build_object(
        'id',v.id,
        'versionCode',v.version_code,
        'title',v.title,
        'contentSha256',v.content_sha256,
        'effectiveFrom',v.effective_from,
        'acceptance',case when a.id is null then null else jsonb_build_object(
          'id',a.id,
          'acceptedAt',a.accepted_at,
          'acceptedLegalName',a.accepted_legal_name,
          'acceptedRole',a.accepted_role,
          'acceptedByCurrentUser',a.accepted_by_user_id=p_actor_user_id
        ) end
      ),
      a.id is not null
    into v_master,v_master_accepted
    from public.sellertray_master_agreement_versions v
    left join public.sellertray_master_agreement_acceptances a
      on a.tenant_id=p_tenant_id
      and a.agreement_version_id=v.id
    where v.id=v_master_id;
  end if;

  select coalesce(jsonb_agg(row_value order by is_current desc,issued_at desc,form_id),'[]'::jsonb)
  into v_forms
  from (
    select
      f.id form_id,
      f.issued_at,
      not exists (
        select 1
        from public.sellertray_commercial_order_forms r
        where r.tenant_id=f.tenant_id
          and r.supersedes_order_form_id=f.id
      ) is_current,
      jsonb_build_object(
        'id',f.id,
        'reference',f.order_form_reference,
        'title',t.title,
        'templateVersion',f.template_version_code,
        'contentSha256',f.content_sha256,
        'commercialSnapshot',f.commercial_snapshot,
        'commercialSnapshotSha256',f.commercial_snapshot_sha256,
        'commercialOrderId',f.commercial_order_id,
        'installmentObligationId',f.installment_obligation_id,
        'supersedesOrderFormId',f.supersedes_order_form_id,
        'isCurrent',not exists (
          select 1
          from public.sellertray_commercial_order_forms r
          where r.tenant_id=f.tenant_id
            and r.supersedes_order_form_id=f.id
        ),
        'issuedAt',f.issued_at,
        'confirmation',case when c.id is null then null else jsonb_build_object(
          'id',c.id,
          'confirmedAt',c.confirmed_at,
          'confirmedLegalName',c.confirmed_legal_name,
          'confirmedRole',c.confirmed_role,
          'confirmedByCurrentUser',c.confirmed_by_user_id=p_actor_user_id,
          'packageFingerprint',c.package_fingerprint
        ) end
      ) row_value
    from public.sellertray_commercial_order_forms f
    join public.sellertray_commercial_agreement_template_versions t
      on t.id=f.order_form_template_version_id
    left join public.sellertray_order_form_confirmations c
      on c.tenant_id=f.tenant_id
      and c.order_form_id=f.id
    where f.tenant_id=p_tenant_id
  ) projected;

  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'actorRole',v_role,
    'canAccept',v_can_accept,
    'masterAgreement',v_master,
    'masterAcceptanceRequired',v_master_id is not null and not v_master_accepted,
    'orderForms',v_forms
  );
end;
$$;

revoke all on function public.get_sellertray_agreement_package_center(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_agreement_package_center(uuid,uuid)
  to service_role;
