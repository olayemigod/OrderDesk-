alter table public.platform_admin_capability_grant_versions
  drop constraint if exists platform_admin_capability_code_check,
  add constraint platform_admin_capability_code_check
  check (capability_code = any (array[
    'admin.pricing.manage'::text,
    'admin.payments.reconcile'::text,
    'admin.installments.manage'::text,
    'admin.branch_setup.manage'::text,
    'admin.agreements.publish'::text
  ]));

create table public.sellertray_master_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  version_code text not null unique,
  title text not null,
  content_body text not null,
  content_sha256 text not null,
  effective_from timestamptz not null,
  published_by_user_id uuid not null references auth.users(id) on delete restrict,
  publish_reason text not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (effective_from),
  constraint sellertray_master_agreement_version_code_check check (char_length(btrim(version_code)) between 1 and 64 and version_code=btrim(version_code)),
  constraint sellertray_master_agreement_title_check check (char_length(btrim(title)) between 1 and 200 and title=btrim(title)),
  constraint sellertray_master_agreement_content_check check (char_length(content_body) between 1 and 200000),
  constraint sellertray_master_agreement_hash_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_master_agreement_publish_reason_check check (char_length(btrim(publish_reason)) between 6 and 1000 and publish_reason=btrim(publish_reason))
);
create index sellertray_master_agreement_effective_idx on public.sellertray_master_agreement_versions(effective_from desc,published_at desc);
alter table public.sellertray_master_agreement_versions enable row level security;
revoke all on table public.sellertray_master_agreement_versions from public,anon,authenticated;
grant all on table public.sellertray_master_agreement_versions to service_role;

create or replace function public.prepare_sellertray_master_agreement_version()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  new.version_code:=btrim(new.version_code);
  new.title:=btrim(new.title);
  new.publish_reason:=btrim(new.publish_reason);
  new.content_sha256:=encode(extensions.digest(new.content_body,'sha256'),'hex');
  new.published_at:=coalesce(new.published_at,now());
  new.created_at:=coalesce(new.created_at,now());
  return new;
end;
$$;
revoke all on function public.prepare_sellertray_master_agreement_version() from public,anon,authenticated;
create trigger prepare_sellertray_master_agreement_version before insert on public.sellertray_master_agreement_versions for each row execute function public.prepare_sellertray_master_agreement_version();
create trigger prevent_sellertray_master_agreement_version_mutation before update or delete on public.sellertray_master_agreement_versions for each row execute function public.prevent_sellertray_commercial_history_mutation();

create table public.sellertray_master_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  agreement_version_id uuid not null references public.sellertray_master_agreement_versions(id) on delete restrict,
  agreement_version_code text not null,
  agreement_content_sha256 text not null,
  accepted_by_user_id uuid not null references auth.users(id) on delete restrict,
  accepted_legal_name text not null,
  accepted_role text not null,
  acceptance_method text not null default 'merchant_web_authenticated',
  request_evidence jsonb not null default '{}'::jsonb,
  command_id uuid not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,agreement_version_id),
  unique (tenant_id,command_id),
  constraint sellertray_master_agreement_acceptance_role_check check (accepted_role in ('owner','manager')),
  constraint sellertray_master_agreement_acceptance_name_check check (char_length(btrim(accepted_legal_name)) between 1 and 200 and accepted_legal_name=btrim(accepted_legal_name)),
  constraint sellertray_master_agreement_acceptance_method_check check (acceptance_method='merchant_web_authenticated'),
  constraint sellertray_master_agreement_acceptance_hash_check check (agreement_content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sellertray_master_agreement_acceptance_evidence_check check (jsonb_typeof(request_evidence)='object')
);
create index sellertray_master_agreement_acceptances_tenant_idx on public.sellertray_master_agreement_acceptances(tenant_id,accepted_at desc);
create index sellertray_master_agreement_acceptances_version_idx on public.sellertray_master_agreement_acceptances(agreement_version_id,accepted_at desc);
alter table public.sellertray_master_agreement_acceptances enable row level security;
revoke all on table public.sellertray_master_agreement_acceptances from public,anon,authenticated;
grant all on table public.sellertray_master_agreement_acceptances to service_role;
create trigger prevent_sellertray_master_agreement_acceptance_mutation before update or delete on public.sellertray_master_agreement_acceptances for each row execute function public.prevent_sellertray_commercial_history_mutation();

