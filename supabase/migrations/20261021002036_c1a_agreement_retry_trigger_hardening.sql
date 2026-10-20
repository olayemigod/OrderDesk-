begin;

-- Let an already-governed agreement reference reach the issuance command's
-- ON CONFLICT/idempotency comparison. The unique tenant/reference key still
-- blocks direct duplicate persistence, while the governed command decides
-- whether the retry is identical or conflicts with different contractual facts.

create or replace function public.prepare_sellertray_commercial_agreement()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_template public.sellertray_commercial_agreement_template_versions%rowtype;
  v_previous public.sellertray_commercial_agreements%rowtype;
begin
  select t.* into strict v_template
  from public.sellertray_commercial_agreement_template_versions t
  where t.id=new.template_version_id;

  new.agreement_family := v_template.agreement_family;
  new.template_version_code := v_template.version_code;
  new.template_content_sha256 := v_template.content_sha256;
  new.agreement_reference := btrim(new.agreement_reference);
  new.content_sha256 := encode(extensions.digest(new.rendered_content,'sha256'),'hex');
  new.issued_at := coalesce(new.issued_at,now());
  new.created_at := coalesce(new.created_at,now());

  if v_template.effective_from>new.issued_at then
    raise exception 'SellerTray agreement template is not effective at the issue time' using errcode='23514';
  end if;

  if new.agreement_family='installment_agreement' and new.installment_obligation_id is null then
    raise exception 'SellerTray installment agreement requires an installment obligation' using errcode='23514';
  elsif new.agreement_family<>'installment_agreement' and new.installment_obligation_id is not null then
    raise exception 'Only an installment agreement may bind an installment obligation' using errcode='23514';
  end if;

  -- A repeated governed reference is not accepted here; it is merely allowed to
  -- reach the unique-key arbiter. issue_sellertray_commercial_agreement then
  -- compares every immutable contractual fact before returning the existing ID.
  if exists (
    select 1
    from public.sellertray_commercial_agreements a
    where a.tenant_id=new.tenant_id
      and a.agreement_reference=new.agreement_reference
  ) then
    return new;
  end if;

  if new.supersedes_agreement_id is not null then
    select a.* into strict v_previous
    from public.sellertray_commercial_agreements a
    where a.tenant_id=new.tenant_id and a.id=new.supersedes_agreement_id
    for update;

    if v_previous.commercial_order_id<>new.commercial_order_id
       or v_previous.agreement_family<>new.agreement_family
       or v_previous.installment_obligation_id is distinct from new.installment_obligation_id then
      raise exception 'Replacement agreement must preserve the original commercial subject'
        using errcode='23514';
    end if;
    if exists (
      select 1 from public.sellertray_commercial_agreements a
      where a.supersedes_agreement_id=v_previous.id
    ) then
      raise exception 'SellerTray agreement has already been replaced' using errcode='23505';
    end if;
  elsif exists (
    select 1
    from public.sellertray_commercial_agreements a
    where a.tenant_id=new.tenant_id
      and a.commercial_order_id=new.commercial_order_id
      and a.agreement_family=new.agreement_family
      and a.installment_obligation_id is not distinct from new.installment_obligation_id
      and not exists (
        select 1 from public.sellertray_commercial_agreements r
        where r.supersedes_agreement_id=a.id
      )
  ) then
    raise exception 'Existing SellerTray agreement must be explicitly superseded' using errcode='23505';
  end if;

  return new;
end;
$$;

revoke all on function public.prepare_sellertray_commercial_agreement()
  from public,anon,authenticated;

commit;
