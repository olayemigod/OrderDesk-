-- Production regression: draft deletion must consult the real order financial
-- document table and never bypass permission, stock, or immutable-audit guards.
begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.has_table('public','order_financial_documents','Invoice and receipt history table exists');
select extensions.ok(
  pg_get_functiondef('public.delete_sellertray_pos_draft(uuid,uuid,uuid,text,text)'::regprocedure)
    like '%from public.order_financial_documents fd%',
  'Draft deletion checks the canonical financial documents relation'
);
select extensions.ok(
  pg_get_functiondef('public.delete_sellertray_pos_draft(uuid,uuid,uuid,text,text)'::regprocedure)
    not like '%from public.financial_documents fd%',
  'Draft deletion does not reference the nonexistent financial_documents table'
);
select extensions.ok(
  has_function_privilege('service_role','public.delete_sellertray_pos_draft(uuid,uuid,uuid,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.delete_sellertray_pos_draft(uuid,uuid,uuid,text,text)','EXECUTE'),
  'Deletion remains service-role-only; Edge checks Owner/Manager first'
);

create temp table sellertray_draft_delete_fixture (
  tenant_id uuid not null,
  actor_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  uom_id uuid,
  order_id uuid,
  protected_order_id uuid,
  deleted jsonb,
  replay jsonb,
  conflicting_replay_rejected boolean not null default false,
  foreign_actor_rejected boolean not null default false,
  invoice_guard_rejected boolean not null default false
) on commit drop;

insert into sellertray_draft_delete_fixture(tenant_id,actor_id,product_id)
values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_id,'pos-draft-delete-'||substr(actor_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_draft_delete_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Draft Deletion QA Merchant',
  'draft-deletion-'||substr(tenant_id::text,1,8),'DDF','active'
from sellertray_draft_delete_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_draft_delete_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,actor_id,'owner' from sellertray_draft_delete_fixture;

update sellertray_draft_delete_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.catalog_items(id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock)
select product_id,tenant_id,'Draft Test Item','DRAFT-DELETE-ITEM',100,true,'Piece',false
from sellertray_draft_delete_fixture;

with inserted_uom as (
  insert into public.catalog_item_uoms(tenant_id,catalog_item_id,uom_name,conversion_factor,selling_price,allow_fractional,is_default_selling)
  select tenant_id,product_id,'Pack',12,1000,false,false
  from sellertray_draft_delete_fixture
  returning id
)
update sellertray_draft_delete_fixture set uom_id=(select id from inserted_uom);

update sellertray_draft_delete_fixture f
set order_id=public.create_sellertray_pos_order_atomic(
  f.tenant_id,f.branch_id,null,null,'Disposable POS draft',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',f.product_id,'uom_id',f.uom_id,'quantity',1
  ))
);

update sellertray_draft_delete_fixture f
set protected_order_id=public.create_sellertray_pos_order_atomic(
  f.tenant_id,f.branch_id,null,null,'Invoice-protected POS draft',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',f.product_id,'uom_id',f.uom_id,'quantity',1
  ))
);

select extensions.ok(
  (select order_id is not null and protected_order_id is not null
          and order_id<>protected_order_id from sellertray_draft_delete_fixture),
  'Two independent POS drafts are created through the governed POS command'
);

update sellertray_draft_delete_fixture f
set deleted=public.delete_sellertray_pos_draft(
  f.tenant_id,f.order_id,f.actor_id,'Customer no longer wants this sale',
  'production-regression-delete-001'
);

select extensions.ok(
  (select deleted->>'deleted'='true' and deleted->>'idempotentReplay'='false'
    from sellertray_draft_delete_fixture),
  'Owner may delete an unpaid POS draft without existing payment, stock or documents'
);
select extensions.ok(
  exists(select 1 from public.orders o
     join sellertray_draft_delete_fixture f on o.id=f.order_id and o.tenant_id=f.tenant_id
     where o.deleted_at is not null and o.deleted_by_user_id=f.actor_id),
  'Successful deletion persists its actor and deletion timestamp'
);
select extensions.is(
  (select o.deletion_reason from public.orders o
     join sellertray_draft_delete_fixture f on o.id=f.order_id),
  'Customer no longer wants this sale',
  'Audit reason remains in the immutable draft tombstone'
);

update sellertray_draft_delete_fixture f
set replay=public.delete_sellertray_pos_draft(
  f.tenant_id,f.order_id,f.actor_id,'Customer no longer wants this sale',
  'production-regression-delete-001'
);

select extensions.ok(
  (select replay->>'deleted'='true' and replay->>'idempotentReplay'='true'
    from sellertray_draft_delete_fixture),
  'Exact command replay is accepted without a second deletion'
);

do $$
declare f record;
begin
  select * into f from sellertray_draft_delete_fixture;
  begin
    perform public.delete_sellertray_pos_draft(
      f.tenant_id,f.order_id,f.actor_id,'Changed reason','production-regression-delete-002');
  exception when sqlstate '23514' then
    update sellertray_draft_delete_fixture set conflicting_replay_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select conflicting_replay_rejected from sellertray_draft_delete_fixture),
  'A distinct command cannot overwrite an already-deleted draft'
);

do $$
declare f record;
begin
  select * into f from sellertray_draft_delete_fixture;
  begin
    perform public.delete_sellertray_pos_draft(
      f.tenant_id,f.protected_order_id,gen_random_uuid(),'Unauthorized access',
      'production-regression-deny-001');
  exception when sqlstate '42501' then
    update sellertray_draft_delete_fixture set foreign_actor_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select foreign_actor_rejected from sellertray_draft_delete_fixture),
  'Non-member cannot delete a draft from another branch/business scope'
);

insert into public.order_financial_documents(
  tenant_id,order_id,document_type,document_reference,currency,amount,status
)
select tenant_id,protected_order_id,'invoice',
  'QA-DRAFT-'||substr(protected_order_id::text,1,8),'NGN',1000,'issued'
from sellertray_draft_delete_fixture;

do $$
declare f record;
begin
  select * into f from sellertray_draft_delete_fixture;
  begin
    perform public.delete_sellertray_pos_draft(
      f.tenant_id,f.protected_order_id,f.actor_id,'Try to erase invoice',
      'production-regression-doc-001');
  exception when sqlstate '23514' then
    update sellertray_draft_delete_fixture set invoice_guard_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select invoice_guard_rejected from sellertray_draft_delete_fixture),
  'Invoice/receipt activity prevents draft deletion'
);
select extensions.ok(
  exists(select 1 from public.orders o join sellertray_draft_delete_fixture f
    on o.id=f.protected_order_id and o.tenant_id=f.tenant_id
    where o.deleted_at is null),
  'Failed document-protected deletion leaves original draft untouched'
);
select extensions.is(
  (select count(*)::int from public.inventory_movements im
    join sellertray_draft_delete_fixture f on im.tenant_id=f.tenant_id
    where im.reference_type='order' and im.reference_id=f.order_id::text),
  0,
  'Draft deletion does not post or reverse inventory movements'
);

select * from extensions.finish();
rollback;
