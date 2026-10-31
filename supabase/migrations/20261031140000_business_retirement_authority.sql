-- Governed SellerTray Business retirement.
-- Hard deletion is intentionally not used because membership, commercial and legal
-- evidence is append-only. Retirement removes operational access and excludes the
-- Business from active platform portfolios/reporting while preserving audit history.

alter table public.tenants
  add column if not exists retired_at timestamptz,
  add column if not exists retirement_reason text,
  add column if not exists retired_by_user_id uuid,
  add column if not exists retirement_command_id uuid;

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='tenants_retired_by_user_id_fkey'
      and conrelid='public.tenants'::regclass
  ) then
    alter table public.tenants
      add constraint tenants_retired_by_user_id_fkey
      foreign key (retired_by_user_id) references auth.users(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='tenants_retirement_state_check'
      and conrelid='public.tenants'::regclass
  ) then
    alter table public.tenants
      add constraint tenants_retirement_state_check check (
        (retired_at is null and retirement_reason is null and retired_by_user_id is null and retirement_command_id is null)
        or
        (retired_at is not null and retirement_reason is not null and retirement_command_id is not null)
      );
  end if;
end
$do$;

create unique index if not exists tenants_retirement_command_id_uidx
  on public.tenants(retirement_command_id)
  where retirement_command_id is not null;

create or replace function public.guard_sellertray_tenant_retirement()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if old.retired_at is not null and (
    new.retired_at is distinct from old.retired_at
    or new.retirement_reason is distinct from old.retirement_reason
    or new.retired_by_user_id is distinct from old.retired_by_user_id
    or new.retirement_command_id is distinct from old.retirement_command_id
  ) then
    raise exception 'SellerTray Business retirement evidence is immutable'
      using errcode='55000';
  end if;
  if old.retired_at is null and new.retired_at is not null then
    if nullif(btrim(coalesce(new.retirement_reason,'')),'') is null
       or new.retirement_command_id is null then
      raise exception 'SellerTray Business retirement requires reason and command id'
        using errcode='22023';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_sellertray_tenant_retirement on public.tenants;
create trigger guard_sellertray_tenant_retirement
before update of retired_at,retirement_reason,retired_by_user_id,retirement_command_id
on public.tenants
for each row execute function public.guard_sellertray_tenant_retirement();

