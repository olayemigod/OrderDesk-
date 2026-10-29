begin;

create table if not exists public.sellertray_catalogue_master_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  master_kind text not null check (master_kind in ('category','unit')),
  master_id uuid not null,
  action text not null check (action in ('create','rename','archive','restore')),
  before_state jsonb,
  after_state jsonb not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists sellertray_catalogue_master_audit_tenant_created_idx
  on public.sellertray_catalogue_master_audit(tenant_id,created_at desc,id desc);
alter table public.sellertray_catalogue_master_audit enable row level security;
revoke all on table public.sellertray_catalogue_master_audit from public,anon,authenticated;
grant all on table public.sellertray_catalogue_master_audit to service_role;

create or replace function public.get_sellertray_catalogue_master_management(
  p_tenant_id uuid,
  p_kind text,
  p_search text default null,
  p_status text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind,'')));
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_status text := lower(btrim(coalesce(p_status,'all')));
  v_items jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then raise exception 'You do not have permission to manage catalogue masters' using errcode='42501'; end if;
  if v_kind not in ('category','unit') then raise exception 'Unknown catalogue master type' using errcode='22023'; end if;
  if v_status not in ('active','archived','all') then raise exception 'Unknown catalogue master status' using errcode='22023'; end if;

  if v_kind='category' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'isActive',c.is_active,'usageCount',(
        select count(*)::integer from public.catalog_items ci
        where ci.tenant_id=c.tenant_id and lower(btrim(coalesce(ci.category,'')))=c.normalized_name
      ),'protected',false,'updatedAt',c.updated_at
    ) order by c.is_active desc,c.normalized_name,c.id),'[]'::jsonb)
    into v_items
    from public.catalogue_categories c
    where c.tenant_id=p_tenant_id
      and (v_status='all' or (v_status='active' and c.is_active) or (v_status='archived' and not c.is_active))
      and (v_search is null or c.name ilike '%'||v_search||'%');
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',u.id,'name',u.name,'isActive',u.is_active,'usageCount',(
        (select count(*) from public.catalog_items ci where ci.tenant_id=u.tenant_id and lower(btrim(ci.stock_uom))=u.normalized_name)
        + (select count(*) from public.catalog_item_uoms cu where cu.tenant_id=u.tenant_id and lower(btrim(cu.uom_name))=u.normalized_name)
      )::integer,'protected',(u.normalized_name='each'),'updatedAt',u.updated_at
    ) order by u.is_active desc,u.normalized_name,u.id),'[]'::jsonb)
    into v_items
    from public.business_uoms u
    where u.tenant_id=p_tenant_id
      and (v_status='all' or (v_status='active' and u.is_active) or (v_status='archived' and not u.is_active))
      and (v_search is null or u.name ilike '%'||v_search||'%');
  end if;

  return jsonb_build_object('kind',v_kind,'items',v_items);
end;
$$;

create or replace function public.save_sellertray_catalogue_master(
  p_tenant_id uuid,
  p_kind text,
  p_master_id uuid,
  p_name text,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind,'')));
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_id uuid := p_master_id;
  v_old_name text;
  v_old_active boolean;
  v_old_normalized text;
  v_usage integer := 0;
  v_action text;
  v_before jsonb;
  v_after jsonb;
