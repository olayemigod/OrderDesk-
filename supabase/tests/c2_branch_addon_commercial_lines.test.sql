begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(27);

select extensions.ok(
  exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.sellertray_commercial_installment_obligations'::regclass
      and t.tgname='snapshot_sellertray_inserted_installment_contract'
      and position('obligation_scope' in pg_get_triggerdef(t.oid))>0
      and position('commercial_order' in pg_get_triggerdef(t.oid))>0
  ),
  'Legacy C1 installment snapshot trigger does not run on native Branch obligations'
);

select extensions.ok(
  exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='sellertray_commercial_order_price_snapshots'
      and column_name='addon_version_id'),
  'C2 Branch add-on commercial lines store the exact add-on version'
);
select extensions.ok(
  position('branch_addon' in pg_get_constraintdef((
    select oid from pg_constraint where conrelid=
      'public.sellertray_commercial_order_price_snapshots'::regclass
      and conname='sellertray_commercial_order_price_snapshots_type_check'
  )))>0,
  'Commercial order lines accept governed Branch add-on charges'
);
select extensions.ok(
  position('branch_addon' in pg_get_functiondef(
    'public.snapshot_sellertray_commercial_order_price()'::regprocedure))>0,
  'Add-on line price and tax are snapshotted from the effective master'
);
select extensions.ok(
  position('branch_addon' in pg_get_functiondef(
    'public.prepare_sellertray_commercial_installment_obligation()'::regprocedure))>0,
  'Branch add-on prices enter the existing installment obligation authority'
);
select extensions.ok(
  position('v_line.addon_version_id' in pg_get_functiondef(
    'public.validate_sellertray_branch_subscription_addon_insert()'::regprocedure))>0,
  'A later entitlement assignment must identify its exact purchased add-on'
);
select extensions.ok(
  not has_function_privilege('authenticated',
    'public.create_sellertray_c2_branch_commercial_order(uuid,text,jsonb,text,uuid,text,uuid)',
    'EXECUTE'),
  'Merchant browser cannot bypass the governed Branch order service'
);
select extensions.ok(
  has_function_privilege('service_role',
    'public.create_sellertray_c2_branch_commercial_order(uuid,text,jsonb,text,uuid,text,uuid)',
    'EXECUTE'),
  'Server commercial order authority remains available'
);
select extensions.ok(
  not has_table_privilege('authenticated',
    'public.sellertray_commercial_order_price_snapshots','INSERT'),
  'Merchant clients cannot forge immutable add-on price evidence'
);

create temp table c2_addon_order_fixture(
  tenant_id uuid not null,
  actor_id uuid not null,
  plan_id uuid not null,
  plan_version_id uuid not null,
  addon_definition_id uuid not null,
  addon_version_id uuid not null,
  branch_id uuid,
  command_id uuid not null,
  request jsonb,
  result jsonb,
  legacy_before jsonb,
  changed_command_rejected boolean not null default false,
  wrong_cycle_rejected boolean not null default false,
  duplicate_addon_rejected boolean not null default false,
  unknown_addon_rejected boolean not null default false,
  wrong_subscription_cycle_rejected boolean not null default false
) on commit drop;