create or replace function public.sellertray_tenant_is_retired(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select exists(
    select 1 from public.tenants t
    where t.id=p_tenant_id and t.retired_at is not null
  );
$function$;

revoke execute on function public.sellertray_tenant_is_retired(uuid) from public;
grant execute on function public.sellertray_tenant_is_retired(uuid) to authenticated,service_role;

create or replace function public.retire_sellertray_tenant_admin(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_reason text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_tenant public.tenants%rowtype;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_member_count integer:=0;
  v_branch_count integer:=0;
  v_invitation_count integer:=0;
begin
  if p_actor_user_id is null or p_tenant_id is null or p_command_id is null then
    raise exception 'Actor, Business and command id are required' using errcode='22023';
  end if;
  if v_reason is null or char_length(v_reason)<8 or char_length(v_reason)>500 then
    raise exception 'Retirement reason must be between 8 and 500 characters' using errcode='22023';
  end if;
  if not public.platform_admin_has_capability(
    p_actor_user_id,'admin.merchants.retire',p_tenant_id,now()
  ) then
    raise exception 'Business retirement capability required' using errcode='42501';
  end if;

  select * into v_tenant
  from public.tenants t
  where t.id=p_tenant_id
  for update;

  if not found then
    raise exception 'Business not found' using errcode='P0002';
  end if;

  if v_tenant.retired_at is not null then
    if v_tenant.retirement_command_id=p_command_id then
      return jsonb_build_object(
        'tenantId',v_tenant.id,'name',v_tenant.name,'retiredAt',v_tenant.retired_at,
        'alreadyRetired',true,'commandId',v_tenant.retirement_command_id
      );
    end if;
    raise exception 'Business is already retired' using errcode='55000';
  end if;

  if exists(
    select 1 from public.tenants t
    where t.retirement_command_id=p_command_id and t.id<>p_tenant_id
  ) then
    raise exception 'Retirement command id was already used' using errcode='23505';
  end if;

  select count(*)::integer into v_member_count
  from public.tenant_members tm where tm.tenant_id=p_tenant_id;
  select count(*)::integer into v_branch_count
  from public.branches b where b.tenant_id=p_tenant_id and b.is_active;
  select count(*)::integer into v_invitation_count
  from public.tenant_invitations i where i.tenant_id=p_tenant_id and i.status='pending';

  insert into public.sellertray_membership_events(
    tenant_id,event_type,subject_user_id,subject_email,previous_role,new_role,
    actor_user_id,actor_kind,reason,command_id,detail
  )
  select
    tm.tenant_id,'member_removed',tm.user_id,u.email,tm.role,null,
    p_actor_user_id,'platform_admin',v_reason,null,
    jsonb_build_object('source','business_retirement','retirementCommandId',p_command_id)
  from public.tenant_members tm
  left join auth.users u on u.id=tm.user_id
  where tm.tenant_id=p_tenant_id;

  insert into public.sellertray_membership_events(
    tenant_id,event_type,subject_email,invitation_id,actor_user_id,actor_kind,
    reason,command_id,detail
  )
  select
    i.tenant_id,'invitation_cancelled',i.email,i.id,p_actor_user_id,'platform_admin',
    v_reason,null,
    jsonb_build_object('source','business_retirement','retirementCommandId',p_command_id)
  from public.tenant_invitations i
  where i.tenant_id=p_tenant_id and i.status='pending';

  update public.tenant_invitations
  set status='cancelled',updated_at=now()
  where tenant_id=p_tenant_id and status='pending';

  delete from public.tenant_members where tenant_id=p_tenant_id;

  update public.branches
  set is_active=false,updated_at=now()
  where tenant_id=p_tenant_id and is_active;

  update public.tenant_subscriptions
  set status='cancelled',cancel_at_period_end=false,updated_at=now()
  where tenant_id=p_tenant_id and status<>'cancelled';

  update public.tenant_whatsapp_connections
  set connection_status='disconnected',webhook_subscription_status='unknown',
      updated_by_user_id=p_actor_user_id,updated_at=now()
  where tenant_id=p_tenant_id and connection_status<>'disconnected';

  update public.tenants
  set retired_at=now(),retirement_reason=v_reason,retired_by_user_id=p_actor_user_id,
      retirement_command_id=p_command_id,subscription_status='cancelled',
      whatsapp_connection_status='not_connected',updated_at=now()
  where id=p_tenant_id;

  insert into public.platform_admin_audit(actor_user_id,tenant_id,action,detail)
  values(
    p_actor_user_id,p_tenant_id,'tenant_retired',
    jsonb_build_object(
      'reason',v_reason,'commandId',p_command_id,'businessName',v_tenant.name,
      'membersRevoked',v_member_count,'activeBranchesDeactivated',v_branch_count,
      'pendingInvitationsCancelled',v_invitation_count,
      'commercialAndLegalHistoryPreserved',true,'authUsersPreserved',true
    )
  );

  return jsonb_build_object(
    'tenantId',p_tenant_id,'name',v_tenant.name,'retiredAt',(select retired_at from public.tenants where id=p_tenant_id),
    'membersRevoked',v_member_count,'activeBranchesDeactivated',v_branch_count,
    'pendingInvitationsCancelled',v_invitation_count,'alreadyRetired',false,'commandId',p_command_id
  );
end;
$function$;

revoke execute on function public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid) to service_role;

create or replace function public.sellertray_list_businesses_for_current_user()
returns table(
  id uuid,name text,slug text,merchant_code text,role text,business_email text,business_phone text,
  business_type text,logo_url text,currency text,timezone text,onboarding_status text,
  subscription_status text,whatsapp_connection_status text,membership_created_at timestamptz
)
language sql
stable security definer
set search_path=''
as $function$
  select
    t.id,t.name,t.slug,t.merchant_code,tm.role,t.business_email,t.business_phone,t.business_type,
    t.logo_url,t.currency,t.timezone,t.onboarding_status,t.subscription_status,
    t.whatsapp_connection_status,tm.created_at
  from public.tenant_members tm
  join public.tenants t on t.id=tm.tenant_id
  where tm.user_id=auth.uid() and t.retired_at is null
  order by tm.created_at asc;
$function$;

create or replace function public.orderdesk_subscription_can_write(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path=''
as $function$
  select coalesce(
    (
      select case
        when exists(select 1 from public.tenants t where t.id=s.tenant_id and t.retired_at is not null) then false
        when not exists(select 1 from public.tenants t where t.id=s.tenant_id) then false
        when not exists(select 1 from public.subscription_plans p where p.code=s.plan_code and p.is_active) then false
        when public.sellertray_c1b_runtime_period_state(s.tenant_id) in ('provisional_expired','full_term_expired') then false
        when s.status='active' then true
        when s.status='trial' and public.sellertray_has_governed_subscription_purchase(s.tenant_id) then false
        when s.status='trial' then s.trial_ends_at is null or s.trial_ends_at>now()
        when s.status='grace' then s.grace_ends_at is null or s.grace_ends_at>now()
        else false
      end
      from public.tenant_subscriptions s
      where s.tenant_id=p_tenant_id
    ),false
  );
$function$;

-- Patch existing server read models in-place so retirement is an authority concern,
-- not a browser-only hide. The helper converges from the old shape, accepts the
-- already-converged production shape, and fails closed on any unknown divergence.
create or replace function sellertray_private._patch_retirement_filter(
  p_signature text,p_old text,p_new text
)
returns void
language plpgsql
set search_path=''
as $function$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new_pattern text;
begin
  v_oid:=to_regprocedure(p_signature);
  if v_oid is null then raise exception 'Required function missing: %',p_signature; end if;
  select pg_get_functiondef(v_oid) into v_def;
  v_old:=replace(p_old,E'\\n',E'\n');
  v_new_pattern:=replace(p_new,E'\\n',E'\n');

  if position(v_old in v_def)>0 then
    execute replace(v_def,v_old,v_new_pattern);
    return;
  end if;

  if position(v_new_pattern in v_def)>0 then
    return;
  end if;

  raise exception 'Retirement convergence pattern missing in %',p_signature;
end;
$function$;

-- Active-estate reads.
select sellertray_private._patch_retirement_filter('public.platform_admin_bootstrap(uuid)','(select count(*)::integer from public.tenants)','(select count(*)::integer from public.tenants where retired_at is null)');
select sellertray_private._patch_retirement_filter('public.platform_admin_bootstrap(uuid)','from public.tenants t','from (select * from public.tenants where retired_at is null) t');
select sellertray_private._patch_retirement_filter('public.platform_admin_merchant_portfolio(uuid,text,text,text,uuid,integer)','from public.tenants t','from (select * from public.tenants where retired_at is null) t');
select sellertray_private._patch_retirement_filter('public.platform_admin_overview(uuid)','from public.tenants t','from (select * from public.tenants where retired_at is null) t');
select sellertray_private._patch_retirement_filter('public.platform_admin_operations_summary(uuid)','from public.tenants t','from (select * from public.tenants where retired_at is null) t');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_attention(uuid)','from public.tenants t','from (select * from public.tenants where retired_at is null) t');
select sellertray_private._patch_retirement_filter('public.platform_admin_onboarding_commercial_report(uuid,integer)','from public.tenants t','from (select * from public.tenants where retired_at is null) t');
select sellertray_private._patch_retirement_filter('public.platform_admin_commercial_agreement_portfolio(uuid,text,text,timestamp with time zone,uuid,integer)','join public.tenants t','join (select * from public.tenants where retired_at is null) t');
select sellertray_private._patch_retirement_filter('public.platform_admin_commercial_installment_portfolio(uuid,text,text,timestamp with time zone,uuid,integer)','join public.tenants t','join (select * from public.tenants where retired_at is null) t');

-- Revenue/business summary: remove retired tenants from merchant activity and
-- ProcessEdge commercial amounts while retaining immutable source rows.
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','from public.orders o where','from public.orders o join public.tenants rt_sales on rt_sales.id=o.tenant_id and rt_sales.retired_at is null where');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','from public.sellertray_commercial_entitlement_events\n    where','from public.sellertray_commercial_entitlement_events e\n    join public.tenants rt_activation on rt_activation.id=e.tenant_id and rt_activation.retired_at is null\n    where');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','from public.tenants t','from (select * from public.tenants where retired_at is null) t');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','select currency from public.sellertray_commercial_orders','select co_currency.currency from public.sellertray_commercial_orders co_currency join public.tenants rt_co_currency on rt_co_currency.id=co_currency.tenant_id and rt_co_currency.retired_at is null');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','union select currency from public.sellertray_commercial_installment_payment_confirmations','union select pc_currency.currency from public.sellertray_commercial_installment_payment_confirmations pc_currency join public.tenants rt_pc_currency on rt_pc_currency.id=pc_currency.tenant_id and rt_pc_currency.retired_at is null');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','union select currency from public.sale_returns where status=''completed'' and created_at>=v_previous and created_at<v_now','union select r_currency.currency from public.sale_returns r_currency join public.tenants rt_r_currency on rt_r_currency.id=r_currency.tenant_id and rt_r_currency.retired_at is null where r_currency.status=''completed'' and r_currency.created_at>=v_previous and r_currency.created_at<v_now');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','from public.sale_returns r where','from public.sale_returns r join public.tenants rt_return on rt_return.id=r.tenant_id and rt_return.retired_at is null where');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','from public.sellertray_commercial_installment_payment_confirmations x where','from public.sellertray_commercial_installment_payment_confirmations x join public.tenants rt_pay on rt_pay.id=x.tenant_id and rt_pay.retired_at is null where');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','from public.sellertray_commercial_orders o where','from public.sellertray_commercial_orders o join public.tenants rt_order on rt_order.id=o.tenant_id and rt_order.retired_at is null where');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','from public.sellertray_commercial_installment_obligations o\n    left join','from public.sellertray_commercial_installment_obligations o\n    join public.tenants rt_obligation on rt_obligation.id=o.tenant_id and rt_obligation.retired_at is null\n    left join');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','''totalMerchants'',(select count(*) from public.tenants),','''totalMerchants'',(select count(*) from public.tenants where retired_at is null),');
select sellertray_private._patch_retirement_filter('public.platform_admin_business_summary_pre_oa5b(uuid,integer)','''whatsappConnected'',(select count(*) from public.tenants where whatsapp_connection_status=''connected''),','''whatsappConnected'',(select count(*) from public.tenants where retired_at is null and whatsapp_connection_status=''connected''),');

drop function sellertray_private._patch_retirement_filter(text,text,text);

comment on function public.retire_sellertray_tenant_admin(uuid,uuid,text,uuid) is
  'Service-only Platform Admin command that retires a SellerTray Business without deleting immutable commercial/legal/audit evidence.';
