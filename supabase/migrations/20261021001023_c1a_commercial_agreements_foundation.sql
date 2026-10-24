begin;

-- SellerTray C1A Commercial Agreement Foundation
--
-- C1A is additive. It establishes versioned agreement templates, immutable
-- merchant-specific agreement snapshots, governed merchant acceptance evidence,
-- and explicit Manager signing authority. It does not confirm payments, grant
-- entitlement, or mutate public.tenant_subscriptions.
--
-- public.user_legal_acceptances remains the separate user-level Terms/Privacy
-- consent ledger and is deliberately not reused as commercial contract truth.

alter table public.tenant_member_capabilities
  drop constraint if exists tenant_member_capabilities_capability_check,
  add constraint tenant_member_capabilities_capability_check
  check (capability = any (array[
    'can_receive_stock'::text,
    'can_adjust_stock'::text,
    'can_count_stock'::text,
    'can_apply_stock_count'::text,
    'can_transfer_stock'::text,
    'can_open_shift'::text,
    'can_record_cash_movement'::text,
    'can_record_expense'::text,
    'can_correct_cash_movement'::text,
    'can_close_shift'::text,
    'can_review_shift'::text,
    'can_print_receipt'::text,
    'can_manage_devices'::text,
    'can_manage_orders'::text,
    'can_manage_products'::text,
    'can_manage_purchasing'::text,
    'can_manage_payments'::text,
    'can_view_reports'::text,
    'can_refund_sale'::text,
    'can_accept_commercial_agreements'::text
  ]));