insert into c2_addon_order_fixture(
  tenant_id,actor_id,plan_id,plan_version_id,addon_definition_id,addon_version_id,command_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_id,'c2-addon-'||substr(actor_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from c2_addon_order_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C2 Add-on Purchase Test',
  'c2-addon-'||substr(tenant_id::text,1,8),'C2A','active'
from c2_addon_order_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,actor_id,'owner' from c2_addon_order_fixture;

insert into public.tenant_subscriptions(
  tenant_id,plan_code,status,current_period_start,current_period_end,cancel_at_period_end
)
select tenant_id,'business','active','2026-01-01T00:00:00Z',
  '2026-12-31T00:00:00Z',false
from c2_addon_order_fixture
on conflict(tenant_id) do update set
  plan_code=excluded.plan_code,status=excluded.status,
  trial_started_at=null,trial_ends_at=null,
  current_period_start=excluded.current_period_start,
  current_period_end=excluded.current_period_end,grace_ends_at=null,
  cancel_at_period_end=false;

update c2_addon_order_fixture f set
  branch_id=(select b.id from public.branches b
    where b.tenant_id=f.tenant_id and b.is_default limit 1),
  legacy_before=(select to_jsonb(s) from public.tenant_subscriptions s
    where s.tenant_id=f.tenant_id);

insert into public.sellertray_plan_profiles(
  id,code,default_display_name,status,created_by_user_id
)
select plan_id,'c2_addon_plan','C2 Add-on Plan','active',actor_id
from c2_addon_order_fixture;

insert into public.sellertray_plan_profile_versions(
  id,plan_profile_id,version,status,display_name,description,merchant_summary,
  allowed_billing_cycles,effective_from,change_reason,
  created_by_user_id,published_by_user_id,published_at
)
select plan_version_id,plan_id,1,'published','C2 Add-on Plan v1',
  'Published Plan Profile for Branch add-on order tests.',
  'C2 Add-on Plan',array['monthly','yearly']::text[],
  '2026-01-01T00:00:00Z','Publish C2 add-on test plan',
  actor_id,actor_id,'2026-01-01T00:00:00Z'
from c2_addon_order_fixture;

insert into public.sellertray_addon_definitions(
  id,code,default_display_name,status,created_by_user_id
)
select addon_definition_id,'c2_addon_order','C2 Add-on Order','active',actor_id
from c2_addon_order_fixture;

insert into public.sellertray_addon_versions(
  id,addon_definition_id,version,status,display_name,description,
  allowed_billing_cycles,effective_from,change_reason,
  created_by_user_id,published_by_user_id,published_at
)
select addon_version_id,addon_definition_id,1,'published',
  'C2 Add-on Version v1','Published add-on for Branch order and settlement tests.',
  array['yearly']::text[],'2026-01-01T00:00:00Z',
  'Publish C2 add-on order version',
  actor_id,actor_id,'2026-01-01T00:00:00Z'
from c2_addon_order_fixture;

insert into public.sellertray_commercial_price_versions(
  price_kind,charge_type_code,plan_code,plan_profile_version_id,addon_version_id,
  billing_cycle,currency,gross_amount,effective_from,status,change_reason,
  created_by_user_id,approved_by_user_id,approved_at,price_scope
)
select 'subscription','branch_subscription',null,plan_version_id,null::uuid,
  'yearly','NGN',10000,'2026-01-01T00:00:00Z'::timestamptz,
  'published','C2 test Branch subscription price',actor_id,actor_id,now(),'standard'
from c2_addon_order_fixture
union all
select 'branch_setup','branch_setup',null,null,null::uuid,
  null,'NGN',5000,'2026-01-01T00:00:00Z'::timestamptz,
  'published','C2 test Branch setup price',actor_id,actor_id,now(),'standard'
from c2_addon_order_fixture
union all
select 'addon','addon',null,null,addon_version_id,
  'yearly','NGN',2500,'2026-01-01T00:00:00Z'::timestamptz,
  'published','C2 test Branch add-on price',actor_id,actor_id,now(),'standard'
from c2_addon_order_fixture;

update c2_addon_order_fixture f set request=jsonb_build_array(
  jsonb_build_object(
    'branchId',f.branch_id,
    'planProfileVersionId',f.plan_version_id,
    'billingCycle','yearly',
    'setupRequired',true,
    'addonSelections',jsonb_build_array(jsonb_build_object(
      'addonVersionId',f.addon_version_id,'billingCycle','yearly'
    ))
  )
);

select set_config('request.jwt.claim.role','service_role',true);

update c2_addon_order_fixture f set result=
  public.create_sellertray_c2_branch_commercial_order(
    f.tenant_id,'NGN',f.request,
    'c2-addon-'||substr(f.tenant_id::text,1,8),
    f.command_id,'system',f.actor_id
  );

select extensions.ok(
  exists(
    select 1 from pg_trigger t
    where t.tgrelid='public.sellertray_branch_subscriptions'::regclass
      and t.tgname='validate_sellertray_native_branch_subscription_purchase'
      and not t.tgisinternal
  ),
  'Native Branch Subscription registration has database purchase-line binding'
);

do $test$
declare
  v c2_addon_order_fixture%rowtype;
begin
  select * into strict v from c2_addon_order_fixture;
  begin
    perform public.register_sellertray_branch_subscription_term(
      v.tenant_id,v.branch_id,v.plan_version_id,'monthly',now(),
      (v.result->>'commercialOrderId')::uuid,
      (v.result->'subjects'->0->>'branchSubscriptionLineId')::uuid,
      (v.result->'subjects'->0->>'installmentObligationId')::uuid,
      true,null,null,null,'commercial_order',
      jsonb_build_object('test','wrong-purchased-cycle'),
      gen_random_uuid(),'system',v.actor_id
    );
  exception when sqlstate '23514' then
    update c2_addon_order_fixture set wrong_subscription_cycle_rejected=true;
  end;
end
$test$;

select extensions.ok(
  (select wrong_subscription_cycle_rejected from c2_addon_order_fixture),
  'A yearly-priced Branch order cannot register a monthly entitlement term'
);

select extensions.is(
  (select (result->>'totalGrossAmount')::numeric
    from c2_addon_order_fixture),17500::numeric,
  'Branch order gross includes subscription, setup and add-on'
);
select extensions.ok(
  (select count(*)=3
   from public.sellertray_commercial_order_price_snapshots l
   join c2_addon_order_fixture f
     on f.tenant_id=l.tenant_id
    and (f.result->>'commercialOrderId')::uuid=l.commercial_order_id),
  'Branch purchase freezes exactly three independent price lines'
);
select extensions.ok(
  (select count(*)=1
     and max(l.gross_amount)=2500
     and max(l.addon_version_id)=f.addon_version_id
   from public.sellertray_commercial_order_price_snapshots l
   join c2_addon_order_fixture f on f.tenant_id=l.tenant_id
   where l.commercial_order_id=(f.result->>'commercialOrderId')::uuid
     and l.branch_id=f.branch_id and l.line_type='branch_addon'
   group by f.addon_version_id),
  'Add-on commercial line pins its Branch, add-on version and gross amount'
);
select extensions.ok(
  (select count(*)=1 and max(o.obligated_amount)=17500
   from public.sellertray_commercial_installment_obligations o
   join c2_addon_order_fixture f on f.tenant_id=o.tenant_id
   where o.commercial_order_id=(f.result->>'commercialOrderId')::uuid
     and o.branch_id=f.branch_id),
  'Branch installment obligation includes its full add-on gross'
);
select extensions.ok(
  (select count(*)=1 and sum(s.amount_due)=17500
   from public.sellertray_commercial_installment_schedule s
   join public.sellertray_commercial_installment_obligations o
     on o.id=s.installment_obligation_id
   join c2_addon_order_fixture f on f.tenant_id=o.tenant_id
   where o.commercial_order_id=(f.result->>'commercialOrderId')::uuid),
  'Configured upfront schedule reconciles to the Branch add-on inclusive payable'
);
select extensions.ok(
  (select exists(
    select 1 from jsonb_array_elements(
      public.build_sellertray_commercial_agreement_snapshot(
        f.tenant_id,(f.result->>'commercialOrderId')::uuid,null
      )->'price_snapshots'
    ) l where l->>'line_type'='branch_addon'
      and (l->>'addon_version_id')::uuid=f.addon_version_id
      and (l->>'gross_amount')::numeric=2500
  ) from c2_addon_order_fixture f),
  'Merchant Order Form snapshot names the purchased add-on version and amount'
);
select extensions.ok(
  (select jsonb_array_length(
    public.build_sellertray_commercial_agreement_snapshot(
      f.tenant_id,(f.result->>'commercialOrderId')::uuid,null
    )->'branch_commitments'->0->'addon_lines'
  )=1 from c2_addon_order_fixture f),
  'Merchant Order Form includes exact Branch add-on line evidence'
);
select extensions.is(
  (select (public.create_sellertray_c2_branch_commercial_order(
    f.tenant_id,'NGN',f.request,'c2-addon-'||substr(f.tenant_id::text,1,8),
    f.command_id,'system',f.actor_id)->>'commercialOrderId')::uuid
   from c2_addon_order_fixture f),
  (select (result->>'commercialOrderId')::uuid from c2_addon_order_fixture),
  'Exact commercial add-on purchase replay returns the original order'
);
select extensions.ok(
  (select (
    public.create_sellertray_c2_branch_commercial_order(
      f.tenant_id,'NGN',f.request,'c2-addon-'||substr(f.tenant_id::text,1,8),
      f.command_id,'system',f.actor_id
    )->'subjects'->0->'addonLines'->0->>'addonLineId'
  )=(f.result->'subjects'->0->'addonLines'->0->>'addonLineId')
   from c2_addon_order_fixture f),
  'Exact replay returns the same snapshotted add-on line identity'
);

do $test$
declare
  v c2_addon_order_fixture%rowtype;
  v_bad jsonb;
begin
  select * into strict v from c2_addon_order_fixture;
  v_bad:=jsonb_set(v.request,'{0,addonSelections,0,billingCycle}','"monthly"'::jsonb);
  begin
    perform public.create_sellertray_c2_branch_commercial_order(
      v.tenant_id,'NGN',v_bad,'c2-addon-'||substr(v.tenant_id::text,1,8),
      v.command_id,'system',v.actor_id);
  exception when sqlstate '23505' then
    update c2_addon_order_fixture set changed_command_rejected=true;
  end;
  begin
    perform public.create_sellertray_c2_branch_commercial_order(
      v.tenant_id,'NGN',v_bad,'c2-addon-wrong-cycle-'||substr(v.tenant_id::text,1,8),
      gen_random_uuid(),'system',v.actor_id);
  exception when sqlstate '23514' then
    update c2_addon_order_fixture set wrong_cycle_rejected=true;
  end;
  v_bad:=jsonb_set(v.request,'{0,addonSelections}',
    jsonb_build_array(v.request#>'{0,addonSelections,0}',
                      v.request#>'{0,addonSelections,0}'));
  begin
    perform public.create_sellertray_c2_branch_commercial_order(
      v.tenant_id,'NGN',v_bad,'c2-addon-duplicate-'||substr(v.tenant_id::text,1,8),
      gen_random_uuid(),'system',v.actor_id);
  exception when sqlstate '23514' then
    update c2_addon_order_fixture set duplicate_addon_rejected=true;
  end;
  v_bad:=jsonb_set(v.request,'{0,addonSelections,0,addonVersionId}',
    to_jsonb(gen_random_uuid()::text));
  begin
    perform public.create_sellertray_c2_branch_commercial_order(
      v.tenant_id,'NGN',v_bad,'c2-addon-unknown-'||substr(v.tenant_id::text,1,8),
      gen_random_uuid(),'system',v.actor_id);
  exception when sqlstate '23514' then
    update c2_addon_order_fixture set unknown_addon_rejected=true;
  end;
end
$test$;

select extensions.ok((select changed_command_rejected from c2_addon_order_fixture),
  'A commercial order command cannot be replayed with altered add-on choices');
select extensions.ok((select wrong_cycle_rejected from c2_addon_order_fixture),
  'Recurring add-on cannot silently acquire a different renewal cycle');
select extensions.ok((select duplicate_addon_rejected from c2_addon_order_fixture),
  'Duplicate versions of one add-on cannot be charged twice on a Branch');
select extensions.ok((select unknown_addon_rejected from c2_addon_order_fixture),
  'Unknown or unpublished add-on version fails closed');
select extensions.is(
  (select count(*)::integer from public.sellertray_branch_subscription_addons a
    join c2_addon_order_fixture f on f.tenant_id=a.tenant_id),0,
  'An add-on order alone does not grant operational add-on entitlement'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_branch_subscriptions s
    join c2_addon_order_fixture f on f.tenant_id=s.tenant_id),0,
  'Creating a commercial order does not activate or register the Branch term'
);
select extensions.ok(
  (select legacy_before=(select to_jsonb(s) from public.tenant_subscriptions s
     where s.tenant_id=f.tenant_id)
   from c2_addon_order_fixture f),
  'Commercial V2 add-on purchase does not change legacy subscription truth'
);

select * from extensions.finish();
rollback;
