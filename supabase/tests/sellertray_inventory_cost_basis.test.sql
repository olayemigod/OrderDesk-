begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  to_regclass('public.sellertray_inventory_cost_basis_evidence') is not null,
  'historical inventory cost-basis evidence table exists'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_inventory_cost_basis_evidence','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_inventory_cost_basis_evidence','INSERT')
  and not has_table_privilege('authenticated','public.sellertray_inventory_cost_basis_evidence','UPDATE')
  and not has_table_privilege('authenticated','public.sellertray_inventory_cost_basis_evidence','DELETE'),
  'authenticated clients cannot bypass governed cost-basis commands'
);

select extensions.ok(
  to_regprocedure('public.get_sellertray_inventory_valuation_authority(uuid,uuid)') is not null
  and to_regprocedure('public.get_sellertray_inventory_cost_basis_candidates(uuid,uuid,integer)') is not null
  and to_regprocedure('public.record_sellertray_inventory_cost_basis(uuid,uuid,numeric,text,text,uuid,uuid)') is not null,
  'governed cost-basis authority, candidate and mutation RPCs exist'
);

select extensions.ok(
  has_function_privilege('authenticated','public.get_sellertray_inventory_valuation_authority(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_sellertray_inventory_cost_basis_candidates(uuid,uuid,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.record_sellertray_inventory_cost_basis(uuid,uuid,numeric,text,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.record_sellertray_inventory_cost_basis(uuid,uuid,numeric,text,text,uuid,uuid)','EXECUTE'),
  'signed-in management can use governed cost-basis RPCs while anonymous callers cannot'
);

select extensions.ok(
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='record_sellertray_inventory_cost_basis'
      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_read_branch%'
      and lower(pg_get_functiondef(p.oid)) like '%can_adjust_stock%'
      and lower(pg_get_functiondef(p.oid)) like '%can_manage_purchasing%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'
      and lower(pg_get_functiondef(p.oid)) like '%governed purchase receiving already owns this receipt cost basis%'
  ),
  'cost-basis mutation enforces Branch, management, subscription and Purchase Receiving authority'
);

select extensions.ok(
  lower(pg_get_functiondef('public.rebuild_sellertray_inventory_valuation(uuid,uuid)'::regprocedure)) like '%historical_cost_basis%'
  and lower(pg_get_functiondef('public.rebuild_sellertray_inventory_valuation(uuid,uuid)'::regprocedure)) like '%sellertray_current_inventory_cost_basis%',
  'moving-average replay consumes governed historical cost evidence instead of creating parallel valuation truth'
);

create temp table sellertray_cost_basis_fixture(
  tenant_id uuid not null,
  user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  opening_id uuid,
  sale_id uuid,
  evidence1_id uuid,
  evidence1_retry_id uuid,
  evidence2_id uuid,
  command1_id uuid not null,
  command2_id uuid not null,
  mutation_rejected boolean not null default false,
  invalid_source_rejected boolean not null default false,
  reused_command_rejected boolean not null default false
) on commit drop;

insert into sellertray_cost_basis_fixture(tenant_id,user_id,product_id,command1_id,command2_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,aud,role,email,created_at,updated_at)
select user_id,'authenticated','authenticated','cost-basis-'||substr(user_id::text,1,8)||'@example.test',now(),now()
from sellertray_cost_basis_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Cost Basis Test','sellertray-cost-basis-'||substr(tenant_id::text,1,8),'CST','active'
from sellertray_cost_basis_fixture;

update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_cost_basis_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,user_id,'owner' from sellertray_cost_basis_fixture;

update sellertray_cost_basis_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;
update sellertray_cost_basis_fixture f set location_id=sl.id
from public.stock_locations sl where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Historical Cost Product','COST-BASIS',150,true,'Each',false
from sellertray_cost_basis_fixture;

update sellertray_cost_basis_fixture set opening_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'opening',10,'Each',10,1,
  'opening_stock','COST-OPEN-001','cost-basis:opening:1','2026-10-17 08:00:00+00'::timestamptz,
  user_id,'Verified opening stock','{}'::jsonb,null
);

update sellertray_cost_basis_fixture set sale_id=public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,'sale',-4,'Each',4,1,
  'order','COST-SALE-001','cost-basis:sale:1','2026-10-17 09:00:00+00'::timestamptz,
  user_id,null,jsonb_build_object('order_id','00000000-0000-0000-0000-000000000201','order_item_id','00000000-0000-0000-0000-000000000202'),null
);

select extensions.ok(
  exists(select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select sale_id from sellertray_cost_basis_fixture)
      and ve.cogs_amount=0 and ve.cogs_complete=false),
  'sale remains explicitly incomplete before historical cost evidence exists'
);

