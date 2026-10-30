begin;

-- A missing published Master Agreement is a governed blocker, not a malformed
-- package document. PostgreSQL jsonb null is not SQL NULL, so test the JSON
-- type explicitly before composing the merchant-facing masterAgreement object.
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
  v_master jsonb;
  v_forms jsonb;
  v_legacy jsonb;
  v_master_document jsonb;
begin
  v_master := public.get_sellertray_master_agreement_center(p_tenant_id,p_actor_user_id);

  if jsonb_typeof(v_master->'currentVersion')='object' then
    v_master_document := (v_master->'currentVersion')
      || jsonb_build_object('acceptance',v_master->'acceptance');
  else
    v_master_document := null;
  end if;

  select coalesce(jsonb_agg(row_value order by is_current desc,issued_at desc,form_id),'[]'::jsonb)
  into v_forms
  from (
    select f.id form_id,f.issued_at,
      not exists (
        select 1 from public.sellertray_commercial_order_forms r
        where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id
      ) is_current,
      jsonb_build_object(
        'id',f.id,
        'reference',f.order_form_reference,
        'title',t.title,
        'templateVersion',f.template_version_code,
        'templateContentSha256',f.template_content_sha256,
        'renderedContent',f.rendered_content,
        'contentSha256',f.content_sha256,
        'commercialSnapshot',f.commercial_snapshot,
        'commercialSnapshotSha256',f.commercial_snapshot_sha256,
        'commercialOrderId',f.commercial_order_id,
        'installmentObligationId',f.installment_obligation_id,
        'supersedesOrderFormId',f.supersedes_order_form_id,
        'isCurrent',not exists (
          select 1 from public.sellertray_commercial_order_forms r
          where r.tenant_id=f.tenant_id and r.supersedes_order_form_id=f.id
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
      on c.tenant_id=f.tenant_id and c.order_form_id=f.id
    where f.tenant_id=p_tenant_id
  ) projected;

  v_legacy := public.get_sellertray_commercial_agreement_center(p_tenant_id,p_actor_user_id)->'agreements';

  return v_master || jsonb_build_object(
    'masterAgreement',v_master_document,
    'masterAcceptanceRequired',coalesce((v_master->>'acceptanceRequired')::boolean,false),
    'orderForms',v_forms,
    'legacyAgreements',coalesce(v_legacy,'[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_sellertray_agreement_package_center(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_agreement_package_center(uuid,uuid)
  to service_role;

commit;