create or replace function public.sellertray_user_has_capability(
  p_tenant_id uuid,
  p_user_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_override boolean;
  v_capability text := lower(btrim(coalesce(p_capability,'')));
begin
  if p_tenant_id is null or p_user_id is null or v_capability not in (
    'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
    'can_open_shift','can_record_cash_movement','can_record_expense','can_correct_cash_movement','can_close_shift',
    'can_review_shift','can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products',
    'can_manage_purchasing','can_manage_payments','can_view_reports','can_refund_sale',
    'can_accept_commercial_agreements'
  ) then
    return false;
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_user_id;

  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;

  -- Commercial contract signing is deliberately not inherited from the normal
  -- Manager default. A Manager needs an explicit Owner-granted capability and
  -- Staff/Cashiers can never receive this authority.
  if v_capability='can_accept_commercial_agreements' then
    if v_role<>'manager' then return false; end if;
    select c.allowed into v_override
    from public.tenant_member_capabilities c
    where c.tenant_id=p_tenant_id
      and c.user_id=p_user_id
      and c.capability=v_capability;
    return coalesce(v_override,false);
  end if;

  select c.allowed into v_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_user_id
    and c.capability=v_capability;
  if found then return v_override; end if;

  if v_role='manager' then return true; end if;
  if v_role='staff' then
    return v_capability in (
      'can_open_shift','can_record_cash_movement','can_record_expense','can_close_shift','can_print_receipt'
    );
  end if;
  return false;
end;
$$;

create or replace function public.set_sellertray_member_capability(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_capability text,
  p_allowed boolean,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_capability text := lower(btrim(coalesce(p_capability,'')));
  v_previous_override boolean;
  v_previous_effective boolean;
  v_changed boolean := false;
begin
  if p_tenant_id is null or p_target_user_id is null or p_actor_user_id is null or p_allowed is null then
    raise exception 'Business, staff member, permission and decision are required' using errcode='22023';
  end if;
  if v_capability not in (
    'can_receive_stock','can_adjust_stock','can_count_stock','can_apply_stock_count','can_transfer_stock',
    'can_open_shift','can_record_cash_movement','can_record_expense','can_correct_cash_movement','can_close_shift',
    'can_review_shift','can_print_receipt','can_manage_devices','can_manage_orders','can_manage_products',
    'can_manage_purchasing','can_manage_payments','can_view_reports','can_refund_sale',
    'can_accept_commercial_agreements'
  ) then
    raise exception 'Unknown SellerTray permission' using errcode='22023';
  end if;

  select tm.role into v_actor_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  select tm.role into v_target_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_target_user_id;

  if v_actor_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change staff permissions' using errcode='42501';
  end if;
  if v_target_role is null then
    raise exception 'Staff member does not belong to this business' using errcode='23503';
  end if;
  if v_target_role='owner' then
    raise exception 'Owner authority cannot be changed here' using errcode='42501';
  end if;

  if v_capability='can_accept_commercial_agreements' then
    if v_actor_role<>'owner' then
      raise exception 'Only the business Owner can delegate commercial agreement authority' using errcode='42501';
    end if;
    if v_target_role<>'manager' then
      raise exception 'Commercial agreement authority can only be delegated to a Manager' using errcode='42501';
    end if;
  elsif v_actor_role='manager' and v_target_role<>'staff' then
    raise exception 'Managers can change permissions for Staff only' using errcode='42501';
  end if;

  v_previous_effective := public.sellertray_user_has_capability(
    p_tenant_id,p_target_user_id,v_capability
  );
  select c.allowed into v_previous_override
  from public.tenant_member_capabilities c
  where c.tenant_id=p_tenant_id
    and c.user_id=p_target_user_id
    and c.capability=v_capability;
  if not found or v_previous_override is distinct from p_allowed then
    v_changed := true;
  end if;

  insert into public.tenant_member_capabilities(
    tenant_id,user_id,capability,allowed,granted_by,created_at,updated_at
  ) values (
    p_tenant_id,p_target_user_id,v_capability,p_allowed,p_actor_user_id,now(),now()
  )
  on conflict(tenant_id,user_id,capability) do update
    set allowed=excluded.allowed,
        granted_by=excluded.granted_by,
        updated_at=now();

  if v_changed then
    insert into public.tenant_member_capability_events(
      tenant_id,user_id,capability,previous_allowed,new_allowed,actor_user_id
    ) values (
      p_tenant_id,p_target_user_id,v_capability,v_previous_effective,p_allowed,p_actor_user_id
    );
  end if;
  return p_allowed;
end;
$$;

create or replace function public.get_sellertray_team_access_matrix(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id
      and tm.user_id=v_user_id
      and tm.role in ('owner','manager')
  ) then
    raise exception 'Only business Owners and Managers can review Team access' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',tm.user_id,
    'role',tm.role,
    'usesDefaultBranchFallback',
      tm.role='staff' and not exists(
        select 1 from public.branch_user_access bua0
        where bua0.tenant_id=tm.tenant_id and bua0.user_id=tm.user_id
      ),
    'branchAccess',coalesce((
      select jsonb_object_agg(bua.branch_id::text,bua.can_operate)
      from public.branch_user_access bua
      where bua.tenant_id=tm.tenant_id and bua.user_id=tm.user_id
    ),'{}'::jsonb),
    'capabilities',jsonb_build_object(
      'can_manage_orders',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_orders'),
      'can_refund_sale',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_refund_sale'),
      'can_manage_products',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_products'),
      'can_receive_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_receive_stock'),
      'can_adjust_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_adjust_stock'),
      'can_count_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_count_stock'),
      'can_apply_stock_count',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_apply_stock_count'),
      'can_transfer_stock',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_transfer_stock'),
      'can_manage_purchasing',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_purchasing'),
      'can_manage_payments',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_payments'),
      'can_open_shift',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_open_shift'),
      'can_record_cash_movement',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_record_cash_movement'),
      'can_record_expense',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_record_expense'),
      'can_close_shift',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_close_shift'),
      'can_review_shift',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_review_shift'),
      'can_print_receipt',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_print_receipt'),
      'can_manage_devices',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_manage_devices'),
      'can_view_reports',public.sellertray_user_has_capability(tm.tenant_id,tm.user_id,'can_view_reports'),
      'can_accept_commercial_agreements',public.sellertray_user_has_capability(
        tm.tenant_id,tm.user_id,'can_accept_commercial_agreements'
      )
    )
  ) order by case tm.role when 'owner' then 0 when 'manager' then 1 else 2 end,tm.created_at,tm.user_id),'[]'::jsonb)
  into v_result
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id;

  return v_result;