select set_config('request.jwt.claim.sub',(select user_id::text from sellertray_cost_basis_fixture),true);

update sellertray_cost_basis_fixture
set evidence1_id=public.record_sellertray_inventory_cost_basis(
  tenant_id,opening_id,50,'OPENING-INVOICE-001','Verified opening inventory invoice',command1_id,null
);

select extensions.ok(
  exists(select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select opening_id from sellertray_cost_basis_fixture)
      and ve.valuation_source='historical_cost_basis'
      and ve.value_delta=500
      and ve.known_unit_cost=50)
  and exists(select 1 from public.sellertray_inventory_valuation_entries ve
    where ve.movement_id=(select sale_id from sellertray_cost_basis_fixture)
      and ve.cogs_amount=200 and ve.cogs_complete=true),
  'historical evidence values the original inbound and deterministically repairs downstream sale COGS'
);

update sellertray_cost_basis_fixture
set evidence1_retry_id=public.record_sellertray_inventory_cost_basis(
  tenant_id,opening_id,50,'OPENING-INVOICE-001','Verified opening inventory invoice',command1_id,null
);

select extensions.ok(
  (select evidence1_retry_id=evidence1_id from sellertray_cost_basis_fixture)
  and (select count(*)=1 from public.sellertray_inventory_cost_basis_evidence e
       where e.tenant_id=(select tenant_id from sellertray_cost_basis_fixture)
         and e.command_id=(select command1_id from sellertray_cost_basis_fixture)),
  'retrying the same cost-basis command is idempotent'
);

do $$
begin
  begin
    perform public.record_sellertray_inventory_cost_basis(
      (select tenant_id from sellertray_cost_basis_fixture),
      (select opening_id from sellertray_cost_basis_fixture),
      51,'OPENING-INVOICE-001','Different command facts',
      (select command1_id from sellertray_cost_basis_fixture),null
    );
  exception when others then
    update sellertray_cost_basis_fixture set reused_command_rejected=true;
  end;
end
$$;
select extensions.ok(
  (select reused_command_rejected from sellertray_cost_basis_fixture),
  'reusing a command id for different cost facts is rejected'
);

update sellertray_cost_basis_fixture
set evidence2_id=public.record_sellertray_inventory_cost_basis(
  tenant_id,opening_id,60,'OPENING-INVOICE-001-CORR','Corrected historical invoice cost',command2_id,evidence1_id
);

select extensions.ok(
  exists(select 1 from public.sellertray_inventory_cost_basis_evidence e
    where e.id=(select evidence2_id from sellertray_cost_basis_fixture)
      and e.supersedes_evidence_id=(select evidence1_id from sellertray_cost_basis_fixture))
  and (select count(*)=2 from public.sellertray_inventory_cost_basis_evidence e
       where e.inventory_movement_id=(select opening_id from sellertray_cost_basis_fixture))
  and exists(select 1 from public.sellertray_inventory_valuation_entries ve
       where ve.movement_id=(select sale_id from sellertray_cost_basis_fixture)
         and ve.cogs_amount=240 and ve.cogs_complete=true),
  'cost correction appends audit evidence and replays historical COGS from the corrected basis'
);

do $$
begin
  begin
    update public.sellertray_inventory_cost_basis_evidence set reason='mutated'
    where id=(select evidence1_id from sellertray_cost_basis_fixture);
  exception when others then
    update sellertray_cost_basis_fixture set mutation_rejected=true;
  end;
end
$$;
select extensions.ok(
  (select mutation_rejected from sellertray_cost_basis_fixture),
  'posted historical cost evidence cannot be edited in place'
);

do $$
begin
  begin
    perform public.record_sellertray_inventory_cost_basis(
      (select tenant_id from sellertray_cost_basis_fixture),
      (select sale_id from sellertray_cost_basis_fixture),
      60,'INVALID-SOURCE','Sales cannot be assigned inbound cost evidence',gen_random_uuid(),null
    );
  exception when others then
    update sellertray_cost_basis_fixture set invalid_source_rejected=true;
  end;
end
$$;
select extensions.ok(
  (select invalid_source_rejected from sellertray_cost_basis_fixture),
  'sales, transfers, returns and other non-eligible sources cannot receive independent cost basis'
);

select extensions.ok(
  exists(select 1 from public.get_sellertray_inventory_cost_basis_candidates(
    (select tenant_id from sellertray_cost_basis_fixture),(select branch_id from sellertray_cost_basis_fixture),100
  ) c where c.movement_id=(select opening_id from sellertray_cost_basis_fixture)
    and c.current_evidence_id=(select evidence2_id from sellertray_cost_basis_fixture)
    and c.current_stock_unit_cost=60),
  'governed management candidates expose the current evidence head for correction without exposing the internal table'
);

select * from extensions.finish();
rollback;
