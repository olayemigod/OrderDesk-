begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

create temp table sellertray_offline_tax_fixture (
  tenant_id uuid not null,
  delete_tenant_id uuid not null,
  owner_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  location_id uuid,
  uom_id uuid,
  tax_configuration_id uuid,
  tax_revision bigint,
  queued_order_id uuid,
  stale_order_id uuid,
  stale_bind_rejected boolean not null default false,
  locked_post_rejected boolean not null default false,
  config_delete_rejected boolean not null default false
) on commit drop;

insert into sellertray_offline_tax_fixture(
  tenant_id,delete_tenant_id,owner_user_id,product_id
) values(
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'offline-tax-owner-'||substr(owner_user_id::text,1,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from sellertray_offline_tax_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Offline Tax Test','offline-tax-'||substr(tenant_id::text,1,8),'OTX','active'
from sellertray_offline_tax_fixture
union all
select delete_tenant_id,'Offline Tax Delete','offline-tax-delete-'||substr(delete_tenant_id::text,1,8),'OTD','active'
from sellertray_offline_tax_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_offline_tax_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_offline_tax_fixture;

update sellertray_offline_tax_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_offline_tax_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id
  and sl.branch_id=f.branch_id
  and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Offline Tax Product','OFF-TAX',100,true,'Each',false
from sellertray_offline_tax_fixture;

-- Catalogue governance provisions the default Each UOM for a new product.
-- Reuse that governed master instead of creating a duplicate fixture row.
update sellertray_offline_tax_fixture f
set uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id
  and u.catalog_item_id=f.product_id
  and lower(btrim(u.uom_name))='each'
  and u.is_default_selling=true;

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',20,'Each',20,1,
  'opening_stock','OFFLINE-TAX-OPENING','opening:OFFLINE-TAX-OPENING',
  now(),owner_user_id,'Offline tax replay fixture','{}'::jsonb,null
)
from sellertray_offline_tax_fixture;

select set_config('request.jwt.claim.sub',(select owner_user_id::text from sellertray_offline_tax_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select public.save_sellertray_tax_settings(
  (select tenant_id from sellertray_offline_tax_fixture),true,7.5,true
);

update sellertray_offline_tax_fixture f
set tax_configuration_id=c.id,
    tax_revision=c.revision
from public.sellertray_tax_configurations c
where c.tenant_id=f.tenant_id and c.revision=1;

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.bind_sellertray_offline_tax_context(uuid,uuid,uuid,uuid,bigint)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.bind_sellertray_offline_tax_context(uuid,uuid,uuid,uuid,bigint)',
    'EXECUTE'
  ),
  'offline tax context binding is a server-only authority'
);

update sellertray_offline_tax_fixture
set queued_order_id=public.create_sellertray_pos_order_idempotent(
  tenant_id,branch_id,owner_user_id,null,null,null,'Offline taxed cash sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',uom_id,
    'quantity',2,
    'expected_selling_price',100,
    'expected_conversion_factor',1
  )),
  gen_random_uuid()
);

select public.bind_sellertray_offline_tax_context(
  tenant_id,queued_order_id,owner_user_id,tax_configuration_id,tax_revision
)
from sellertray_offline_tax_fixture;

select extensions.ok(
  exists(
    select 1
    from public.orders o
    join sellertray_offline_tax_fixture f on f.tenant_id=o.tenant_id and f.queued_order_id=o.id
    where o.offline_tax_context_locked=true
      and o.offline_tax_configuration_id=f.tax_configuration_id
      and o.offline_tax_configuration_revision=f.tax_revision
  ),
  'queued POS sale locks the exact server-issued tax configuration identity'
);

select extensions.is(
  (select (public.bind_sellertray_offline_tax_context(
    tenant_id,queued_order_id,owner_user_id,tax_configuration_id,tax_revision
  )->>'locked')::boolean from sellertray_offline_tax_fixture),
  true,
  'binding the same offline tax context is idempotent'
);

update sellertray_offline_tax_fixture
set stale_order_id=public.create_sellertray_pos_order_idempotent(
  tenant_id,branch_id,owner_user_id,null,null,null,'Stale offline tax sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,
    'uom_id',uom_id,
    'quantity',1,
    'expected_selling_price',100,
    'expected_conversion_factor',1
  )),
  gen_random_uuid()
);

select public.save_sellertray_tax_settings(
  (select tenant_id from sellertray_offline_tax_fixture),true,10,true
);

do $$
begin
  begin
    perform public.bind_sellertray_offline_tax_context(
      tenant_id,stale_order_id,owner_user_id,tax_configuration_id,tax_revision
    )
    from sellertray_offline_tax_fixture;
  exception when sqlstate '23514' then
    update sellertray_offline_tax_fixture set stale_bind_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select stale_bind_rejected from sellertray_offline_tax_fixture),
  'offline replay fails to review when Business tax settings changed before binding'
);

do $$
begin
  begin
    update public.orders o
    set status='accepted',updated_at=now()
    from sellertray_offline_tax_fixture f
    where o.tenant_id=f.tenant_id and o.id=f.queued_order_id;
  exception when sqlstate '23514' then
    update sellertray_offline_tax_fixture set locked_post_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select locked_post_rejected from sellertray_offline_tax_fixture),
  'a previously locked offline sale cannot post after the tax revision changes'
);

select extensions.is(
  (select count(*)::integer
   from public.order_financial_documents d
   where d.order_id=(select queued_order_id from sellertray_offline_tax_fixture)
     and d.document_type='invoice'),
  0,
  'stale offline tax context creates no invoice or payable commercial effect'
);

do $$
begin
  begin
    delete from public.sellertray_tax_configurations
    where tenant_id=(select tenant_id from sellertray_offline_tax_fixture)
      and revision=1;
  exception when sqlstate '55000' then
    update sellertray_offline_tax_fixture set config_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select config_delete_rejected from sellertray_offline_tax_fixture),
  'tax configuration cannot be deleted while its Business still exists'
);

insert into public.sellertray_tax_configurations(
  tenant_id,revision,is_active,rate_percent,display_tax_breakdown
)
select delete_tenant_id,1,true,5,true
from sellertray_offline_tax_fixture;

delete from public.tenants
where id=(select delete_tenant_id from sellertray_offline_tax_fixture);

select extensions.is(
  (select count(*)::integer
   from public.sellertray_tax_configurations c
   where c.tenant_id=(select delete_tenant_id from sellertray_offline_tax_fixture)),
  0,
  'governed Business deletion cascades immutable tax configuration history'
);

select * from extensions.finish();
rollback;