end;
$$;

create table public.sellertray_commercial_agreement_template_versions (
  id uuid primary key default gen_random_uuid(),
  agreement_family text not null,
  version_code text not null,
  title text not null,
  content_body text not null,
  content_sha256 text not null,
  effective_from timestamptz not null,
  published_by_user_id uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (agreement_family,version_code),
  unique (agreement_family,effective_from),
  constraint sellertray_commercial_agreement_template_family_check
    check (agreement_family in (
      'terms_of_service',
      'subscription_order',
      'installment_agreement',
      'money_back_guarantee_terms',
      'branch_setup_equipment_acknowledgement',
      'privacy_data_terms'
    )),
  constraint sellertray_commercial_agreement_template_version_check
    check (char_length(btrim(version_code)) between 1 and 64 and version_code=btrim(version_code)),
  constraint sellertray_commercial_agreement_template_title_check
    check (char_length(btrim(title)) between 1 and 200 and title=btrim(title)),
  constraint sellertray_commercial_agreement_template_content_check
    check (char_length(content_body) between 1 and 200000),
  constraint sellertray_commercial_agreement_template_hash_check
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_commercial_agreement_template_time_check
    check (effective_from <= published_at + interval '5 minutes')
);

create index sellertray_commercial_agreement_template_publisher_idx
  on public.sellertray_commercial_agreement_template_versions(published_by_user_id);
create index sellertray_commercial_agreement_template_lookup_idx
  on public.sellertray_commercial_agreement_template_versions(agreement_family,effective_from desc);

create or replace function public.prepare_sellertray_commercial_agreement_template_version()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  new.agreement_family := lower(btrim(new.agreement_family));
  new.version_code := btrim(new.version_code);
  new.title := btrim(new.title);
  new.content_sha256 := encode(extensions.digest(new.content_body,'sha256'),'hex');
  new.published_at := coalesce(new.published_at,now());
  new.created_at := coalesce(new.created_at,now());
  return new;
end;
$$;

revoke all on function public.prepare_sellertray_commercial_agreement_template_version()
  from public,anon,authenticated;

drop trigger if exists prepare_sellertray_commercial_agreement_template_version
  on public.sellertray_commercial_agreement_template_versions;
create trigger prepare_sellertray_commercial_agreement_template_version
before insert on public.sellertray_commercial_agreement_template_versions
for each row execute function public.prepare_sellertray_commercial_agreement_template_version();

drop trigger if exists prevent_sellertray_commercial_agreement_template_mutation
  on public.sellertray_commercial_agreement_template_versions;
