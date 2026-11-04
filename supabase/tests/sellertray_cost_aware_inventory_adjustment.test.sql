begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(19);

select extensions.ok(
 to_regprocedure('public.apply_sellertray_stock_adjustment_with_cost(uuid,uuid,uuid,uuid,numeric,text,text,text,text,uuid,numeric,text,text)') is not null,
 'Atomic adjustment RPC exists'
);
select extensions.ok(
 has_function_privilege('service_role','public.apply_sellertray_stock_adjustment_with_cost(uuid,uuid,uuid,uuid,numeric,text,text,text,text,uuid,numeric,text,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.apply_sellertray_stock_adjustment_with_cost(uuid,uuid,uuid,uuid,numeric,text,text,text,text,uuid,numeric,text,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.record_sellertray_inventory_cost_basis_for_actor(uuid,uuid,numeric,text,text,uuid,uuid,uuid)','EXECUTE'),
 'Only service authority can submit actor-attributed adjustments'
);

create temp table cost_adjust_fixture (
 tenant_id uuid not null,actor_id uuid not null,blocked_actor uuid not null,
 product_id uuid not null,branch_id uuid,uom_id uuid,
 movement jsonb,replay jsonb,unknown jsonb,reduction jsonb,
 conflicting boolean default false,blocked boolean default false,
 bad_decrease boolean default false,rolled_back boolean default false,
 bad_branch boolean default false
) on commit drop;
insert into cost_adjust_fixture(tenant_id,actor_id,blocked_actor,product_id)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_id,'cost-aware-'||substr(actor_id::text,1,8)||'@example.test','authenticated','authenticated',now(),now() from cost_adjust_fixture;
insert into auth.users(id,email,aud,role,created_at,updated_at)
select blocked_actor,'cost-blocked-'||substr(blocked_actor::text,1,8)||'@example.test','authenticated','authenticated',now(),now() from cost_adjust_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Atomic Cost Adjustment','cost-aware-'||substr(tenant_id::text,1,8),'ACQ','active' from cost_adjust_fixture;
update public.tenant_subscriptions set status='active',trial_ends_at=null,grace_ends_at=null where tenant_id=(select tenant_id from cost_adjust_fixture);
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,actor_id,'owner' from cost_adjust_fixture;
update cost_adjust_fixture f set branch_id=b.id from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;
insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Atomic Cost QA Product','ATOMIC-COST-QA',200,true,'Each',false from cost_adjust_fixture;
update cost_adjust_fixture f set uom_id=u.id
from public.catalog_item_uoms u where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id and lower(u.uom_name)='each';

update cost_adjust_fixture f set movement=public.apply_sellertray_stock_adjustment_with_cost(
 f.tenant_id,f.branch_id,f.product_id,f.uom_id,5,'increase','COST-ADJ-001',
 'Data correction','cost-adjust-001',f.actor_id,20,'INVOICE-001','Documented cost for recovered inventory'
);
select extensions.is((select movement->>'costEvidenceStatus' from cost_adjust_fixture),'valued','Verified cost submitted with the adjustment');
select extensions.ok((select movement->>'costEvidenceId' is not null from cost_adjust_fixture),'Cost evidence identity returned');
select extensions.is(
 (select v.known_inventory_value from public.sellertray_inventory_valuation_state v join cost_adjust_fixture f on v.tenant_id=f.tenant_id and v.catalog_item_id=f.product_id),
 100::numeric,'Moving average uses the documented cost');
select extensions.is(
 (select v.quantity_on_hand from public.sellertray_inventory_valuation_state v join cost_adjust_fixture f on v.tenant_id=f.tenant_id and v.catalog_item_id=f.product_id),
 5::numeric,'Five Stock UOM quantity posted');
select extensions.is(
 (select count(*)::int from public.sellertray_inventory_cost_basis_evidence e join cost_adjust_fixture f on e.tenant_id=f.tenant_id),
 1,'Single immutable cost evidence');
select extensions.is(
 (select e.actor_user_id from public.sellertray_inventory_cost_basis_evidence e join cost_adjust_fixture f on e.id=(f.movement->>'costEvidenceId')::uuid),
 (select actor_id from cost_adjust_fixture),'Evidence records actual actor');

update cost_adjust_fixture f set replay=public.apply_sellertray_stock_adjustment_with_cost(
 f.tenant_id,f.branch_id,f.product_id,f.uom_id,5,'increase','COST-ADJ-001',
 'Data correction','cost-adjust-001',f.actor_id,20,'INVOICE-001','Documented cost for recovered inventory'
);
select extensions.ok(
 (select replay->>'idempotentReplay'='true' and replay->>'costEvidenceId'=movement->>'costEvidenceId' from cost_adjust_fixture),
 'Exact-command replay is safe for stock and cost');

