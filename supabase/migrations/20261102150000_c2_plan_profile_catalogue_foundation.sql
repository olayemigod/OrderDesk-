begin;

-- SellerTray C2-2 Plan Profile + Entitlement Catalogue Foundation
--
-- Additive only. This migration does NOT replace public.tenant_subscriptions,
-- create Branch Subscription runtime authority, or change any client/runtime
-- entitlement decision. It introduces the canonical configurable catalogue and
-- versioned profile structures that C2-4/C2-5 will later resolve.

create table public.sellertray_feature_catalogue (
  code text primary key,
  display_name text not null,
  description text not null,
  commercialization_class text not null default 'unclassified',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint sellertray_feature_catalogue_code_check
    check (code ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  constraint sellertray_feature_catalogue_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_feature_catalogue_description_check
    check (char_length(btrim(description)) between 1 and 1000),
  constraint sellertray_feature_catalogue_class_check
    check (commercialization_class in ('unclassified','core','packageable','addon_candidate')),
  constraint sellertray_feature_catalogue_status_check
    check (status in ('active','planned','retired'))
);

create table public.sellertray_capability_catalogue (
  code text primary key,
  feature_code text references public.sellertray_feature_catalogue(code) on delete restrict,
  display_name text not null,
  description text not null,
  legacy_permission_code text,
  commercialization_class text not null default 'unclassified',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint sellertray_capability_catalogue_code_check
    check (code ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  constraint sellertray_capability_catalogue_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_capability_catalogue_description_check
    check (char_length(btrim(description)) between 1 and 1000),
  constraint sellertray_capability_catalogue_legacy_check
    check (legacy_permission_code is null or legacy_permission_code ~ '^[a-z][a-z0-9_]{1,127}$'),
  constraint sellertray_capability_catalogue_class_check
    check (commercialization_class in ('unclassified','core','packageable','authorization_only','addon_candidate')),
  constraint sellertray_capability_catalogue_status_check
    check (status in ('active','planned','retired'))
);

create unique index sellertray_capability_catalogue_legacy_permission_key
  on public.sellertray_capability_catalogue(legacy_permission_code)
  where legacy_permission_code is not null;

create table public.sellertray_limit_definitions (
  code text primary key,
  display_name text not null,
  description text not null,
  unit_code text not null,
  measurement_kind text not null default 'count',
  scope_kind text not null default 'branch_subscription',
  meter_code text,
  commercialization_class text not null default 'unclassified',
  status text not null default 'candidate',
  created_at timestamptz not null default now(),
  constraint sellertray_limit_definitions_code_check
    check (code ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  constraint sellertray_limit_definitions_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_limit_definitions_description_check
    check (char_length(btrim(description)) between 1 and 1000),
  constraint sellertray_limit_definitions_unit_check
    check (unit_code ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  constraint sellertray_limit_definitions_measurement_check
    check (measurement_kind in ('count','quantity','amount')),
  constraint sellertray_limit_definitions_scope_check
    check (scope_kind in ('branch_subscription','business','user')),
  constraint sellertray_limit_definitions_meter_check
    check (meter_code is null or meter_code ~ '^[A-Za-z][A-Za-z0-9_.-]{0,127}$'),
  constraint sellertray_limit_definitions_class_check
    check (commercialization_class in ('unclassified','packageable','addon_candidate')),
  constraint sellertray_limit_definitions_status_check
    check (status in ('candidate','active','retired'))
);

create table public.sellertray_plan_profiles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  default_display_name text not null,
  status text not null default 'active',
  sort_order integer not null default 100,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint sellertray_plan_profiles_code_check
    check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_plan_profiles_name_check
    check (char_length(btrim(default_display_name)) between 1 and 120),
  constraint sellertray_plan_profiles_status_check
    check (status in ('active','retired')),
  constraint sellertray_plan_profiles_sort_check check (sort_order >= 0)
);

create table public.sellertray_plan_profile_versions (
  id uuid primary key default gen_random_uuid(),
  plan_profile_id uuid not null references public.sellertray_plan_profiles(id) on delete restrict,
  version integer not null,
  status text not null default 'draft',
  display_name text not null,
  description text not null,
  merchant_summary text not null,
  allowed_billing_cycles text[] not null default array['monthly','yearly']::text[],
  effective_from timestamptz,
  effective_until timestamptz,
  change_reason text not null,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  published_by_user_id uuid references auth.users(id) on delete restrict,
  published_at timestamptz,
  retired_by_user_id uuid references auth.users(id) on delete restrict,
  retired_at timestamptz,
  retirement_reason text,
  created_at timestamptz not null default now(),
  unique (plan_profile_id,version),
  constraint sellertray_plan_profile_versions_version_check check (version > 0),
  constraint sellertray_plan_profile_versions_status_check
    check (status in ('draft','published','retired')),
  constraint sellertray_plan_profile_versions_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_plan_profile_versions_description_check
    check (char_length(btrim(description)) between 1 and 2000),
  constraint sellertray_plan_profile_versions_summary_check
    check (char_length(btrim(merchant_summary)) between 1 and 1000),
  constraint sellertray_plan_profile_versions_cycles_check
    check (
      cardinality(allowed_billing_cycles) > 0
      and allowed_billing_cycles <@ array['monthly','yearly']::text[]
    ),
  constraint sellertray_plan_profile_versions_effective_check
    check (effective_until is null or (effective_from is not null and effective_until > effective_from)),
  constraint sellertray_plan_profile_versions_reason_check
    check (char_length(btrim(change_reason)) between 6 and 1000),
  constraint sellertray_plan_profile_versions_publication_shape_check
    check (
      (status='draft' and published_by_user_id is null and published_at is null and retired_by_user_id is null and retired_at is null and retirement_reason is null)
      or
      (status='published' and effective_from is not null and published_by_user_id is not null and published_at is not null and retired_by_user_id is null and retired_at is null and retirement_reason is null)
      or
      (status='retired' and effective_from is not null and effective_until is not null and published_by_user_id is not null and published_at is not null and retired_by_user_id is not null and retired_at is not null and char_length(btrim(retirement_reason)) between 6 and 1000)
    )
);

create index sellertray_plan_profile_versions_resolution_idx
  on public.sellertray_plan_profile_versions(plan_profile_id,status,effective_from desc,version desc);

create table public.sellertray_plan_profile_feature_grants (
  plan_profile_version_id uuid not null references public.sellertray_plan_profile_versions(id) on delete restrict,
  feature_code text not null references public.sellertray_feature_catalogue(code) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (plan_profile_version_id,feature_code)
);

create table public.sellertray_plan_profile_capability_grants (
  plan_profile_version_id uuid not null references public.sellertray_plan_profile_versions(id) on delete restrict,
  capability_code text not null references public.sellertray_capability_catalogue(code) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (plan_profile_version_id,capability_code)
);

create table public.sellertray_plan_profile_limit_values (
  plan_profile_version_id uuid not null references public.sellertray_plan_profile_versions(id) on delete restrict,
  limit_code text not null references public.sellertray_limit_definitions(code) on delete restrict,
  limit_value numeric(18,6),
  is_unlimited boolean not null default false,
  enforcement_mode text not null default 'hard',
  created_at timestamptz not null default now(),
  primary key (plan_profile_version_id,limit_code),
  constraint sellertray_plan_profile_limit_values_shape_check
    check ((is_unlimited and limit_value is null) or (not is_unlimited and limit_value is not null and limit_value >= 0)),
  constraint sellertray_plan_profile_limit_values_enforcement_check
    check (enforcement_mode in ('hard','soft','informational'))
);

create table public.sellertray_addon_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  default_display_name text not null,
  status text not null default 'active',
  sort_order integer not null default 100,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint sellertray_addon_definitions_code_check
    check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint sellertray_addon_definitions_name_check
    check (char_length(btrim(default_display_name)) between 1 and 120),
  constraint sellertray_addon_definitions_status_check
    check (status in ('active','retired')),
  constraint sellertray_addon_definitions_sort_check check (sort_order >= 0)
);

create table public.sellertray_addon_versions (
  id uuid primary key default gen_random_uuid(),
  addon_definition_id uuid not null references public.sellertray_addon_definitions(id) on delete restrict,
  version integer not null,
  status text not null default 'draft',
  display_name text not null,
  description text not null,
  allowed_billing_cycles text[] not null default array['monthly','yearly']::text[],
  effective_from timestamptz,
  effective_until timestamptz,
  change_reason text not null,
  created_by_user_id uuid references auth.users(id) on delete restrict,
  published_by_user_id uuid references auth.users(id) on delete restrict,
  published_at timestamptz,
  retired_by_user_id uuid references auth.users(id) on delete restrict,
  retired_at timestamptz,
  retirement_reason text,
  created_at timestamptz not null default now(),
  unique (addon_definition_id,version),
  constraint sellertray_addon_versions_version_check check (version > 0),
  constraint sellertray_addon_versions_status_check check (status in ('draft','published','retired')),
  constraint sellertray_addon_versions_name_check check (char_length(btrim(display_name)) between 1 and 120),
  constraint sellertray_addon_versions_description_check check (char_length(btrim(description)) between 1 and 2000),
  constraint sellertray_addon_versions_cycles_check
    check (cardinality(allowed_billing_cycles) > 0 and allowed_billing_cycles <@ array['monthly','yearly','one_time']::text[]),
  constraint sellertray_addon_versions_effective_check
    check (effective_until is null or (effective_from is not null and effective_until > effective_from)),
  constraint sellertray_addon_versions_reason_check check (char_length(btrim(change_reason)) between 6 and 1000),
  constraint sellertray_addon_versions_publication_shape_check
    check (
      (status='draft' and published_by_user_id is null and published_at is null and retired_by_user_id is null and retired_at is null and retirement_reason is null)
      or
      (status='published' and effective_from is not null and published_by_user_id is not null and published_at is not null and retired_by_user_id is null and retired_at is null and retirement_reason is null)
      or
      (status='retired' and effective_from is not null and effective_until is not null and published_by_user_id is not null and published_at is not null and retired_by_user_id is not null and retired_at is not null and char_length(btrim(retirement_reason)) between 6 and 1000)
    )
);

create index sellertray_addon_versions_resolution_idx
  on public.sellertray_addon_versions(addon_definition_id,status,effective_from desc,version desc);

create table public.sellertray_addon_feature_grants (
  addon_version_id uuid not null references public.sellertray_addon_versions(id) on delete restrict,
  feature_code text not null references public.sellertray_feature_catalogue(code) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (addon_version_id,feature_code)
);

create table public.sellertray_addon_capability_grants (
  addon_version_id uuid not null references public.sellertray_addon_versions(id) on delete restrict,
  capability_code text not null references public.sellertray_capability_catalogue(code) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (addon_version_id,capability_code)
);

create table public.sellertray_addon_limit_values (
  addon_version_id uuid not null references public.sellertray_addon_versions(id) on delete restrict,
  limit_code text not null references public.sellertray_limit_definitions(code) on delete restrict,
  limit_delta numeric(18,6),
  is_unlimited boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (addon_version_id,limit_code),
  constraint sellertray_addon_limit_values_shape_check
    check ((is_unlimited and limit_delta is null) or (not is_unlimited and limit_delta is not null and limit_delta >= 0))
);

create or replace function public.guard_sellertray_plan_profile_version_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if tg_op='DELETE' then
    raise exception 'SellerTray Plan Profile version history is immutable' using errcode='55000';
  end if;

  if old.status='retired' then
    raise exception 'Retired SellerTray Plan Profile versions are immutable' using errcode='55000';
  end if;

  if old.status='published' then
    if new.status<>'retired'
       or (to_jsonb(new)-array['status','effective_until','retired_by_user_id','retired_at','retirement_reason'])
          is distinct from
          (to_jsonb(old)-array['status','effective_until','retired_by_user_id','retired_at','retirement_reason']) then
      raise exception 'Published SellerTray Plan Profile content is immutable' using errcode='55000';
    end if;
  elsif old.status='draft' and new.status not in ('draft','published') then
    raise exception 'Draft SellerTray Plan Profile version may only remain draft or be published' using errcode='23514';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_sellertray_addon_version_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if tg_op='DELETE' then
    raise exception 'SellerTray add-on version history is immutable' using errcode='55000';
  end if;

  if old.status='retired' then
    raise exception 'Retired SellerTray add-on versions are immutable' using errcode='55000';
  end if;

  if old.status='published' then
    if new.status<>'retired'
       or (to_jsonb(new)-array['status','effective_until','retired_by_user_id','retired_at','retirement_reason'])
          is distinct from
          (to_jsonb(old)-array['status','effective_until','retired_by_user_id','retired_at','retirement_reason']) then
      raise exception 'Published SellerTray add-on content is immutable' using errcode='55000';
    end if;
  elsif old.status='draft' and new.status not in ('draft','published') then
    raise exception 'Draft SellerTray add-on version may only remain draft or be published' using errcode='23514';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_sellertray_profile_grant_mutation()
returns trigger
language plpgsql
set search_path=''
as $function$
declare
  v_version_id uuid;
  v_status text;
begin
  if tg_table_name like 'sellertray_plan_profile_%' then
    v_version_id:=case when tg_op='DELETE' then old.plan_profile_version_id else new.plan_profile_version_id end;
    select v.status into v_status from public.sellertray_plan_profile_versions v where v.id=v_version_id;
  else
    v_version_id:=case when tg_op='DELETE' then old.addon_version_id else new.addon_version_id end;
    select v.status into v_status from public.sellertray_addon_versions v where v.id=v_version_id;
  end if;

  if v_status is distinct from 'draft' then
    raise exception 'Published or retired entitlement grants are immutable' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$function$;

revoke all on function public.guard_sellertray_plan_profile_version_mutation() from public,anon,authenticated;
revoke all on function public.guard_sellertray_addon_version_mutation() from public,anon,authenticated;
revoke all on function public.guard_sellertray_profile_grant_mutation() from public,anon,authenticated;

create trigger guard_sellertray_plan_profile_version_mutation
before update or delete on public.sellertray_plan_profile_versions
for each row execute function public.guard_sellertray_plan_profile_version_mutation();

create trigger guard_sellertray_addon_version_mutation
before update or delete on public.sellertray_addon_versions
for each row execute function public.guard_sellertray_addon_version_mutation();

create trigger guard_sellertray_plan_feature_grants
before insert or update or delete on public.sellertray_plan_profile_feature_grants
for each row execute function public.guard_sellertray_profile_grant_mutation();
create trigger guard_sellertray_plan_capability_grants
before insert or update or delete on public.sellertray_plan_profile_capability_grants
for each row execute function public.guard_sellertray_profile_grant_mutation();
create trigger guard_sellertray_plan_limit_values
before insert or update or delete on public.sellertray_plan_profile_limit_values
for each row execute function public.guard_sellertray_profile_grant_mutation();
create trigger guard_sellertray_addon_feature_grants
before insert or update or delete on public.sellertray_addon_feature_grants
for each row execute function public.guard_sellertray_profile_grant_mutation();
create trigger guard_sellertray_addon_capability_grants
before insert or update or delete on public.sellertray_addon_capability_grants
for each row execute function public.guard_sellertray_profile_grant_mutation();
create trigger guard_sellertray_addon_limit_values
before insert or update or delete on public.sellertray_addon_limit_values
for each row execute function public.guard_sellertray_profile_grant_mutation();

create or replace function public.publish_sellertray_plan_profile_version_admin(
  p_plan_profile_version_id uuid,
  p_effective_from timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_reason text:=btrim(coalesce(p_reason,''));
  v_result uuid;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.plans.manage',null,now()) then
    raise exception 'Plan Profile management capability required' using errcode='42501';
  end if;
  if p_effective_from is null or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Effective time and a reason between 6 and 1000 characters are required' using errcode='22023';
  end if;

  update public.sellertray_plan_profile_versions v
  set status='published',effective_from=p_effective_from,change_reason=v_reason,
      published_by_user_id=p_actor_user_id,published_at=now()
  where v.id=p_plan_profile_version_id and v.status='draft'
  returning v.id into v_result;

  if v_result is null then
    if exists(select 1 from public.sellertray_plan_profile_versions v where v.id=p_plan_profile_version_id and v.status='published' and v.effective_from=p_effective_from and v.change_reason=v_reason) then
      return p_plan_profile_version_id;
    end if;
    raise exception 'Draft Plan Profile version not found or publication facts conflict' using errcode='23514';
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_publish_plan_profile_version',jsonb_build_object(
    'planProfileVersionId',v_result,'effectiveFrom',p_effective_from,'reason',v_reason
  ));
  return v_result;
end;
$function$;

create or replace function public.retire_sellertray_plan_profile_version_admin(
  p_plan_profile_version_id uuid,
  p_effective_until timestamptz,
  p_reason text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_reason text:=btrim(coalesce(p_reason,''));
  v_result uuid;
  v_effective_from timestamptz;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.plans.manage',null,now()) then
    raise exception 'Plan Profile management capability required' using errcode='42501';
  end if;
  select effective_from into v_effective_from from public.sellertray_plan_profile_versions where id=p_plan_profile_version_id;
  if v_effective_from is null or p_effective_until is null or p_effective_until<=v_effective_from or char_length(v_reason) not between 6 and 1000 then
    raise exception 'Valid retirement time and a reason between 6 and 1000 characters are required' using errcode='22023';
  end if;

  update public.sellertray_plan_profile_versions v
  set status='retired',effective_until=p_effective_until,retired_by_user_id=p_actor_user_id,
      retired_at=now(),retirement_reason=v_reason
  where v.id=p_plan_profile_version_id and v.status='published'
  returning v.id into v_result;

  if v_result is null then
    if exists(select 1 from public.sellertray_plan_profile_versions v where v.id=p_plan_profile_version_id and v.status='retired' and v.effective_until=p_effective_until and v.retirement_reason=v_reason) then
      return p_plan_profile_version_id;
    end if;
    raise exception 'Published Plan Profile version not found or retirement facts conflict' using errcode='23514';
  end if;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(p_actor_user_id,null,'sellertray_retire_plan_profile_version',jsonb_build_object(
    'planProfileVersionId',v_result,'effectiveUntil',p_effective_until,'reason',v_reason
  ));
  return v_result;
end;
$function$;

revoke all on function public.publish_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.retire_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid) to service_role;
grant execute on function public.retire_sellertray_plan_profile_version_admin(uuid,timestamptz,text,uuid) to service_role;

-- Seed the real catalogue from C2-1. These rows classify vocabulary only; they
-- do not grant any plan entitlement.
insert into public.sellertray_feature_catalogue(code,display_name,description,commercialization_class,status) values
  ('mobile_pos','Mobile POS','Mobile selling and checkout operations.','unclassified','active'),
  ('merchant_web','Merchant Web','Desktop management, configuration and analysis surface.','unclassified','active'),
  ('catalogue','Catalogue','Products, categories, units, barcodes and product pricing management.','unclassified','active'),
  ('orders','Orders','Order capture, review and fulfilment workflows.','unclassified','active'),
  ('inventory','Inventory','Branch stock operations, counts, transfers and stock visibility.','unclassified','active'),
  ('payments','Payments','Customer payment, receivable and payment-management workflows.','unclassified','active'),
  ('customers','Customers','Customer management and history.','unclassified','active'),
  ('cash_shifts','Cash & Shifts','Cashier shift and governed cash-movement operations.','unclassified','active'),
  ('purchasing','Purchasing','Supplier purchasing and receiving workflows.','unclassified','active'),
  ('whatsapp_commerce','WhatsApp Commerce','WhatsApp catalogue, order and customer commerce channel.','unclassified','active'),
  ('ai_insights','AI Insights','Read-only governed SellerTray AI business assistance.','unclassified','active'),
  ('reports','Reports','Merchant operational and management reporting.','unclassified','active'),
  ('offline_operations','Offline Operations','Bounded offline operation with governed replay.','unclassified','active'),
  ('printing_devices','Printing & Devices','Receipt printing and governed device/printer management.','unclassified','active'),
  ('integrations','Integrations','Approved external integrations and APIs.','unclassified','planned')
on conflict (code) do nothing;

insert into public.sellertray_capability_catalogue(code,feature_code,display_name,description,legacy_permission_code,commercialization_class,status) values
  ('sales.create','mobile_pos','Create sales','Create governed POS or merchant sales.',null,'unclassified','active'),
  ('sales.discount','mobile_pos','Apply discounts','Apply approved sale discounts within governed transaction policy.',null,'unclassified','active'),
  ('sales.partial_payment','payments','Partial payment','Accept approved partial payment against a sale.',null,'unclassified','active'),
  ('sales.pay_later','payments','Pay later','Create an approved customer outstanding balance.',null,'unclassified','active'),
  ('sales.return','orders','Return sale','Create governed sale returns.',null,'unclassified','active'),
  ('sales.refund','payments','Refund sale','Perform approved sale refund operations.','can_refund_sale','unclassified','active'),
  ('receivables.collect','payments','Collect receivable','Collect an outstanding customer balance.',null,'unclassified','active'),
  ('inventory.receive','inventory','Receive stock','Receive stock through governed inventory/purchasing authority.','can_receive_stock','unclassified','active'),
  ('inventory.adjust','inventory','Adjust stock','Perform governed stock adjustments.','can_adjust_stock','unclassified','active'),
  ('inventory.count','inventory','Count stock','Perform stock counts.','can_count_stock','unclassified','active'),
  ('inventory.count.apply','inventory','Apply stock count','Apply an approved stock-count reconciliation.','can_apply_stock_count','unclassified','active'),
  ('inventory.transfer','inventory','Transfer stock','Transfer stock between authorised Branches.','can_transfer_stock','unclassified','active'),
  ('cash.shift.open','cash_shifts','Open shift','Open an authorised cashier shift.','can_open_shift','authorization_only','active'),
  ('cash.movement.record','cash_shifts','Record cash movement','Record governed cash movement.','can_record_cash_movement','authorization_only','active'),
  ('expenses.cashier.record','cash_shifts','Record cashier expense','Record an authorised cashier expense.','can_record_expense','authorization_only','active'),
  ('cash.movement.correct','cash_shifts','Correct cash movement','Perform governed cash correction.','can_correct_cash_movement','authorization_only','active'),
  ('cash.shift.close','cash_shifts','Close shift','Close an authorised cashier shift.','can_close_shift','authorization_only','active'),
  ('cash.shift.review','cash_shifts','Review shift','Review governed cashier shift evidence.','can_review_shift','authorization_only','active'),
  ('printing.receipt','printing_devices','Print receipt','Print or reprint governed transaction documents.','can_print_receipt','unclassified','active'),
  ('devices.manage','printing_devices','Manage devices','Manage authorised SellerTray devices and printers.','can_manage_devices','unclassified','active'),
  ('orders.manage','orders','Manage orders','Manage merchant orders.','can_manage_orders','unclassified','active'),
  ('catalogue.manage','catalogue','Manage catalogue','Manage products and catalogue configuration.','can_manage_products','unclassified','active'),
  ('purchasing.manage','purchasing','Manage purchasing','Manage purchasing and receiving workflows.','can_manage_purchasing','unclassified','active'),
  ('payments.manage','payments','Manage payments','Manage payment and receivable workflows.','can_manage_payments','unclassified','active'),
  ('reports.view','reports','View reports','View authorised SellerTray reports.','can_view_reports','unclassified','active'),
  ('agreements.accept','merchant_web','Accept commercial agreements','Accept a required SellerTray commercial agreement as an authorised merchant actor.','can_accept_commercial_agreements','authorization_only','active'),
  ('whatsapp.sell','whatsapp_commerce','Sell on WhatsApp','Perform governed WhatsApp selling for the resolved Branch.',null,'unclassified','active'),
  ('ai.insights.use','ai_insights','Use AI insights','Use governed read-only SellerTray AI insights.',null,'unclassified','active')
on conflict (code) do nothing;

-- Candidate limit vocabulary only. No Plan Profile receives these limits here,
-- and Branch count is intentionally absent under current Commercial V2 policy.
insert into public.sellertray_limit_definitions(code,display_name,description,unit_code,measurement_kind,scope_kind,meter_code,commercialization_class,status) values
  ('staff_seats','Staff seats','Maximum governed staff-seat allowance if later activated by an approved Plan Profile.','users','count','branch_subscription',null,'unclassified','candidate'),
  ('ai_usage','AI usage','Governed AI usage allowance if later activated and bound to authoritative usage.','requests','count','branch_subscription',null,'unclassified','candidate'),
  ('whatsapp_usage','WhatsApp usage','Governed WhatsApp commerce usage allowance if later activated and metered.','events','count','branch_subscription',null,'unclassified','candidate'),
  ('report_exports','Report exports','Governed report export allowance if later activated.','exports','count','branch_subscription',null,'unclassified','candidate'),
  ('device_count','Device count','Governed device allowance if later activated.','devices','count','branch_subscription',null,'unclassified','candidate')
on conflict (code) do nothing;

-- Starter/Growth/Scale are editable draft seeds only. They have no grants and
-- therefore no runtime meaning until a governed version is explicitly published
-- and later consumed by the C2 Branch entitlement resolver.
insert into public.sellertray_plan_profiles(code,default_display_name,status,sort_order) values
  ('starter','Starter','active',10),
  ('growth','Growth','active',20),
  ('scale','Scale','active',30)
on conflict (code) do nothing;

insert into public.sellertray_plan_profile_versions(
  plan_profile_id,version,status,display_name,description,merchant_summary,
  allowed_billing_cycles,change_reason
)
select p.id,1,'draft',p.default_display_name,
       'Editable Commercial V2 seed. Entitlements are intentionally unassigned until governed publication.',
       'Draft SellerTray plan seed — not yet available for purchase or runtime entitlement.',
       array['monthly','yearly']::text[],
       'Commercial V2 editable seed; no runtime authority'
from public.sellertray_plan_profiles p
where p.code in ('starter','growth','scale')
  and not exists (
    select 1 from public.sellertray_plan_profile_versions v
    where v.plan_profile_id=p.id and v.version=1
  );

-- Public schema defense-in-depth: no merchant/browser role receives direct
-- catalogue/master writes. C2 Admin services use service_role after their own
-- authenticated AAL2/capability checks.
do $acl$
declare
  v_table text;
begin
  foreach v_table in array array[
    'sellertray_feature_catalogue','sellertray_capability_catalogue','sellertray_limit_definitions',
    'sellertray_plan_profiles','sellertray_plan_profile_versions',
    'sellertray_plan_profile_feature_grants','sellertray_plan_profile_capability_grants','sellertray_plan_profile_limit_values',
    'sellertray_addon_definitions','sellertray_addon_versions',
    'sellertray_addon_feature_grants','sellertray_addon_capability_grants','sellertray_addon_limit_values'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on table public.%I from public,anon,authenticated',v_table);
    execute format('grant select,insert,update,delete on table public.%I to service_role',v_table);
  end loop;
end
$acl$;

commit;
