begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

create temp table c1b_branch_setup_admin_fixture (
  admin_user_id uuid not null,
  tenant_id uuid not null,
  branch_id uuid,
  setup_price_id uuid,
  commercial_order_id uuid,
  readiness_id uuid
) on commit drop;

insert into c1b_branch_setup_admin_fixture(admin_user_id,tenant_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'c1b-branch-admin-'||substr(admin_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from c1b_branch_setup_admin_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from c1b_branch_setup_admin_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C1B Branch Setup Projection Tenant','c1b-branch-'||substr(tenant_id::text,1,8),'C1R','trial'
from c1b_branch_setup_admin_fixture;

update c1b_branch_setup_admin_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,currency,gross_amount,effective_from,change_reason,
    created_by_user_id,approved_by_user_id,approved_at
  )
  select 'branch_setup','NGN',200,now()-interval '1 day','C1B Branch setup projection fixture',
         admin_user_id,admin_user_id,now()
  from c1b_branch_setup_admin_fixture
  returning id
)
update c1b_branch_setup_admin_fixture set setup_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,'C1BR-'||upper(substr(tenant_id::text,1,8)),'NGN',200,now(),admin_user_id
  from c1b_branch_setup_admin_fixture
  returning id
)
update c1b_branch_setup_admin_fixture set commercial_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,branch_id,description_snapshot
)
select tenant_id,commercial_order_id,1,'branch_setup',setup_price_id,branch_id,'SellerTray Branch setup'
from c1b_branch_setup_admin_fixture;
set constraints all immediate;

update c1b_branch_setup_admin_fixture f
set readiness_id=public.mark_sellertray_commercial_branch_setup_ready(
  f.tenant_id,f.commercial_order_id,f.branch_id,gen_random_uuid(),
  jsonb_build_object('source','c1b_branch_setup_admin_test'),
  'Projection runtime fixture ready',now(),f.admin_user_id
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)') is not null,
  'C1B exact Branch setup Admin projection exists'
);

select extensions.ok(
  has_function_privilege(
    'service_role','public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'anon','public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)','EXECUTE'
  ),
  'C1B Branch setup projection remains service-authority only'
);

select extensions.ok(
  position('platform_admins' in pg_get_functiondef(
    'public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)'::regprocedure
  ))>0
  and position('line_type=''branch_setup''' in pg_get_functiondef(
    'public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)'::regprocedure
  ))>0,
  'C1B Branch setup projection checks platform role and reads governed setup purchase lines'
);

select extensions.ok(
  position('sellertray_commercial_branch_setup_readiness' in pg_get_functiondef(
    'public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)'::regprocedure
  ))>0
  and position('branchName' in pg_get_functiondef(
    'public.get_sellertray_commercial_branch_setup_states_for_admin(uuid,uuid)'::regprocedure
  ))>0,
  'C1B Branch setup projection binds readiness evidence to merchant-facing Branch identity'
);

select extensions.ok(
  exists (
    select 1
    from c1b_branch_setup_admin_fixture f
    cross join lateral jsonb_array_elements(
      public.get_sellertray_commercial_branch_setup_states_for_admin(f.tenant_id,f.admin_user_id)
    ) row_value
    where row_value->>'branchId'=f.branch_id::text
      and row_value->>'commercialOrderId'=f.commercial_order_id::text
      and row_value->>'readinessId'=f.readiness_id::text
      and row_value->>'recordedByUserId'=f.admin_user_id::text
      and row_value->>'ready'='true'
      and row_value->>'branchName' is not null
  ),
  'C1B Branch setup Admin projection executes against governed readiness and returns the recording administrator'
);

select * from extensions.finish();
rollback;
