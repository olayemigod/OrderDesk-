create or replace function public.finalize_sellertray_catalogue_candidate_conversion(
  p_tenant_id uuid,
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_sku text,
  p_category text,
  p_price_ngn numeric,
  p_image_url text,
  p_storage_bucket text,
  p_storage_path text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_candidate public.catalogue_capture_candidates%rowtype;
  v_item_id uuid;
begin
  select *
    into v_candidate
  from public.catalogue_capture_candidates
  where id = p_candidate_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Catalogue chat candidate not found';
  end if;

  if v_candidate.status = 'converted' and v_candidate.catalog_item_id is not null then
    return v_candidate.catalog_item_id;
  end if;

  if v_candidate.status <> 'pending' then
    raise exception 'Catalogue chat candidate is no longer pending';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception 'Catalogue item name is required';
  end if;

  if p_price_ngn is not null and p_price_ngn < 0 then
    raise exception 'Catalogue item price cannot be negative';
  end if;

  insert into public.catalog_items (
    tenant_id,
    name,
    sku,
    price_ngn,
    is_active,
    category,
    image_url
  ) values (
    p_tenant_id,
    btrim(p_name),
    nullif(btrim(p_sku), ''),
    p_price_ngn,
    true,
    nullif(btrim(p_category), ''),
    nullif(btrim(p_image_url), '')
  )
  returning id into v_item_id;

  update public.catalogue_capture_candidates
  set status = 'converted',
      catalog_item_id = v_item_id,
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_candidate_id;

  update public.inbound_message_media
  set storage_bucket = nullif(btrim(p_storage_bucket), ''),
      storage_path = nullif(btrim(p_storage_path), ''),
      updated_at = now()
  where id = v_candidate.source_media_id
    and tenant_id = p_tenant_id;

  return v_item_id;
end;
$$;

revoke all on function public.finalize_sellertray_catalogue_candidate_conversion(
  uuid, uuid, uuid, text, text, text, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_sellertray_catalogue_candidate_conversion(
  uuid, uuid, uuid, text, text, text, numeric, text, text, text
) to service_role;

create or replace function public.reject_sellertray_catalogue_candidate(
  p_tenant_id uuid,
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_review_note text default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  select status
    into v_status
  from public.catalogue_capture_candidates
  where id = p_candidate_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Catalogue chat candidate not found';
  end if;

  if v_status = 'converted' then
    raise exception 'Converted catalogue candidate cannot be rejected';
  end if;

  if v_status = 'rejected' then
    return;
  end if;

  update public.catalogue_capture_candidates
  set status = 'rejected',
      review_note = nullif(btrim(p_review_note), ''),
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_candidate_id;
end;
$$;

revoke all on function public.reject_sellertray_catalogue_candidate(uuid, uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.reject_sellertray_catalogue_candidate(uuid, uuid, uuid, text)
to service_role;
