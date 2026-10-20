begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(27);

create temp table sellertray_commercial_fixture (
  admin_user_id uuid not null,
  tenant_id uuid not null,
  other_tenant_id uuid not null,
  branch_id uuid,
  second_branch_id uuid,
  other_branch_id uuid,
  monthly_old_price_id uuid,
  monthly_new_price_id uuid,
  yearly_old_price_id uuid,
  yearly_new_price_id uuid,
  setup_price_id uuid,
  commercial_order_id uuid,
  installment_obligation_id uuid,
  first_event_id uuid,
  repeated_event_id uuid,
  invalid_yearly_rejected boolean not null default false,
  immutable_price_rejected boolean not null default false,
  future_price_rejected boolean not null default false,
  cross_tenant_branch_rejected boolean not null default false,
  amount_mismatch_rejected boolean not null default false,
  immutable_snapshot_rejected boolean not null default false,
  immutable_order_rejected boolean not null default false,
  invalid_schedule_rejected boolean not null default false,
  conflicting_event_rejected boolean not null default false,
  immutable_event_rejected boolean not null default false,
  cross_tenant_event_rejected boolean not null default false
) on commit drop;

insert into sellertray_commercial_fixture(admin_user_id,tenant_id,other_tenant_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,
       'commercial-admin-'||substr(admin_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from sellertray_commercial_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C1 Commercial Tenant','c1-commercial-'||substr(tenant_id::text,1,8),'C1A','trial'
from sellertray_commercial_fixture
union all
select other_tenant_id,'C1 Commercial Other','c1-commercial-other-'||substr(other_tenant_id::text,1,8),'C1B','trial'
from sellertray_commercial_fixture;

update sellertray_commercial_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_commercial_fixture f
set other_branch_id=b.id
from public.branches b
where b.tenant_id=f.other_tenant_id and b.is_default=true;

with second_branch as (
  insert into public.branches(tenant_id,code,name,is_default,is_active)
  select tenant_id,'SECOND','Second Branch',false,true
  from sellertray_commercial_fixture
  returning id
)
update sellertray_commercial_fixture
set second_branch_id=(select id from second_branch);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',100,
         '2026-01-01T00:00:00Z','C1 test monthly price',admin_user_id,admin_user_id,now()
  from sellertray_commercial_fixture
  returning id
)
update sellertray_commercial_fixture set monthly_old_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',1000,
         '2026-01-01T00:00:00Z','C1 test yearly 10-for-12 price',admin_user_id,admin_user_id,now()
  from sellertray_commercial_fixture
  returning id
)
update sellertray_commercial_fixture set yearly_old_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'branch_setup',null,null,'NGN',50,
         '2026-01-01T00:00:00Z','C1 test Branch setup price',admin_user_id,admin_user_id,now()
  from sellertray_commercial_fixture
  returning id
)
update sellertray_commercial_fixture set setup_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',120,
         '2026-06-01T00:00:00Z','C1 test later monthly price',admin_user_id,admin_user_id,now()
  from sellertray_commercial_fixture
  returning id
)
update sellertray_commercial_fixture set monthly_new_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',1200,
         '2026-06-01T00:00:00Z','C1 test later yearly 10-for-12 price',admin_user_id,admin_user_id,now()
  from sellertray_commercial_fixture
  returning id
)
update sellertray_commercial_fixture set yearly_new_price_id=(select id from inserted);

select extensions.ok(
  to_regclass('public.sellertray_commercial_price_versions') is not null
  and to_regclass('public.sellertray_commercial_orders') is not null
  and to_regclass('public.sellertray_commercial_order_price_snapshots') is not null
  and to_regclass('public.sellertray_commercial_installment_obligations') is not null
  and to_regclass('public.sellertray_commercial_installment_schedule') is not null
  and to_regclass('public.sellertray_commercial_entitlement_events') is not null
  and to_regprocedure('public.resolve_sellertray_commercial_price_version(text,text,text,text,timestamptz)') is not null
  and to_regprocedure('public.append_sellertray_commercial_entitlement_event(uuid,text,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid,text)') is not null,
  'C1 commercial foundation tables and governed helpers exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid='public.sellertray_commercial_price_versions'::regclass
      and c.confrelid='public.subscription_plans'::regclass
      and c.contype='f'
  ),
  'C1 effective pricing bridges the existing subscription plan authority instead of creating a competing plan table'
);