create or replace function public.resolve_sellertray_master_agreement_version_id(p_as_of timestamptz default now())
returns uuid language sql stable security definer set search_path=''
as $$
  select v.id from public.sellertray_master_agreement_versions v
  where v.effective_from<=p_as_of
  order by v.effective_from desc,v.published_at desc,v.id desc limit 1
$$;
revoke all on function public.resolve_sellertray_master_agreement_version_id(timestamptz) from public,anon,authenticated;
grant execute on function public.resolve_sellertray_master_agreement_version_id(timestamptz) to service_role;

create or replace function public.sellertray_master_agreement_accepted_at(p_tenant_id uuid,p_as_of timestamptz default now())
returns timestamptz language sql stable security definer set search_path=''
as $$
  select a.accepted_at
  from public.sellertray_master_agreement_acceptances a
  where a.tenant_id=p_tenant_id
    and a.agreement_version_id=public.resolve_sellertray_master_agreement_version_id(p_as_of)
  limit 1
$$;
revoke all on function public.sellertray_master_agreement_accepted_at(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.sellertray_master_agreement_accepted_at(uuid,timestamptz) to service_role;

create or replace function public.sellertray_master_agreement_is_accepted(p_tenant_id uuid,p_as_of timestamptz default now())
returns boolean language sql stable security definer set search_path=''
as $$
  select public.resolve_sellertray_master_agreement_version_id(p_as_of) is not null
     and public.sellertray_master_agreement_accepted_at(p_tenant_id,p_as_of) is not null
$$;
revoke all on function public.sellertray_master_agreement_is_accepted(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.sellertray_master_agreement_is_accepted(uuid,timestamptz) to service_role;

create or replace function public.get_sellertray_master_agreement_state(p_tenant_id uuid,p_as_of timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_version public.sellertray_master_agreement_versions%rowtype; v_acceptance public.sellertray_master_agreement_acceptances%rowtype;
begin
  if p_tenant_id is null or not exists(select 1 from public.tenants t where t.id=p_tenant_id) then raise exception 'Business not found' using errcode='P0002'; end if;
  select v.* into v_version from public.sellertray_master_agreement_versions v where v.id=public.resolve_sellertray_master_agreement_version_id(p_as_of);
  if v_version.id is not null then
    select a.* into v_acceptance from public.sellertray_master_agreement_acceptances a where a.tenant_id=p_tenant_id and a.agreement_version_id=v_version.id;
  end if;
  return jsonb_build_object(
    'tenantId',p_tenant_id,
    'asOf',p_as_of,
    'published',v_version.id is not null,
    'currentVersion',case when v_version.id is null then null else jsonb_build_object('id',v_version.id,'versionCode',v_version.version_code,'title',v_version.title,'contentBody',v_version.content_body,'contentSha256',v_version.content_sha256,'effectiveFrom',v_version.effective_from,'publishedAt',v_version.published_at) end,
    'accepted',v_acceptance.id is not null,
    'acceptanceRequired',v_version.id is not null and v_acceptance.id is null,
    'serviceDeliveryAllowed',v_version.id is not null and v_acceptance.id is not null,
    'acceptance',case when v_acceptance.id is null then null else jsonb_build_object('id',v_acceptance.id,'agreementVersionId',v_acceptance.agreement_version_id,'versionCode',v_acceptance.agreement_version_code,'contentSha256',v_acceptance.agreement_content_sha256,'acceptedByUserId',v_acceptance.accepted_by_user_id,'acceptedLegalName',v_acceptance.accepted_legal_name,'acceptedRole',v_acceptance.accepted_role,'acceptanceMethod',v_acceptance.acceptance_method,'acceptedAt',v_acceptance.accepted_at) end,
    'blocker',case when v_version.id is null then 'master_agreement_not_published' when v_acceptance.id is null then 'master_agreement_acceptance_required' else null end
  );
end;
$$;
revoke all on function public.get_sellertray_master_agreement_state(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.get_sellertray_master_agreement_state(uuid,timestamptz) to service_role;

create or replace function public.publish_sellertray_master_agreement_admin(p_version_code text,p_title text,p_content_body text,p_effective_from timestamptz,p_reason text,p_actor_user_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_version_code text:=btrim(coalesce(p_version_code,'')); v_title text:=btrim(coalesce(p_title,'')); v_reason text:=btrim(coalesce(p_reason,'')); v_content text:=coalesce(p_content_body,''); v_hash text:=encode(extensions.digest(coalesce(p_content_body,''),'sha256'),'hex'); v_row public.sellertray_master_agreement_versions%rowtype;
begin
  if not public.platform_admin_has_capability(p_actor_user_id,'admin.agreements.publish',null,now()) then raise exception 'Master Agreement publication capability required' using errcode='42501'; end if;
  if char_length(v_version_code) not between 1 and 64 or char_length(v_title) not between 1 and 200 or char_length(v_content) not between 1 and 200000 or p_effective_from is null or char_length(v_reason) not between 6 and 1000 then raise exception 'Version, title, agreement content, effective time and publication reason are required' using errcode='22023'; end if;
  select v.* into v_row from public.sellertray_master_agreement_versions v where v.version_code=v_version_code;
  if found then
    if v_row.title<>v_title or v_row.content_sha256<>v_hash or v_row.content_body<>v_content or v_row.effective_from<>p_effective_from or v_row.published_by_user_id<>p_actor_user_id or v_row.publish_reason<>v_reason then raise exception 'Master Agreement version already exists with different facts' using errcode='23505'; end if;
    return v_row.id;
  end if;
  insert into public.sellertray_master_agreement_versions(version_code,title,content_body,content_sha256,effective_from,published_by_user_id,publish_reason,published_at,created_at)
  values(v_version_code,v_title,v_content,v_hash,p_effective_from,p_actor_user_id,v_reason,now(),now()) returning * into v_row;
  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail) values(p_actor_user_id,null,'sellertray_master_agreement_published',jsonb_build_object('agreementVersionId',v_row.id,'versionCode',v_row.version_code,'contentSha256',v_row.content_sha256,'effectiveFrom',v_row.effective_from,'reason',v_reason));
  return v_row.id;
end;
$$;
revoke all on function public.publish_sellertray_master_agreement_admin(text,text,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.publish_sellertray_master_agreement_admin(text,text,text,timestamptz,text,uuid) to service_role;

create or replace function public.accept_sellertray_master_agreement(p_tenant_id uuid,p_agreement_version_id uuid,p_accepted_legal_name text,p_request_evidence jsonb,p_command_id uuid,p_actor_user_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_role text; v_name text:=btrim(coalesce(p_accepted_legal_name,'')); v_evidence jsonb:=coalesce(p_request_evidence,'{}'::jsonb); v_current_id uuid; v_version public.sellertray_master_agreement_versions%rowtype; v_existing public.sellertray_master_agreement_acceptances%rowtype; v_id uuid;
begin
  if p_tenant_id is null or p_agreement_version_id is null or p_command_id is null or p_actor_user_id is null then raise exception 'Business, Master Agreement version, command and accepting user are required' using errcode='22023'; end if;
  if char_length(v_name) not between 1 and 200 or jsonb_typeof(v_evidence)<>'object' then raise exception 'Authorised representative legal name and acceptance evidence are required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select a.* into v_existing from public.sellertray_master_agreement_acceptances a where a.tenant_id=p_tenant_id and a.command_id=p_command_id;
  if found then
    if v_existing.agreement_version_id<>p_agreement_version_id then raise exception 'Master Agreement acceptance command is already used for a different version' using errcode='23505'; end if;
    return v_existing.id;
  end if;
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role='owner' then null; elsif v_role='manager' and public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements') then null; else raise exception 'You are not authorised to accept the SellerTray Master Agreement' using errcode='42501'; end if;
  v_current_id:=public.resolve_sellertray_master_agreement_version_id(now());
  if v_current_id is null then raise exception 'SellerTray Master Agreement is not yet published' using errcode='23514'; end if;
  if p_agreement_version_id<>v_current_id then raise exception 'Only the current SellerTray Master Agreement version can be accepted' using errcode='23514'; end if;
  select v.* into strict v_version from public.sellertray_master_agreement_versions v where v.id=v_current_id;
  select a.* into v_existing from public.sellertray_master_agreement_acceptances a where a.tenant_id=p_tenant_id and a.agreement_version_id=v_current_id;
  if found then return v_existing.id; end if;
  insert into public.sellertray_master_agreement_acceptances(tenant_id,agreement_version_id,agreement_version_code,agreement_content_sha256,accepted_by_user_id,accepted_legal_name,accepted_role,acceptance_method,request_evidence,command_id,accepted_at,created_at)
  values(p_tenant_id,v_version.id,v_version.version_code,v_version.content_sha256,p_actor_user_id,v_name,v_role,'merchant_web_authenticated',v_evidence,p_command_id,now(),now())
  on conflict (tenant_id,agreement_version_id) do nothing returning id into v_id;
  if v_id is not null then return v_id; end if;
  select a.* into strict v_existing from public.sellertray_master_agreement_acceptances a where a.tenant_id=p_tenant_id and a.agreement_version_id=v_current_id;
  return v_existing.id;
end;
$$;
revoke all on function public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_sellertray_master_agreement(uuid,uuid,text,jsonb,uuid,uuid) to service_role;

create or replace function public.get_sellertray_master_agreement_center(p_tenant_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_role text; v_can_accept boolean; v_state jsonb; v_history jsonb;
begin
  select tm.role into v_role from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if coalesce(v_role,'') not in ('owner','manager') then raise exception 'Master Agreement access requires a Business Owner or Manager' using errcode='42501'; end if;
  v_can_accept:=public.sellertray_user_has_capability(p_tenant_id,p_actor_user_id,'can_accept_commercial_agreements');
  v_state:=public.get_sellertray_master_agreement_state(p_tenant_id,now());
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'versionCode',v.version_code,'title',v.title,'contentBody',v.content_body,'contentSha256',v.content_sha256,'effectiveFrom',v.effective_from,'publishedAt',v.published_at,'acceptance',case when a.id is null then null else jsonb_build_object('id',a.id,'acceptedAt',a.accepted_at,'acceptedLegalName',a.accepted_legal_name,'acceptedRole',a.accepted_role,'acceptedByCurrentUser',a.accepted_by_user_id=p_actor_user_id) end) order by v.effective_from desc,v.published_at desc),'[]'::jsonb) into v_history
  from public.sellertray_master_agreement_versions v left join public.sellertray_master_agreement_acceptances a on a.tenant_id=p_tenant_id and a.agreement_version_id=v.id;
  return v_state || jsonb_build_object('actorRole',v_role,'canAccept',v_can_accept,'versions',v_history);
end;
$$;
revoke all on function public.get_sellertray_master_agreement_center(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_master_agreement_center(uuid,uuid) to service_role;

create or replace function public.get_sellertray_master_agreement_admin(p_actor_user_id uuid,p_tenant_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_role text; v_versions jsonb; v_tenant_state jsonb:=null;
begin
  select pa.role into v_role from public.platform_admins pa where pa.user_id=p_actor_user_id;
  if coalesce(v_role,'') not in ('admin','support') then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  if p_tenant_id is not null then v_tenant_state:=public.get_sellertray_master_agreement_state(p_tenant_id,now()); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'versionCode',v.version_code,'title',v.title,'contentBody',v.content_body,'contentSha256',v.content_sha256,'effectiveFrom',v.effective_from,'publishedAt',v.published_at,'publishedByUserId',v.published_by_user_id,'publishReason',v.publish_reason) order by v.effective_from desc,v.published_at desc),'[]'::jsonb) into v_versions from public.sellertray_master_agreement_versions v;
  return jsonb_build_object('actorRole',v_role,'canPublish',public.platform_admin_has_capability(p_actor_user_id,'admin.agreements.publish',null,now()),'versions',v_versions,'tenantState',v_tenant_state,'generatedAt',now());
end;
$$;
revoke all on function public.get_sellertray_master_agreement_admin(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_master_agreement_admin(uuid,uuid) to service_role;

create or replace function public.sellertray_installment_agreement_is_accepted(p_tenant_id uuid,p_commercial_order_id uuid,p_installment_obligation_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select public.sellertray_master_agreement_is_accepted(p_tenant_id,now()) $$;
revoke all on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellertray_installment_agreement_is_accepted(uuid,uuid,uuid) to service_role;

create or replace function public.get_sellertray_installment_contract_checkout_policy(p_tenant_id uuid,p_installment_obligation_id uuid,p_as_of timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_obligation public.sellertray_commercial_installment_obligations%rowtype; v_snapshot public.sellertray_installment_contract_snapshots%rowtype; v_plan_code text; v_billing_cycle text; v_policy jsonb; v_policy_enabled boolean:=false; v_policy_template_id uuid; v_master jsonb;
begin
  select o.* into strict v_obligation from public.sellertray_commercial_installment_obligations o where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  select s.* into strict v_snapshot from public.sellertray_installment_contract_snapshots s where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;
  select s.plan_code,s.billing_cycle into strict v_plan_code,v_billing_cycle from public.sellertray_commercial_order_price_snapshots s where s.tenant_id=p_tenant_id and s.commercial_order_id=v_obligation.commercial_order_id and s.line_type='subscription';
  v_policy:=public.resolve_sellertray_installment_policy(p_tenant_id,v_obligation.commercial_order_id,v_plan_code,v_billing_cycle,p_as_of);
  v_policy_enabled:=coalesce((v_policy->>'enabled')::boolean,false);
  v_policy_template_id:=nullif(v_policy->>'defaultTemplateId','')::uuid;
  v_master:=public.get_sellertray_master_agreement_state(p_tenant_id,p_as_of);
  return jsonb_build_object('tenantId',p_tenant_id,'commercialOrderId',v_obligation.commercial_order_id,'installmentObligationId',v_obligation.id,'planCode',v_plan_code,'billingCycle',v_billing_cycle,'agreementAccepted',true,'agreementAcceptedAt',null,'masterAgreementPublished',coalesce((v_master->>'published')::boolean,false),'masterAgreementAccepted',coalesce((v_master->>'accepted')::boolean,false),'masterAgreementAcceptedAt',v_master->'acceptance'->>'acceptedAt','contractTemplateId',v_snapshot.template_id,'contractTemplateCode',v_snapshot.template_code,'contractTemplateVersion',v_snapshot.template_version,'currentPolicy',v_policy,'draftEligible',v_policy_enabled and v_policy_template_id=v_snapshot.template_id,'checkoutEligible',true);
end;
$$;
revoke all on function public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz) to service_role;

create or replace function public.reconcile_sellertray_installment_entitlement(p_tenant_id uuid,p_installment_obligation_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  v_obligation public.sellertray_commercial_installment_obligations%rowtype; v_order public.sellertray_commercial_orders%rowtype; v_snapshot public.sellertray_installment_contract_snapshots%rowtype; v_subscription public.tenant_subscriptions%rowtype; v_existing_provisional public.sellertray_commercial_entitlement_events%rowtype; v_existing_full public.sellertray_commercial_entitlement_events%rowtype;
  v_plan_code text; v_billing_cycle text; v_agreement_accepted_at timestamptz; v_setup_required integer:=0; v_setup_ready integer:=0; v_setup_ready_at timestamptz; v_settlement jsonb; v_qualifying_settled boolean:=false; v_fully_settled boolean:=false; v_settlement_at timestamptz; v_activation_at timestamptz; v_provisional_until timestamptz; v_full_until timestamptz; v_provisional_id uuid; v_full_id uuid; v_runtime_owned boolean:=false;
begin
  perform public.lock_sellertray_commercial_order(io.tenant_id,io.commercial_order_id) from public.sellertray_commercial_installment_obligations io where io.tenant_id=p_tenant_id and io.id=p_installment_obligation_id;
  select o.* into strict v_obligation from public.sellertray_commercial_installment_obligations o where o.tenant_id=p_tenant_id and o.id=p_installment_obligation_id;
  select o.* into strict v_order from public.sellertray_commercial_orders o where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;
  select s.* into strict v_snapshot from public.sellertray_installment_contract_snapshots s where s.tenant_id=p_tenant_id and s.installment_obligation_id=v_obligation.id;
  select s.plan_code,s.billing_cycle into strict v_plan_code,v_billing_cycle from public.sellertray_commercial_order_price_snapshots s where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='subscription';
  v_agreement_accepted_at:=public.sellertray_master_agreement_accepted_at(p_tenant_id,now());
  select count(*)::integer,count(r.id)::integer,max(r.ready_at) into v_setup_required,v_setup_ready,v_setup_ready_at from public.sellertray_commercial_order_price_snapshots s left join public.sellertray_commercial_branch_setup_readiness r on r.tenant_id=s.tenant_id and r.commercial_order_id=s.commercial_order_id and r.branch_id=s.branch_id where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='branch_setup';
  v_settlement:=public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  v_fully_settled:=coalesce((v_settlement->>'outstandingAmount')::numeric,0)<0.005;
  select coalesce(bool_and((x->>'remainingAmount')::numeric<0.005),false) into v_qualifying_settled from jsonb_array_elements(coalesce(v_settlement->'schedule','[]'::jsonb)) x where (x->>'sequenceNo')::integer<=v_snapshot.qualifying_settlement_sequence;
  select max(event_at) into v_settlement_at from (select a.approved_at event_at from public.sellertray_commercial_adjustments a where a.tenant_id=p_tenant_id and a.commercial_order_id=v_order.id union all select pc.paid_at from public.sellertray_commercial_installment_payment_confirmations pc where pc.tenant_id=p_tenant_id and pc.commercial_order_id=v_order.id union all select dp.paid_at from public.sellertray_commercial_direct_payment_confirmations dp where dp.tenant_id=p_tenant_id and dp.commercial_order_id=v_order.id) settlement_fact;
  select e.* into v_existing_provisional from public.sellertray_commercial_entitlement_events e where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id and e.event_type='installment.provisional_activated' order by e.recorded_at desc limit 1;
  select e.* into v_existing_full from public.sellertray_commercial_entitlement_events e where e.tenant_id=p_tenant_id and e.installment_obligation_id=v_obligation.id and e.event_type='installment.full_entitlement_released' order by e.recorded_at desc limit 1;
  if v_agreement_accepted_at is null or v_setup_required=0 or v_setup_ready<v_setup_required or not v_qualifying_settled or v_settlement_at is null then return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id); end if;
  if v_existing_provisional.id is not null then v_activation_at:=v_existing_provisional.effective_from; v_provisional_id:=v_existing_provisional.id; else v_activation_at:=greatest(v_agreement_accepted_at,coalesce(v_setup_ready_at,v_agreement_accepted_at),v_settlement_at); end if;
  if v_billing_cycle='monthly' then v_full_until:=v_activation_at+interval '1 month'; elsif v_billing_cycle='yearly' then v_full_until:=v_activation_at+interval '12 months'; else raise exception 'Unsupported SellerTray billing cycle for entitlement reconciliation' using errcode='23514'; end if;
  if v_snapshot.provisional_entitlement_months>0 then
    v_provisional_until:=least(v_activation_at+make_interval(months=>v_snapshot.provisional_entitlement_months),v_full_until);
    if v_existing_provisional.id is null then v_provisional_id:=public.append_sellertray_commercial_entitlement_event(p_tenant_id,v_plan_code,v_order.id,v_obligation.id,'installment.provisional_activated','oa2:provisional:'||v_obligation.id::text,v_activation_at,v_provisional_until,jsonb_build_object('template_code',v_snapshot.template_code,'template_version',v_snapshot.template_version,'provisional_months',v_snapshot.provisional_entitlement_months,'qualifying_settlement_sequence',v_snapshot.qualifying_settlement_sequence,'activation_at',v_activation_at,'full_term_until',v_full_until,'master_agreement_version_id',public.resolve_sellertray_master_agreement_version_id(v_activation_at)),null,'Governed SellerTray installment provisional entitlement'); end if;
  elsif not v_fully_settled then return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id); end if;
  if v_fully_settled then
    if v_existing_full.id is not null then v_full_id:=v_existing_full.id; else v_full_id:=public.append_sellertray_commercial_entitlement_event(p_tenant_id,v_plan_code,v_order.id,v_obligation.id,'installment.full_entitlement_released','oa2:full:'||v_obligation.id::text,v_activation_at,v_full_until,jsonb_build_object('template_code',v_snapshot.template_code,'template_version',v_snapshot.template_version,'billing_cycle',v_billing_cycle,'activation_at',v_activation_at,'settled_amount',v_settlement->>'netAmountDue','master_agreement_version_id',public.resolve_sellertray_master_agreement_version_id(now())),null,'Governed SellerTray full-settlement entitlement release'); end if;
  end if;
  select s.* into strict v_subscription from public.tenant_subscriptions s where s.tenant_id=p_tenant_id for update;
  if v_subscription.current_period_start is not null and v_subscription.current_period_end is not null then select exists(select 1 from public.sellertray_commercial_entitlement_events e where e.tenant_id=p_tenant_id and e.commercial_order_id=v_order.id and e.effective_from=v_subscription.current_period_start and e.effective_until=v_subscription.current_period_end and e.event_type in ('installment.provisional_activated','installment.full_entitlement_released')) into v_runtime_owned; end if;
  if v_subscription.status<>'trial' and not v_runtime_owned and (v_subscription.current_period_start is not null or v_subscription.current_period_end is not null or v_subscription.status<>'active') then raise exception 'Existing SellerTray runtime subscription is not owned by this commercial installment order' using errcode='23505'; end if;
  update public.tenant_subscriptions set plan_code=v_plan_code,status='active',current_period_start=v_activation_at,current_period_end=case when v_full_id is not null then v_full_until else v_provisional_until end,grace_ends_at=null,cancel_at_period_end=false,updated_at=now() where tenant_id=p_tenant_id;
  return public.get_sellertray_installment_billing_state(p_tenant_id,p_installment_obligation_id);
end;
$$;

alter function public.get_sellertray_onboarding_state_core(uuid) rename to get_sellertray_onboarding_state_core_legacy_order_agreement;

create or replace function public.get_sellertray_onboarding_state_core(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_state jsonb; v_master jsonb; v_stage text; v_blockers jsonb; v_next jsonb; v_required integer; v_ready integer; v_branch jsonb;
begin
  v_state:=public.get_sellertray_onboarding_state_core_legacy_order_agreement(p_tenant_id);
  v_master:=public.get_sellertray_master_agreement_state(p_tenant_id,now());
  if coalesce(v_state->'activation'->>'entitlementState','not_active') in ('provisional','full') then return v_state || jsonb_build_object('readModelVersion','master-agreement-v1','agreement',jsonb_build_object('required',true,'published',coalesce((v_master->>'published')::boolean,false),'accepted',coalesce((v_master->>'accepted')::boolean,false),'acceptedAt',v_master->'acceptance'->>'acceptedAt','currentVersion',v_master->'currentVersion','requiredForNewServiceDelivery',true)); end if;
  if v_state->'commercialOrder' is null then return v_state || jsonb_build_object('readModelVersion','master-agreement-v1','agreement',jsonb_build_object('required',false,'published',coalesce((v_master->>'published')::boolean,false),'accepted',coalesce((v_master->>'accepted')::boolean,false),'acceptedAt',v_master->'acceptance'->>'acceptedAt','currentVersion',v_master->'currentVersion','requiredForNewServiceDelivery',true)); end if;
  if not coalesce((v_master->>'published')::boolean,false) then v_stage:='agreement'; v_blockers:=jsonb_build_array(jsonb_build_object('code','master_agreement_not_published','message','The SellerTray Master Agreement must be published before new service delivery can activate.','surface','admin_web')); v_next:=jsonb_build_object('code','await_master_agreement_publication','label','Await Master Agreement publication','surface','admin_web');
  elsif not coalesce((v_master->>'accepted')::boolean,false) then v_stage:='agreement'; v_blockers:=jsonb_build_array(jsonb_build_object('code','master_agreement_acceptance_required','message','Accept the current SellerTray Master Agreement before service delivery can activate.','surface','merchant_web')); v_next:=jsonb_build_object('code','review_master_agreement','label','Review and accept Master Agreement','surface','merchant_web');
  elsif not coalesce((v_state->'settlement'->>'qualifyingSettlementSatisfied')::boolean,false) then v_stage:='settlement'; v_blockers:=jsonb_build_array(jsonb_build_object('code','qualifying_settlement_required','message','A qualifying confirmed payment is required before Branch setup can complete activation.','surface','merchant_web')); v_next:=jsonb_build_object('code','pay_outstanding','label','Complete required payment','surface','merchant_web');
  else v_required:=coalesce((v_state->'branchSetup'->>'requiredCount')::integer,0); v_ready:=coalesce((v_state->'branchSetup'->>'readyCount')::integer,0);
    if v_required=0 then v_stage:='setup'; v_blockers:=jsonb_build_array(jsonb_build_object('code','branch_setup_scope_required','message','The commercial purchase does not yet contain a governed Branch setup scope.','surface','admin_web')); v_next:=jsonb_build_object('code','resolve_setup_scope','label','Resolve Branch setup scope','surface','admin_web');
    elsif v_ready<v_required then v_stage:='setup'; v_blockers:='[]'::jsonb; for v_branch in select value from jsonb_array_elements(coalesce(v_state->'branchSetup'->'branches','[]'::jsonb)) loop if not coalesce((v_branch->>'ready')::boolean,false) then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','branch_setup_incomplete','branchId',v_branch->>'branchId','message',coalesce(v_branch->>'branchName','Branch')||' — '||coalesce(v_branch->>'setupStatus','Setup incomplete')||'. Activation is waiting for this Branch.','surface','admin_web')); end if; end loop; if jsonb_array_length(v_blockers)=0 then v_blockers:=jsonb_build_array(jsonb_build_object('code','branch_setup_incomplete','message',format('%s of %s required Branch setups are complete.',v_ready,v_required),'surface','admin_web')); end if; v_next:=jsonb_build_object('code','prepare_branches','label','Prepare Branch setup','surface','mobile');
    else v_stage:='activation'; v_blockers:=jsonb_build_array(jsonb_build_object('code','activation_reconciliation_pending','message','Master Agreement, settlement and Branch setup are ready. Activation reconciliation is pending.','surface','shared_core')); v_next:=jsonb_build_object('code','await_activation_reconciliation','label','Await automatic activation','surface','shared_core'); end if;
  end if;
  return v_state || jsonb_build_object('readModelVersion','master-agreement-v1','currentStage',v_stage,'blockers',v_blockers,'nextAction',v_next,'agreement',jsonb_build_object('required',true,'published',coalesce((v_master->>'published')::boolean,false),'accepted',coalesce((v_master->>'accepted')::boolean,false),'acceptedAt',v_master->'acceptance'->>'acceptedAt','currentVersion',v_master->'currentVersion','requiredForNewServiceDelivery',true));
end;
$$;
revoke all on function public.get_sellertray_onboarding_state_core(uuid) from public,anon,authenticated;
grant execute on function public.get_sellertray_onboarding_state_core(uuid) to service_role;

create or replace function public.accept_sellertray_commercial_agreement(p_tenant_id uuid,p_agreement_id uuid,p_accepted_legal_name text,p_request_evidence jsonb,p_command_id uuid,p_actor_user_id uuid)
returns uuid language plpgsql security invoker set search_path=''
as $$ begin raise exception 'Legacy order-bound agreement acceptance is retired. Use the SellerTray Master Agreement.' using errcode='0A000'; end; $$;
revoke all on function public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid) to service_role;

create or replace function public.issue_sellertray_commercial_agreement(p_tenant_id uuid,p_commercial_order_id uuid,p_installment_obligation_id uuid,p_template_version_id uuid,p_agreement_reference text,p_rendered_content text,p_supersedes_agreement_id uuid,p_actor_user_id uuid)
returns uuid language plpgsql security invoker set search_path=''
as $$ begin raise exception 'Legacy merchant/order-specific agreement issuance is retired. Publish a universal SellerTray Master Agreement version.' using errcode='0A000'; end; $$;
revoke all on function public.issue_sellertray_commercial_agreement(uuid,uuid,uuid,uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_sellertray_commercial_agreement(uuid,uuid,uuid,uuid,text,text,uuid,uuid) to service_role;

create or replace function public.issue_sellertray_commercial_agreement_admin(p_tenant_id uuid,p_commercial_order_id uuid,p_installment_obligation_id uuid,p_template_version_id uuid,p_agreement_reference text,p_rendered_content text,p_supersedes_agreement_id uuid,p_reason text,p_actor_user_id uuid)
returns uuid language plpgsql security invoker set search_path=''
as $$ begin raise exception 'Legacy merchant/order-specific agreement issuance is retired. Publish a universal SellerTray Master Agreement version.' using errcode='0A000'; end; $$;
revoke all on function public.issue_sellertray_commercial_agreement_admin(uuid,uuid,uuid,uuid,text,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.issue_sellertray_commercial_agreement_admin(uuid,uuid,uuid,uuid,text,text,uuid,text,uuid) to service_role;
