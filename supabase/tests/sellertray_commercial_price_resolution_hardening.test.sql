begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

create temp table sellertray_commercial_price_hardening_fixture (
  admin_user_id uuid not null,
  tenant_id uuid not null,
  monthly_old_price_id uuid,
  yearly_old_price_id uuid,
  monthly_new_price_id uuid,
  yearly_new_price_id uuid,
  commercial_order_id uuid,
  null_cycle_rejected boolean not null default false,
  superseded_snapshot_rejected boolean not null default false
) on commit drop;

insert into sellertray_commercial_price_hardening_fixture(admin_user_id,tenant_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,
       'commercial-price-hardening-'||substr(admin_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from sellertray_commercial_price_hardening_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,
       'C1 Commercial Price Hardening',
       'c1-commercial-price-'||substr(tenant_id::text,1,8),
       'C1H',
       'trial'
from sellertray_commercial_price_hardening_fixture;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',100,
         '2026-01-01T00:00:00Z','Initial monthly price',admin_user_id,admin_user_id,now()
  from sellertray_commercial_price_hardening_fixture
  returning id
)
update sellertray_commercial_price_hardening_fixture
set monthly_old_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',1000,
         '2026-01-01T00:00:00Z','Initial yearly 10-for-12 price',admin_user_id,admin_user_id,now()
  from sellertray_commercial_price_hardening_fixture
  returning id
)
update sellertray_commercial_price_hardening_fixture
set yearly_old_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',120,
         '2026-06-01T00:00:00Z','Replacement monthly price',admin_user_id,admin_user_id,now()
  from sellertray_commercial_price_hardening_fixture
  returning id
)
update sellertray_commercial_price_hardening_fixture
set monthly_new_price_id=(select id from inserted);

do $$
begin
  begin
    insert into public.sellertray_commercial_price_versions(
      price_kind,plan_code,billing_cycle,currency,gross_amount,
      effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
    )
    select 'subscription','business',null,'NGN',120,
           '2026-07-01T00:00:00Z','Invalid missing billing cycle',admin_user_id,admin_user_id,now()
    from sellertray_commercial_price_hardening_fixture;
  exception when sqlstate '23514' then
    update sellertray_commercial_price_hardening_fixture
    set null_cycle_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select null_cycle_rejected from sellertray_commercial_price_hardening_fixture),
  'subscription commercial prices reject a null billing cycle explicitly'
);

select extensions.is(
  public.resolve_sellertray_commercial_price_version(
    'subscription','business','monthly','NGN','2026-07-01T00:00:00Z'
  ),
  (select monthly_new_price_id from sellertray_commercial_price_hardening_fixture),
  'monthly price resolution selects the newest effective version'
);

select extensions.is(
  public.resolve_sellertray_commercial_price_version(
    'subscription','business','yearly','NGN','2026-07-01T00:00:00Z'
  ),
  null::uuid,
  'yearly price resolution fails closed when the effective monthly price changed without a matching 10-for-12 yearly version'
);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',1200,
         '2026-06-01T00:00:00Z','Replacement yearly 10-for-12 price',admin_user_id,admin_user_id,now()
  from sellertray_commercial_price_hardening_fixture
  returning id
)
update sellertray_commercial_price_hardening_fixture
set yearly_new_price_id=(select id from inserted);

select extensions.is(
  public.resolve_sellertray_commercial_price_version(
    'subscription','business','yearly','NGN','2026-07-01T00:00:00Z'
  ),
  (select yearly_new_price_id from sellertray_commercial_price_hardening_fixture),
  'yearly price resolution resumes only after a matching governed 10-for-12 version is published'
);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,
         'C1H-'||upper(substr(tenant_id::text,1,8)),
         'NGN',1200,'2026-07-01T00:00:00Z',admin_user_id
  from sellertray_commercial_price_hardening_fixture
  returning id
)
update sellertray_commercial_price_hardening_fixture
set commercial_order_id=(select id from inserted);

do $$
begin
  begin
    insert into public.sellertray_commercial_order_price_snapshots(
      tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
    )
    select tenant_id,commercial_order_id,1,'subscription',yearly_old_price_id,'Superseded annual price'
    from sellertray_commercial_price_hardening_fixture;
  exception when sqlstate '23514' then
    update sellertray_commercial_price_hardening_fixture
    set superseded_snapshot_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select superseded_snapshot_rejected from sellertray_commercial_price_hardening_fixture),
  'commercial orders reject a superseded price version even when its historical row remains open-ended'
);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select tenant_id,commercial_order_id,1,'subscription',yearly_new_price_id,'Current annual price'
from sellertray_commercial_price_hardening_fixture;

set constraints all immediate;

select extensions.ok(
  exists (
    select 1
    from public.sellertray_commercial_order_price_snapshots s
    join sellertray_commercial_price_hardening_fixture f
      on f.commercial_order_id=s.commercial_order_id
    where s.line_no=1
      and s.source_price_version_id=f.yearly_new_price_id
      and s.billing_cycle='yearly'
      and s.gross_amount=1200
  ),
  'commercial orders snapshot the governed price version resolved for the order timestamp'
);

select * from extensions.finish();
rollback;