select extensions.is(
  (select count(*)::integer
   from pg_class c
   where c.oid in (
     'public.sellertray_commercial_price_versions'::regclass,
     'public.sellertray_commercial_orders'::regclass,
     'public.sellertray_commercial_order_price_snapshots'::regclass,
     'public.sellertray_commercial_installment_obligations'::regclass,
     'public.sellertray_commercial_installment_schedule'::regclass,
     'public.sellertray_commercial_entitlement_events'::regclass
   ) and c.relrowsecurity),
  6,
  'all C1 commercial tables explicitly enable RLS'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_commercial_price_versions','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_commercial_orders','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_commercial_entitlement_events','INSERT')
  and not has_function_privilege(
    'authenticated',
    'public.append_sellertray_commercial_entitlement_event(uuid,text,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid,text)',
    'EXECUTE'
  ),
  'C1 commercial persistence is service-authority only and not directly exposed to authenticated clients'
);

select extensions.is(
  public.resolve_sellertray_commercial_price_version(
    'subscription','business','monthly','NGN','2026-03-01T00:00:00Z'
  ),
  (select monthly_old_price_id from sellertray_commercial_fixture),
  'effective-dated price resolution returns the historical monthly price'
);

select extensions.is(
  public.resolve_sellertray_commercial_price_version(
    'subscription','business','monthly','NGN','2026-07-01T00:00:00Z'
  ),
  (select monthly_new_price_id from sellertray_commercial_fixture),
  'effective-dated price resolution returns the newest applicable monthly version'
);

select extensions.is(
  (select gross_amount from public.sellertray_commercial_price_versions
   where id=(select yearly_old_price_id from sellertray_commercial_fixture)),
  1000::numeric,
  'published yearly subscription price preserves the approved 10-for-12 rule'
);

do $$
begin
  begin
    insert into public.sellertray_commercial_price_versions(
      price_kind,plan_code,billing_cycle,currency,gross_amount,
      effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
    )
    select 'subscription','business','yearly','NGN',1199,
           '2026-07-01T00:00:00Z','Invalid yearly ratio',admin_user_id,admin_user_id,now()
    from sellertray_commercial_fixture;
  exception when sqlstate '23514' then
    update sellertray_commercial_fixture set invalid_yearly_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select invalid_yearly_rejected from sellertray_commercial_fixture),
  'yearly price versions that violate 10-for-12 are rejected'
);

do $$
begin
  begin
    update public.sellertray_commercial_price_versions
    set gross_amount=gross_amount
    where id=(select monthly_old_price_id from sellertray_commercial_fixture);
  exception when sqlstate '55000' then
    update sellertray_commercial_fixture set immutable_price_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select immutable_price_rejected from sellertray_commercial_fixture),
  'published commercial price history is immutable'
);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,
         'C1-'||upper(substr(tenant_id::text,1,8)),
         'NGN',1050,'2026-03-01T00:00:00Z',admin_user_id
  from sellertray_commercial_fixture
  returning id
)
update sellertray_commercial_fixture set commercial_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select tenant_id,commercial_order_id,1,'subscription',yearly_old_price_id,'Annual subscription'
from sellertray_commercial_fixture;

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot
)
select tenant_id,commercial_order_id,2,'branch_setup',setup_price_id,branch_id,'Branch setup'
from sellertray_commercial_fixture;

set constraints all immediate;

select extensions.is(
  (select sum(gross_amount)::numeric(18,2)
   from public.sellertray_commercial_order_price_snapshots
   where commercial_order_id=(select commercial_order_id from sellertray_commercial_fixture)),
  1050::numeric,
  'commercial order total reconciles exactly to immutable price snapshots'
);

select extensions.ok(
  exists (
    select 1
    from public.sellertray_commercial_order_price_snapshots s
    join sellertray_commercial_fixture f on f.commercial_order_id=s.commercial_order_id
    where s.line_type='subscription'
      and s.source_price_version_id=f.yearly_old_price_id
      and s.plan_code='business'
      and s.billing_cycle='yearly'
      and s.gross_amount=1000
  ),
  'commercial order preserves the price version and plan facts effective at order time'
);