do $$
declare f record;
begin
 select * into f from cost_adjust_fixture;
 begin
  perform public.apply_sellertray_stock_adjustment_with_cost(f.tenant_id,f.branch_id,f.product_id,f.uom_id,5,
  'increase','COST-ADJ-001','Data correction','cost-adjust-001',f.actor_id,21,'INVOICE-001','Altered evidence');
 exception when others then update cost_adjust_fixture set conflicting=true; end;
end $$;
select extensions.ok((select conflicting from cost_adjust_fixture),'Changed cost on identical command is rejected');

update cost_adjust_fixture f set unknown=public.apply_sellertray_stock_adjustment_with_cost(
 f.tenant_id,f.branch_id,f.product_id,f.uom_id,2,'increase','COST-ADJ-002',
 'Inventory recovery','cost-adjust-002',f.actor_id,null,null,null
);
select extensions.is((select unknown->>'costEvidenceStatus' from cost_adjust_fixture),'needs_evidence','Missing cost remains explicitly unvalued');
select extensions.is(
 (select v.unvalued_quantity_on_hand from public.sellertray_inventory_valuation_state v join cost_adjust_fixture f on v.tenant_id=f.tenant_id and v.catalog_item_id=f.product_id),
 2::numeric,'Unpriced positive quantity cannot inherit average cost');

update cost_adjust_fixture f set reduction=public.apply_sellertray_stock_adjustment_with_cost(
 f.tenant_id,f.branch_id,f.product_id,f.uom_id,1,'decrease','COST-ADJ-003',
 'Damage','cost-adjust-003',f.actor_id,null,null,null
);
select extensions.is((select reduction->>'costEvidenceStatus' from cost_adjust_fixture),'not_required','Reduction draws from existing cost layers');
select extensions.is(
 (select v.quantity_on_hand from public.sellertray_inventory_valuation_state v join cost_adjust_fixture f on v.tenant_id=f.tenant_id and v.catalog_item_id=f.product_id),
 6::numeric,'Ledger quantity: five plus two minus one');

do $$
declare f record;
begin
 select * into f from cost_adjust_fixture;
 begin
  perform public.apply_sellertray_stock_adjustment_with_cost(f.tenant_id,f.branch_id,f.product_id,f.uom_id,1,
  'increase','DENIED-COST','Data correction','cost-denied-001',f.blocked_actor,10,'FAKE-INV','Unapproved actor');
 exception when others then update cost_adjust_fixture set blocked=true; end;
 begin
  perform public.apply_sellertray_stock_adjustment_with_cost(f.tenant_id,f.branch_id,f.product_id,f.uom_id,1,
  'decrease','DENIED-REDUCTION','Data correction','cost-reduce-001',f.actor_id,10,'FAKE-INV','No new cost on reduction');
 exception when others then update cost_adjust_fixture set bad_decrease=true; end;
 begin
  perform public.apply_sellertray_stock_adjustment_with_cost(f.tenant_id,f.branch_id,f.product_id,f.uom_id,1,
  'increase','ROLLBACK-TEST','Data correction','cost-rollback-001',f.actor_id,10,repeat('x',161),'Too-long reference rejects after movement');
 exception when others then update cost_adjust_fixture set rolled_back=true; end;
 begin
  perform public.apply_sellertray_stock_adjustment_with_cost(f.tenant_id,gen_random_uuid(),f.product_id,f.uom_id,1,
  'increase','WRONG-BRANCH','Data correction','cost-wrong-branch-001',f.actor_id,null,null,null);
 exception when others then update cost_adjust_fixture set bad_branch=true; end;
end $$;
select extensions.ok((select blocked from cost_adjust_fixture),'Unauthorized actor cannot mint cost evidence');
select extensions.ok((select bad_decrease from cost_adjust_fixture),'No extra cost basis allowed on stock reductions');
select extensions.ok((select rolled_back from cost_adjust_fixture),'Cost rejection rolls back attempted stock movement');
select extensions.ok((select bad_branch from cost_adjust_fixture),'Branch isolation is preserved');
select extensions.is(
 (select count(*)::int from public.inventory_movements m join cost_adjust_fixture f on m.tenant_id=f.tenant_id and m.catalog_item_id=f.product_id),
 3,'Failures and retries add no extra stock movements');

select * from extensions.finish();
rollback;