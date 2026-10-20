begin;

-- C1A agreement issuance is retry-safe on the governed agreement reference.
-- Identical retries return the existing agreement; reuse of the same reference
-- for different contractual facts fails closed.

create or replace function public.issue_sellertray_commercial_agreement(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid,
  p_template_version_id uuid,
  p_agreement_reference text,
  p_rendered_content text,
  p_commercial_snapshot jsonb,
  p_supersedes_agreement_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_id uuid;
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_existing public.sellertray_commercial_agreements%rowtype;
  v_reference text := btrim(coalesce(p_agreement_reference,''));
  v_rendered_content text := coalesce(p_rendered_content,'');
  v_snapshot jsonb := coalesce(p_commercial_snapshot,'{}'::jsonb);
  v_content_hash text := encode(extensions.digest(coalesce(p_rendered_content,''),'sha256'),'hex');
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.platform_admins pa
    where pa.user_id=p_actor_user_id and pa.role='admin'
  ) then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if p_tenant_id is null or p_commercial_order_id is null or p_template_version_id is null then
    raise exception 'Business, commercial order and agreement template are required' using errcode='22023';
  end if;

  select t.* into strict v_template
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=p_template_version_id;

  insert into public.sellertray_commercial_agreements(
    tenant_id,commercial_order_id,installment_obligation_id,template_version_id,
    agreement_family,template_version_code,template_content_sha256,
    agreement_reference,rendered_content,content_sha256,commercial_snapshot,
    supersedes_agreement_id,issued_by_user_id,issued_at
  ) values (
    p_tenant_id,p_commercial_order_id,p_installment_obligation_id,p_template_version_id,
    v_template.agreement_family,v_template.version_code,v_template.content_sha256,
    v_reference,v_rendered_content,v_content_hash,v_snapshot,
    p_supersedes_agreement_id,p_actor_user_id,now()
  )
  on conflict (tenant_id,agreement_reference) do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  select a.* into strict v_existing
  from public.sellertray_commercial_agreements a
  where a.tenant_id=p_tenant_id
    and a.agreement_reference=v_reference;

  if v_existing.commercial_order_id<>p_commercial_order_id
     or v_existing.installment_obligation_id is distinct from p_installment_obligation_id
     or v_existing.template_version_id<>p_template_version_id
     or v_existing.agreement_family<>v_template.agreement_family
     or v_existing.template_version_code<>v_template.version_code
     or v_existing.template_content_sha256<>v_template.content_sha256
     or v_existing.content_sha256<>v_content_hash
     or v_existing.rendered_content<>v_rendered_content
     or v_existing.commercial_snapshot is distinct from v_snapshot
     or v_existing.supersedes_agreement_id is distinct from p_supersedes_agreement_id
     or v_existing.issued_by_user_id<>p_actor_user_id then
    raise exception 'SellerTray agreement reference is already used for different contractual facts'
      using errcode='23505';
  end if;

  return v_existing.id;
end;
$$;

revoke all on function public.issue_sellertray_commercial_agreement(
  uuid,uuid,uuid,uuid,text,text,jsonb,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.issue_sellertray_commercial_agreement(
  uuid,uuid,uuid,uuid,text,text,jsonb,uuid,uuid
) to service_role;

commit;