do $$
begin
  begin
    insert into public.sellertray_commercial_order_price_snapshots(
      tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
    )
    select tenant_id,commercial_order_id,3,'subscription',yearly_new_price_id,'Future annual price'
    from sellertray_commercial_fixture;
  exception when sqlstate '23514' then
    update sellertray_commercial_fixture set future_price_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select future_price_rejected from sellertray_commercial_fixture),
  'an order cannot snapshot a commercial price that was not effective at its order time'
);

do $$
begin
  begin
    insert into public.sellertray_commercial_order_price_snapshots(
      tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot
    )
    select tenant_id,commercial_order_id,3,'branch_setup',setup_price_id,other_branch_id,'Wrong tenant Branch'
    from sellertray_commercial_fixture;
  exception when sqlstate '23503' then
    update sellertray_commercial_fixture set cross_tenant_branch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cross_tenant_branch_rejected from sellertray_commercial_fixture),
  'commercial order snapshots reject a Branch from another tenant'
);

do $$
begin
  begin
    insert into public.sellertray_commercial_order_price_snapshots(
      tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot
    )
    select tenant_id,commercial_order_id,3,'branch_setup',setup_price_id,second_branch_id,'Unfunded extra Branch setup'
    from sellertray_commercial_fixture;
  exception when sqlstate '23514' then
    update sellertray_commercial_fixture set amount_mismatch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select amount_mismatch_rejected from sellertray_commercial_fixture),
  'commercial order amount integrity rejects snapshots that no longer reconcile to the governed total'
);

do $$
begin
  begin
    update public.sellertray_commercial_order_price_snapshots
    set gross_amount=gross_amount
    where commercial_order_id=(select commercial_order_id from sellertray_commercial_fixture)
      and line_no=1;
  exception when sqlstate '55000' then
    update sellertray_commercial_fixture set immutable_snapshot_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select immutable_snapshot_rejected from sellertray_commercial_fixture),
  'commercial order price snapshots cannot be edited in place'
);

do $$
begin
  begin
    update public.sellertray_commercial_orders
    set total_gross_amount=total_gross_amount
    where id=(select commercial_order_id from sellertray_commercial_fixture);
  exception when sqlstate '55000' then
    update sellertray_commercial_fixture set immutable_order_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select immutable_order_rejected from sellertray_commercial_fixture),
  'recorded commercial orders are immutable historical facts'
);

set constraints all deferred;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,created_by_user_id
  )
  select tenant_id,commercial_order_id,'two_installment_70_30',admin_user_id
  from sellertray_commercial_fixture
  returning id
)
update sellertray_commercial_fixture set installment_obligation_id=(select id from inserted);

insert into public.sellertray_commercial_installment_schedule(
  tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at
)
select tenant_id,installment_obligation_id,1,70,735,null
from sellertray_commercial_fixture
union all
select tenant_id,installment_obligation_id,2,30,315,null
from sellertray_commercial_fixture;

set constraints all immediate;

select extensions.ok(
  exists (
    select 1
    from public.sellertray_commercial_installment_obligations o
    join sellertray_commercial_fixture f on f.installment_obligation_id=o.id
    where o.currency='NGN' and o.obligated_amount=1050
  ),
  'installment obligation copies the commercial order currency and total instead of creating a second amount truth'
);

select extensions.ok(
  (select count(*)=2
          and sum(percentage)=100
          and sum(amount_due)=1050
   from public.sellertray_commercial_installment_schedule s
   where s.installment_obligation_id=(select installment_obligation_id from sellertray_commercial_fixture)),
  '70:30 schedule foundation reconciles to 100 percent and the full payment obligation'
);

select extensions.ok(
  not exists (
    select 1
    from public.sellertray_commercial_installment_schedule s
    where s.installment_obligation_id=(select installment_obligation_id from sellertray_commercial_fixture)
      and s.due_at is not null
  ),
  'C1 installment schedules do not invent unapproved installment due dates'
);

