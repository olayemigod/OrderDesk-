begin;

select plan(13);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
  ('72000000-0000-0000-0000-000000000001','authenticated','authenticated','catalogue-owner@example.com','',now(),now(),now()),
  ('72000000-0000-0000-0000-000000000002','authenticated','authenticated','catalogue-outsider@example.com','',now(),now(),now());

insert into public.tenants(id,name,slug,merchant_code,currency,subscription_status)
values
  ('72000000-0000-0000-0000-000000000010','Catalogue Master Test','catalogue-master-test','CM1','NGN','active'),
  ('72000000-0000-0000-0000-000000000020','Catalogue Other Test','catalogue-other-test','CM2','NGN','active');

-- Catalogue administration fixture represents an already active legacy Business.
update public.tenant_subscriptions set status='active'
where tenant_id in ('72000000-0000-0000-0000-000000000010','72000000-0000-0000-0000-000000000020');

insert into public.tenant_members(tenant_id,user_id,role)
values
  ('72000000-0000-0000-0000-000000000010','72000000-0000-0000-0000-000000000001','owner'),
  ('72000000-0000-0000-0000-000000000020','72000000-0000-0000-0000-000000000002','owner');

select set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

select lives_ok(
  $$ select public.save_sellertray_catalogue_master(
    '72000000-0000-0000-0000-000000000010','category',null,'Beverages',true
  ) $$,
  'owner can create a governed Product Category'
);

select lives_ok(
  $$ select public.save_sellertray_catalogue_master(
    '72000000-0000-0000-0000-000000000010','unit',null,'Carton',true
  ) $$,
  'owner can create a governed Business UOM'
);

select is(
  (select count(*)::integer from public.sellertray_catalogue_master_audit where tenant_id='72000000-0000-0000-0000-000000000010' and action='create'),
  2,
  'master creation writes immutable audit rows'
);

insert into public.catalog_items(id,tenant_id,name,sku,category,price_ngn,stock_uom,allow_fractional_stock,is_active)
values(
  '72000000-0000-0000-0000-000000000030',
  '72000000-0000-0000-0000-000000000010',
  'Cola','COLA-1','Beverages',500,'Each',true,true
);

select lives_ok(
  format(
    $$ select public.save_sellertray_catalogue_master(
      '72000000-0000-0000-0000-000000000010','category','%s','Drinks',true
    ) $$,
    (select id from public.catalogue_categories where tenant_id='72000000-0000-0000-0000-000000000010' and normalized_name='beverages')
  ),
  'referenced Category may be safely renamed'
);

select is(
  (select category from public.catalog_items where id='72000000-0000-0000-0000-000000000030'),
  'Drinks',
  'Category rename cascades current Product classification'
);

select throws_ok(
  format(
    $$ select public.save_sellertray_catalogue_master(
      '72000000-0000-0000-0000-000000000010','category','%s','Drinks',false
    ) $$,
    (select id from public.catalogue_categories where tenant_id='72000000-0000-0000-0000-000000000010' and normalized_name='drinks')
  ),
  '23514',
  'This catalogue master is still used by products and cannot be archived',
  'referenced Category cannot be archived'
);

select throws_ok(
  format(
    $$ select public.save_sellertray_catalogue_master(
      '72000000-0000-0000-0000-000000000010','unit','%s','Piece',true
    ) $$,
    (select id from public.business_uoms where tenant_id='72000000-0000-0000-0000-000000000010' and normalized_name='each')
  ),
  '23514',
  'The default Each unit is protected and cannot be renamed or archived',
  'default Each unit cannot be renamed'
);

select throws_ok(
  format(
    $$ select public.save_sellertray_catalogue_master(
      '72000000-0000-0000-0000-000000000010','unit','%s','Each',false
    ) $$,
    (select id from public.business_uoms where tenant_id='72000000-0000-0000-0000-000000000010' and normalized_name='each')
  ),
  '23514',
  'The default Each unit is protected and cannot be renamed or archived',
  'default Each unit cannot be archived'
);

select lives_ok(
  format(
    $$ select public.save_sellertray_catalogue_master(
      '72000000-0000-0000-0000-000000000010','unit','%s','Case',true
    ) $$,
    (select id from public.business_uoms where tenant_id='72000000-0000-0000-0000-000000000010' and normalized_name='carton')
  ),
  'unused Business UOM may be renamed'
);

select lives_ok(
  format(
    $$ select public.save_sellertray_catalogue_master(
      '72000000-0000-0000-0000-000000000010','unit','%s','Case',false
    ) $$,
    (select id from public.business_uoms where tenant_id='72000000-0000-0000-0000-000000000010' and normalized_name='case')
  ),
  'unused Business UOM may be archived'
);

select lives_ok(
  format(
    $$ select public.save_sellertray_catalogue_master(
      '72000000-0000-0000-0000-000000000010','unit','%s','Case',true
    ) $$,
    (select id from public.business_uoms where tenant_id='72000000-0000-0000-0000-000000000010' and normalized_name='case')
  ),
  'archived Business UOM may be restored'
);

select throws_ok(
  $$ select public.save_sellertray_catalogue_master(
    '72000000-0000-0000-0000-000000000020','category',null,'Forbidden',true
  ) $$,
  '42501',
  'You do not have permission to manage catalogue masters',
  'tenant isolation blocks managing another Business catalogue masters'
);

select is(
  (select count(*)::integer from public.sellertray_catalogue_master_audit where tenant_id='72000000-0000-0000-0000-000000000010' and action in ('rename','archive','restore')),
  4,
  'rename archive and restore operations remain audited'
);

select * from finish();
rollback;