create trigger prevent_sellertray_commercial_agreement_template_mutation
before update or delete on public.sellertray_commercial_agreement_template_versions
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create table public.sellertray_commercial_agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  commercial_order_id uuid not null,
  installment_obligation_id uuid,
  template_version_id uuid not null references public.sellertray_commercial_agreement_template_versions(id) on delete restrict,
  agreement_family text not null,
  template_version_code text not null,
  template_content_sha256 text not null,
  agreement_reference text not null,
  rendered_content text not null,
  content_sha256 text not null,
  commercial_snapshot jsonb not null default '{}'::jsonb,
  supersedes_agreement_id uuid,
  issued_by_user_id uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,agreement_reference),
  constraint sellertray_commercial_agreements_order_same_tenant
    foreign key (tenant_id,commercial_order_id)
    references public.sellertray_commercial_orders(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_agreements_installment_same_order
    foreign key (tenant_id,commercial_order_id,installment_obligation_id)
    references public.sellertray_commercial_installment_obligations(tenant_id,commercial_order_id,id)
    on delete restrict,
  constraint sellertray_commercial_agreements_supersedes_same_tenant
    foreign key (tenant_id,supersedes_agreement_id)
    references public.sellertray_commercial_agreements(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_agreements_family_check
    check (agreement_family in (
      'terms_of_service',
      'subscription_order',
      'installment_agreement',
      'money_back_guarantee_terms',
      'branch_setup_equipment_acknowledgement',
      'privacy_data_terms'
    )),
  constraint sellertray_commercial_agreements_installment_subject_check
    check (
      (agreement_family='installment_agreement' and installment_obligation_id is not null)
      or
      (agreement_family<>'installment_agreement' and installment_obligation_id is null)
    ),
  constraint sellertray_commercial_agreements_template_version_check
    check (char_length(btrim(template_version_code)) between 1 and 64 and template_version_code=btrim(template_version_code)),
  constraint sellertray_commercial_agreements_template_hash_check
    check (template_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_commercial_agreements_reference_check
    check (char_length(btrim(agreement_reference)) between 1 and 128 and agreement_reference=btrim(agreement_reference)),
  constraint sellertray_commercial_agreements_content_check
    check (char_length(rendered_content) between 1 and 300000),
  constraint sellertray_commercial_agreements_hash_check
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_commercial_agreements_snapshot_check
    check (jsonb_typeof(commercial_snapshot)='object'),
  constraint sellertray_commercial_agreements_time_check
    check (issued_at <= created_at + interval '5 minutes')
);

create unique index sellertray_commercial_agreements_supersedes_key
  on public.sellertray_commercial_agreements(supersedes_agreement_id)
  where supersedes_agreement_id is not null;
create index sellertray_commercial_agreements_order_idx
  on public.sellertray_commercial_agreements(tenant_id,commercial_order_id,agreement_family,issued_at desc);
create index sellertray_commercial_agreements_installment_idx
  on public.sellertray_commercial_agreements(tenant_id,installment_obligation_id)
  where installment_obligation_id is not null;
create index sellertray_commercial_agreements_template_idx
  on public.sellertray_commercial_agreements(template_version_id);
create index sellertray_commercial_agreements_issuer_idx
  on public.sellertray_commercial_agreements(issued_by_user_id);

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

drop trigger if exists prepare_sellertray_commercial_agreement
  on public.sellertray_commercial_agreements;
create trigger prepare_sellertray_commercial_agreement
before insert on public.sellertray_commercial_agreements
for each row execute function public.prepare_sellertray_commercial_agreement();

drop trigger if exists prevent_sellertray_commercial_agreement_mutation
  on public.sellertray_commercial_agreements;
create trigger prevent_sellertray_commercial_agreement_mutation
before update or delete on public.sellertray_commercial_agreements
for each row execute function public.prevent_sellertray_commercial_history_mutation();

create table public.sellertray_commercial_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agreement_id uuid not null,
  template_version_id uuid not null references public.sellertray_commercial_agreement_template_versions(id) on delete restrict,
  template_version_code text not null,
  template_content_sha256 text not null,
  agreement_content_sha256 text not null,
  accepted_by_user_id uuid not null references auth.users(id) on delete restrict,
  accepted_legal_name text not null,
  accepted_role text not null,
  acceptance_method text not null,
  request_evidence jsonb not null default '{}'::jsonb,
  command_id uuid not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,agreement_id),
  unique (tenant_id,command_id),
  constraint sellertray_commercial_agreement_acceptances_agreement_same_tenant
    foreign key (tenant_id,agreement_id)
    references public.sellertray_commercial_agreements(tenant_id,id)
    on delete restrict,
  constraint sellertray_commercial_agreement_acceptances_template_version_check
    check (char_length(btrim(template_version_code)) between 1 and 64 and template_version_code=btrim(template_version_code)),
  constraint sellertray_commercial_agreement_acceptances_template_hash_check
    check (template_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_commercial_agreement_acceptances_agreement_hash_check
    check (agreement_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_commercial_agreement_acceptances_name_check
    check (char_length(btrim(accepted_legal_name)) between 1 and 200 and accepted_legal_name=btrim(accepted_legal_name)),
  constraint sellertray_commercial_agreement_acceptances_role_check
    check (accepted_role in ('owner','manager')),
  constraint sellertray_commercial_agreement_acceptances_method_check
    check (acceptance_method='merchant_web_authenticated'),
  constraint sellertray_commercial_agreement_acceptances_evidence_check
    check (jsonb_typeof(request_evidence)='object'),
  constraint sellertray_commercial_agreement_acceptances_time_check
    check (accepted_at <= created_at + interval '5 minutes')
);

create index sellertray_commercial_agreement_acceptances_template_idx
  on public.sellertray_commercial_agreement_acceptances(template_version_id);
create index sellertray_commercial_agreement_acceptances_actor_idx
  on public.sellertray_commercial_agreement_acceptances(accepted_by_user_id,accepted_at desc);

create or replace function public.prevent_sellertray_commercial_agreement_acceptance_mutation()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  raise exception 'SellerTray commercial agreement acceptance is immutable' using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_commercial_agreement_acceptance_mutation()
  from public,anon,authenticated;

drop trigger if exists prevent_sellertray_commercial_agreement_acceptance_mutation
  on public.sellertray_commercial_agreement_acceptances;
create trigger prevent_sellertray_commercial_agreement_acceptance_mutation
before update or delete on public.sellertray_commercial_agreement_acceptances
for each row execute function public.prevent_sellertray_commercial_agreement_acceptance_mutation();

create or replace function public.publish_sellertray_commercial_agreement_template_version(
  p_agreement_family text,
  p_version_code text,
  p_title text,
  p_content_body text,
  p_effective_from timestamptz,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_id uuid;
  v_existing public.sellertray_commercial_agreement_template_versions%rowtype;
  v_hash text := encode(extensions.digest(coalesce(p_content_body,''),'sha256'),'hex');
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.platform_admins pa
    where pa.user_id=p_actor_user_id and pa.role='admin'
  ) then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;
  if p_effective_from is null then
    raise exception 'Agreement effective time is required' using errcode='22023';
  end if;

  insert into public.sellertray_commercial_agreement_template_versions(
    agreement_family,version_code,title,content_body,content_sha256,
    effective_from,published_by_user_id,published_at
  ) values (
    lower(btrim(coalesce(p_agreement_family,''))),btrim(coalesce(p_version_code,'')),
    btrim(coalesce(p_title,'')),coalesce(p_content_body,''),v_hash,
    p_effective_from,p_actor_user_id,now()
  )
  on conflict (agreement_family,version_code) do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select t.* into strict v_existing
  from public.sellertray_commercial_agreement_template_versions t
  where t.agreement_family=lower(btrim(coalesce(p_agreement_family,'')))
    and t.version_code=btrim(coalesce(p_version_code,''));

  if v_existing.title is distinct from btrim(coalesce(p_title,''))
     or v_existing.content_sha256 is distinct from v_hash
     or v_existing.effective_from is distinct from p_effective_from then
    raise exception 'Agreement template version already exists with different facts' using errcode='23505';
  end if;
  return v_existing.id;
end;
$$;

revoke all on function public.publish_sellertray_commercial_agreement_template_version(
  text,text,text,text,timestamptz,uuid
) from public,anon,authenticated;
grant execute on function public.publish_sellertray_commercial_agreement_template_version(
  text,text,text,text,timestamptz,uuid
) to service_role;

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
    btrim(coalesce(p_agreement_reference,'')),coalesce(p_rendered_content,''),
    encode(extensions.digest(coalesce(p_rendered_content,''),'sha256'),'hex'),
    coalesce(p_commercial_snapshot,'{}'::jsonb),p_supersedes_agreement_id,p_actor_user_id,now()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.issue_sellertray_commercial_agreement(
  uuid,uuid,uuid,uuid,text,text,jsonb,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.issue_sellertray_commercial_agreement(
  uuid,uuid,uuid,uuid,text,text,jsonb,uuid,uuid
) to service_role;

create or replace function public.accept_sellertray_commercial_agreement(
  p_tenant_id uuid,
  p_agreement_id uuid,
  p_accepted_legal_name text,
  p_request_evidence jsonb,
  p_command_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_agreement public.sellertray_commercial_agreements%rowtype;
  v_existing public.sellertray_commercial_agreement_acceptances%rowtype;
  v_id uuid;
  v_name text := btrim(coalesce(p_accepted_legal_name,''));
  v_evidence jsonb := coalesce(p_request_evidence,'{}'::jsonb);
begin
  if p_tenant_id is null or p_agreement_id is null or p_actor_user_id is null or p_command_id is null then
    raise exception 'Business, agreement, accepting user and command are required' using errcode='22023';
  end if;
  if jsonb_typeof(v_evidence)<>'object' then
    raise exception 'Agreement acceptance evidence must be an object' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 200 then
    raise exception 'Enter the authorised representative legal name' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;

  if v_role='owner' then
    null;
  elsif v_role='manager' and public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements'
  ) then
    null;
  else
    raise exception 'You are not authorised to accept SellerTray commercial agreements' using errcode='42501';
  end if;

  select a.* into strict v_agreement
  from public.sellertray_commercial_agreements a
  where a.tenant_id=p_tenant_id and a.id=p_agreement_id;

  if exists (
    select 1 from public.sellertray_commercial_agreements r
    where r.tenant_id=p_tenant_id and r.supersedes_agreement_id=v_agreement.id
  ) then
    raise exception 'This SellerTray agreement has been replaced and cannot be accepted' using errcode='23514';
  end if;

  insert into public.sellertray_commercial_agreement_acceptances(
    tenant_id,agreement_id,template_version_id,template_version_code,
    template_content_sha256,agreement_content_sha256,accepted_by_user_id,
    accepted_legal_name,accepted_role,acceptance_method,request_evidence,
    command_id,accepted_at,created_at
  ) values (
    p_tenant_id,v_agreement.id,v_agreement.template_version_id,v_agreement.template_version_code,
    v_agreement.template_content_sha256,v_agreement.content_sha256,p_actor_user_id,
    v_name,v_role,'merchant_web_authenticated',v_evidence,p_command_id,now(),now()
  )
  on conflict (tenant_id,command_id) do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  select a.* into strict v_existing
  from public.sellertray_commercial_agreement_acceptances a
  where a.tenant_id=p_tenant_id and a.command_id=p_command_id;

  if v_existing.agreement_id<>v_agreement.id
     or v_existing.accepted_by_user_id<>p_actor_user_id
     or v_existing.accepted_legal_name<>v_name
     or v_existing.accepted_role<>v_role
     or v_existing.request_evidence is distinct from v_evidence then
    raise exception 'Agreement acceptance command is already used for different facts' using errcode='23505';
  end if;

  return v_existing.id;
end;
$$;

revoke all on function public.accept_sellertray_commercial_agreement(
  uuid,uuid,text,jsonb,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.accept_sellertray_commercial_agreement(
  uuid,uuid,text,jsonb,uuid,uuid
) to service_role;

create or replace function public.sellertray_installment_agreement_is_accepted(
  p_tenant_id uuid,
  p_commercial_order_id uuid,
  p_installment_obligation_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path=''
as $$
  select exists (
    select 1
    from public.sellertray_commercial_agreements a
    join public.sellertray_commercial_agreement_acceptances ac
      on ac.tenant_id=a.tenant_id and ac.agreement_id=a.id
    where a.tenant_id=p_tenant_id
      and a.commercial_order_id=p_commercial_order_id
      and a.installment_obligation_id=p_installment_obligation_id
      and a.agreement_family='installment_agreement'
      and not exists (
        select 1 from public.sellertray_commercial_agreements r
        where r.tenant_id=a.tenant_id and r.supersedes_agreement_id=a.id
      )
  );
$$;

revoke all on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid)
  to service_role;

alter table public.sellertray_commercial_agreement_template_versions enable row level security;
alter table public.sellertray_commercial_agreements enable row level security;
alter table public.sellertray_commercial_agreement_acceptances enable row level security;

revoke all on table public.sellertray_commercial_agreement_template_versions from public,anon,authenticated;
revoke all on table public.sellertray_commercial_agreements from public,anon,authenticated;
revoke all on table public.sellertray_commercial_agreement_acceptances from public,anon,authenticated;

grant all on table public.sellertray_commercial_agreement_template_versions to service_role;
grant all on table public.sellertray_commercial_agreements to service_role;
grant all on table public.sellertray_commercial_agreement_acceptances to service_role;

commit;