do $$
begin
  begin
    insert into public.sellertray_commercial_installment_schedule(
      tenant_id,installment_obligation_id,sequence_no,percentage,amount_due,due_at
    )
    select tenant_id,installment_obligation_id,3,1,1,null
    from sellertray_commercial_fixture;
  exception when sqlstate '23514' then
    update sellertray_commercial_fixture set invalid_schedule_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select invalid_schedule_rejected from sellertray_commercial_fixture),
  'installment schedules reject amount or percentage drift from the approved structure'
);

update sellertray_commercial_fixture f
set first_event_id=public.append_sellertray_commercial_entitlement_event(
  f.tenant_id,
  'business',
  f.commercial_order_id,
  f.installment_obligation_id,
  'foundation_test',
  'c1-entitlement-retry',
  '2026-03-01T00:00:00Z',
  '2026-05-01T00:00:00Z',
  jsonb_build_object('scope','C1 foundation only'),
  f.admin_user_id,
  'C1 idempotency contract test'
);

update sellertray_commercial_fixture f
set repeated_event_id=public.append_sellertray_commercial_entitlement_event(
  f.tenant_id,
  'business',
  f.commercial_order_id,
  f.installment_obligation_id,
  'foundation_test',
  'c1-entitlement-retry',
  '2026-03-01T00:00:00Z',
  '2026-05-01T00:00:00Z',
  jsonb_build_object('scope','C1 foundation only'),
  f.admin_user_id,
  'C1 idempotency contract test'
);

select extensions.is(
  (select repeated_event_id from sellertray_commercial_fixture),
  (select first_event_id from sellertray_commercial_fixture),
  'replaying the same entitlement event idempotency key returns the original event'
);

select extensions.is(
  (select count(*)::integer
   from public.sellertray_commercial_entitlement_events e
   where e.tenant_id=(select tenant_id from sellertray_commercial_fixture)
     and e.idempotency_key='c1-entitlement-retry'),
  1,
  'idempotent entitlement replay does not duplicate history'
);

do $$
begin
  begin
    perform public.append_sellertray_commercial_entitlement_event(
      f.tenant_id,
      'business',
      f.commercial_order_id,
      f.installment_obligation_id,
      'foundation_test',
      'c1-entitlement-retry',
      '2026-03-01T00:00:00Z',
      '2026-05-01T00:00:00Z',
      jsonb_build_object('scope','different facts'),
      f.admin_user_id,
      'C1 idempotency contract test'
    )
    from sellertray_commercial_fixture f;
  exception when sqlstate '23505' then
    update sellertray_commercial_fixture set conflicting_event_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select conflicting_event_rejected from sellertray_commercial_fixture),
  'reusing an entitlement idempotency key for different facts fails closed'
);

do $$
begin
  begin
    update public.sellertray_commercial_entitlement_events
    set payload=payload
    where id=(select first_event_id from sellertray_commercial_fixture);
  exception when sqlstate '55000' then
    update sellertray_commercial_fixture set immutable_event_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select immutable_event_rejected from sellertray_commercial_fixture),
  'entitlement event history is append-only'
);

select extensions.is(
  (select status from public.tenant_subscriptions
   where tenant_id=(select tenant_id from sellertray_commercial_fixture)),
  'trial'::text,
  'recording a C1 entitlement event does not activate or mutate the legacy runtime subscription'
);

select extensions.ok(
  position(
    'tenant_subscriptions'
    in pg_get_functiondef(
      'public.append_sellertray_commercial_entitlement_event(uuid,text,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,uuid,text)'::regprocedure
    )
  )=0,
  'C1 entitlement event append authority has no hidden legacy subscription mutation path'
);

do $$
begin
  begin
    perform public.append_sellertray_commercial_entitlement_event(
      f.other_tenant_id,
      'business',
      f.commercial_order_id,
      f.installment_obligation_id,
      'foundation_test',
      'c1-cross-tenant-event',
      '2026-03-01T00:00:00Z',
      null,
      '{}'::jsonb,
      f.admin_user_id,
      'Cross-tenant rejection test'
    )
    from sellertray_commercial_fixture f;
  exception when sqlstate '23503' then
    update sellertray_commercial_fixture set cross_tenant_event_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cross_tenant_event_rejected from sellertray_commercial_fixture),
  'entitlement events cannot attach another tenant commercial order or installment obligation'
);

select * from extensions.finish();
rollback;