begin
  if v_user_id is null then raise exception 'SellerTray authentication required' using errcode='42501'; end if;
  if not public.sellertray_user_can_manage_products(p_tenant_id,v_user_id) then raise exception 'You do not have permission to manage catalogue masters' using errcode='42501'; end if;
  if not public.orderdesk_subscription_can_write(p_tenant_id) then raise exception 'SellerTray subscription is read-only' using errcode='42501'; end if;
  if v_kind not in ('category','unit') then raise exception 'Unknown catalogue master type' using errcode='22023'; end if;
  if v_name is null or (v_kind='category' and char_length(v_name)>120) or (v_kind='unit' and char_length(v_name)>80) then raise exception 'Enter a valid catalogue master name' using errcode='22023'; end if;

  if v_id is null then
    if v_kind='category' then
      insert into public.catalogue_categories(tenant_id,name,is_active)
      values(p_tenant_id,v_name,coalesce(p_is_active,true))
      on conflict (tenant_id,normalized_name) do nothing
      returning id into v_id;
    else
      insert into public.business_uoms(tenant_id,name,is_active)
      values(p_tenant_id,v_name,coalesce(p_is_active,true))
      on conflict (tenant_id,normalized_name) do nothing
      returning id into v_id;
    end if;
    if v_id is null then raise exception 'A catalogue master with this name already exists; restore or edit that record instead' using errcode='23505'; end if;
    v_action:='create';
    v_after:=jsonb_build_object('name',v_name,'isActive',coalesce(p_is_active,true));
  else
    if v_kind='category' then
      select c.name,c.is_active,c.normalized_name into v_old_name,v_old_active,v_old_normalized
      from public.catalogue_categories c where c.tenant_id=p_tenant_id and c.id=v_id for update;
      if not found then raise exception 'Product category not found' using errcode='22023'; end if;
      select count(*)::integer into v_usage from public.catalog_items ci
      where ci.tenant_id=p_tenant_id and lower(btrim(coalesce(ci.category,'')))=v_old_normalized;
    else
      select u.name,u.is_active,u.normalized_name into v_old_name,v_old_active,v_old_normalized
      from public.business_uoms u where u.tenant_id=p_tenant_id and u.id=v_id for update;
      if not found then raise exception 'Business unit not found' using errcode='22023'; end if;
      select (
        (select count(*) from public.catalog_items ci where ci.tenant_id=p_tenant_id and lower(btrim(ci.stock_uom))=v_old_normalized)
        + (select count(*) from public.catalog_item_uoms cu where cu.tenant_id=p_tenant_id and lower(btrim(cu.uom_name))=v_old_normalized)
      )::integer into v_usage;
      if v_old_normalized='each' and (lower(v_name)<>'each' or not coalesce(p_is_active,false)) then
        raise exception 'The default Each unit is protected and cannot be renamed or archived' using errcode='23514';
      end if;
      if lower(v_name)<>v_old_normalized and v_usage>0 then
        raise exception 'This Business unit is already used by products; create a new unit and migrate products before archiving the old unit' using errcode='23514';
      end if;
    end if;

    if not coalesce(p_is_active,false) and v_usage>0 then
      raise exception 'This catalogue master is still used by products and cannot be archived' using errcode='23514';
    end if;
    if exists(
      select 1 from public.catalogue_categories c where v_kind='category' and c.tenant_id=p_tenant_id and c.id<>v_id and c.normalized_name=lower(v_name)
      union all
      select 1 from public.business_uoms u where v_kind='unit' and u.tenant_id=p_tenant_id and u.id<>v_id and u.normalized_name=lower(v_name)
    ) then raise exception 'A catalogue master with this name already exists' using errcode='23505'; end if;

    v_before:=jsonb_build_object('name',v_old_name,'isActive',v_old_active);
    if v_kind='category' then
      if lower(v_name)<>v_old_normalized then
        update public.catalog_items ci set category=v_name,updated_at=now()
        where ci.tenant_id=p_tenant_id and lower(btrim(coalesce(ci.category,'')))=v_old_normalized;
      end if;
      update public.catalogue_categories c set name=v_name,is_active=coalesce(p_is_active,false),updated_at=now()
      where c.tenant_id=p_tenant_id and c.id=v_id;
    else
      update public.business_uoms u set name=v_name,is_active=coalesce(p_is_active,false),updated_at=now()
      where u.tenant_id=p_tenant_id and u.id=v_id;
    end if;
    v_action:=case when v_old_active and not coalesce(p_is_active,false) then 'archive' when not v_old_active and coalesce(p_is_active,false) then 'restore' else 'rename' end;
    v_after:=jsonb_build_object('name',v_name,'isActive',coalesce(p_is_active,false));
  end if;

  insert into public.sellertray_catalogue_master_audit(tenant_id,master_kind,master_id,action,before_state,after_state,actor_user_id)
  values(p_tenant_id,v_kind,v_id,v_action,v_before,v_after,v_user_id);
  return v_id;
end;
$$;

revoke all on function public.get_sellertray_catalogue_master_management(uuid,text,text,text) from public,anon;
revoke all on function public.save_sellertray_catalogue_master(uuid,text,uuid,text,boolean) from public,anon;
grant execute on function public.get_sellertray_catalogue_master_management(uuid,text,text,text) to authenticated,service_role;
grant execute on function public.save_sellertray_catalogue_master(uuid,text,uuid,text,boolean) to authenticated;

commit;
