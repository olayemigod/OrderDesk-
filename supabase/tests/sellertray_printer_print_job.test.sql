begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(31);

create temp table sellertray_printer_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  product_id uuid not null,
  branch_id uuid,
  branch_two_id uuid,
  register_id uuid,
  register_two_id uuid,
  location_id uuid,
  stock_uom_id uuid,
  printer_id uuid,
  printer_two_id uuid,
  order_id uuid,
  receipt_id uuid,
  test_job_id uuid,
  receipt_job_id uuid,
  reprint_job_id uuid,
  printer_result jsonb,
  test_result jsonb,
  receipt_result jsonb,
  replay_result jsonb,
  staff_manage_rejected boolean not null default false,
  cross_branch_rejected boolean not null default false,
  conflict_rejected boolean not null default false,
  terminal_update_rejected boolean not null default false,
  job_delete_rejected boolean not null default false,
  printer_delete_rejected boolean not null default false,
  inactive_rejected boolean not null default false
) on commit drop;

insert into sellertray_printer_fixture(
  tenant_id,owner_user_id,manager_user_id,staff_user_id,product_id
)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,'printer-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_printer_fixture
union all
select manager_user_id,'printer-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_printer_fixture
union all
select staff_user_id,'printer-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_printer_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status,business_email,business_phone)
select tenant_id,'SellerTray Printer Test','sellertray-printer-'||substr(tenant_id::text,1,8),'PRT','active','printer@example.com','08000000000'
from sellertray_printer_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_printer_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_printer_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_printer_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_printer_fixture;

update sellertray_printer_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

insert into public.branches(tenant_id,code,name,is_default,is_active)
select tenant_id,'PRINT2','Printer Branch Two',false,true
from sellertray_printer_fixture;

update sellertray_printer_fixture f
set branch_two_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.code='PRINT2';

insert into public.branch_user_access(tenant_id,branch_id,user_id,can_operate)
select tenant_id,branch_id,staff_user_id,true
from sellertray_printer_fixture;

update sellertray_printer_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_id and r.is_default=true;

update sellertray_printer_fixture f
set register_two_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id and r.branch_id=f.branch_two_id and r.is_default=true;

update sellertray_printer_fixture f
set location_id=sl.id
from public.stock_locations sl
where sl.tenant_id=f.tenant_id and sl.branch_id=f.branch_id and sl.is_default=true;

insert into public.catalog_items(
  id,tenant_id,name,sku,price_ngn,is_active,stock_uom,allow_fractional_stock
)
select product_id,tenant_id,'Printer Test Product','PRINT-PRODUCT',150,true,'Each',false
from sellertray_printer_fixture;

update sellertray_printer_fixture f
set stock_uom_id=u.id
from public.catalog_item_uoms u
where u.tenant_id=f.tenant_id and u.catalog_item_id=f.product_id and lower(u.uom_name)='each';

select public.record_sellertray_inventory_movement(
  tenant_id,branch_id,location_id,product_id,
  'opening',20,'Each',20,1,
  'opening_stock','PRINT-OPENING','print:opening',
  now(),owner_user_id,'Opening stock for printer test','{}'::jsonb,null
)
from sellertray_printer_fixture;

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_printer_fixture),
    (select staff_user_id from sellertray_printer_fixture),
    'can_print_receipt'
  ),
  'Staff can print receipts by role default'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_printer_fixture),
    (select staff_user_id from sellertray_printer_fixture),
    'can_manage_devices'
  ),
  'Staff cannot manage printer configuration by role alone'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_printer_fixture),
    (select manager_user_id from sellertray_printer_fixture),
    'can_manage_devices'
  ),
  'Manager can manage printers by role default'
);

update sellertray_printer_fixture
set printer_result=public.save_sellertray_printer(
  tenant_id,null,branch_id,register_id,'Counter Printer','BT-AA-BB-CC-01',58,true,true,owner_user_id
);
update sellertray_printer_fixture
set printer_id=(printer_result->>'printerId')::uuid;

select extensions.is(
  (select (printer_result->>'paperWidthMm')::integer from sellertray_printer_fixture),
  58,'printer stores the configured 58 mm paper width'
);

select extensions.is(
  (select printer_result->>'isDefault' from sellertray_printer_fixture),
  'true','printer can be configured as the register default'
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_printer_events e
    where e.printer_id=(select printer_id from sellertray_printer_fixture)
      and e.event_type='registered'
  ),
  'printer registration creates immutable configuration evidence'
);

update sellertray_printer_fixture
set printer_result=public.save_sellertray_printer(
  tenant_id,null,branch_two_id,register_two_id,'Branch Two Printer','BT-AA-BB-CC-02',80,true,true,manager_user_id
);
update sellertray_printer_fixture
set printer_two_id=(printer_result->>'printerId')::uuid;

select extensions.is(
  (select (printer_result->>'paperWidthMm')::integer from sellertray_printer_fixture),
  80,'printer supports configured 80 mm paper width'
);

do $$
begin
  begin
    perform public.save_sellertray_printer(
      (select tenant_id from sellertray_printer_fixture),
      null,
      (select branch_id from sellertray_printer_fixture),
      (select register_id from sellertray_printer_fixture),
      'Unauthorized Printer','BT-AA-BB-CC-03',58,false,true,
      (select staff_user_id from sellertray_printer_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_printer_fixture set staff_manage_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select staff_manage_rejected from sellertray_printer_fixture),
  'Staff cannot register or change printers without device-management authority'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_printer_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.is(
  (
    select count(*)::integer
    from public.get_sellertray_printers(
      (select tenant_id from sellertray_printer_fixture),
      (select branch_id from sellertray_printer_fixture),
      (select register_id from sellertray_printer_fixture)
    )
  ),
  1,'Staff can read active printers only in the assigned branch'
);

do $$
begin
  begin
    perform * from public.get_sellertray_printers(
      (select tenant_id from sellertray_printer_fixture),
      (select branch_two_id from sellertray_printer_fixture),
      (select register_two_id from sellertray_printer_fixture)
    );
  exception when sqlstate '42501' then
    update sellertray_printer_fixture set cross_branch_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select cross_branch_rejected from sellertray_printer_fixture),
  'printer access never bypasses Staff branch isolation'
);

update sellertray_printer_fixture
set test_result=public.request_sellertray_print_job(
  tenant_id,printer_id,'test',null,'TEST-PRINT-001',staff_user_id
);
update sellertray_printer_fixture
set test_job_id=(test_result->>'jobId')::uuid;

select extensions.is(
  (select test_result->>'jobType' from sellertray_printer_fixture),
  'test','printer test creates a non-commercial print job'
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_print_jobs j
    where j.id=(select test_job_id from sellertray_printer_fixture)
      and j.order_id is null
      and j.financial_document_id is null
      and j.content_snapshot->>'documentType'='test'
  ),
  'test print contains no order or financial-document reference'
);

update sellertray_printer_fixture
set replay_result=public.request_sellertray_print_job(
  tenant_id,printer_id,'test',null,'TEST-PRINT-001',staff_user_id
);

select extensions.is(
  (select replay_result->>'idempotentReplay' from sellertray_printer_fixture),
  'true','same print request key retries idempotently'
);

select extensions.is(
  (
    select count(*)::integer from public.sellertray_print_jobs j
    where j.tenant_id=(select tenant_id from sellertray_printer_fixture)
      and j.request_key='TEST-PRINT-001'
  ),
  1,'print request retry does not duplicate the print attempt'
);

do $$
begin
  begin
    perform public.request_sellertray_print_job(
      (select tenant_id from sellertray_printer_fixture),
      (select printer_id from sellertray_printer_fixture),
      'receipt',
      gen_random_uuid(),
      'TEST-PRINT-001',
      (select staff_user_id from sellertray_printer_fixture)
    );
  exception when sqlstate '23505' then
    update sellertray_printer_fixture set conflict_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select conflict_rejected from sellertray_printer_fixture),
  'request key cannot be reused for different print facts'
);

update sellertray_printer_fixture
set order_id=public.create_sellertray_pos_order_atomic(
  tenant_id,branch_id,null,null,'Printer receipt sale',
  jsonb_build_array(jsonb_build_object(
    'catalog_item_id',product_id,'uom_id',stock_uom_id,'quantity',2
  ))
);

set local request.jwt.claim.role='service_role';
select public.complete_sellertray_pos_cash_sale(tenant_id,order_id,owner_user_id)
from sellertray_printer_fixture;

update sellertray_printer_fixture f
set receipt_id=d.id
from public.order_financial_documents d
where d.tenant_id=f.tenant_id and d.order_id=f.order_id and d.document_type='receipt';

select extensions.is(
  (
    select count(*)::integer from public.order_financial_documents d
    where d.order_id=(select order_id from sellertray_printer_fixture)
      and d.document_type='receipt' and d.status='issued'
  ),
  1,'completed sale has one existing issued payment receipt'
);

update sellertray_printer_fixture
set receipt_result=public.request_sellertray_print_job(
  tenant_id,printer_id,'receipt',order_id,'RECEIPT-PRINT-001',staff_user_id
);
update sellertray_printer_fixture
set receipt_job_id=(receipt_result->>'jobId')::uuid;

select extensions.is(
  (select receipt_result->>'jobType' from sellertray_printer_fixture),
  'receipt','receipt print creates an operational print attempt'
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_print_jobs j
    where j.id=(select receipt_job_id from sellertray_printer_fixture)
      and j.order_id=(select order_id from sellertray_printer_fixture)
      and j.financial_document_id=(select receipt_id from sellertray_printer_fixture)
  ),
  'receipt print links to the existing issued receipt rather than creating another document'
);

select extensions.ok(
  (
    select j.content_snapshot->>'receiptReference'=d.document_reference
      and (j.content_snapshot->>'amountPaid')::numeric=d.amount
      and jsonb_array_length(j.content_snapshot->'items')=1
      and j.content_snapshot->'items'->0->>'uom'='Each'
    from public.sellertray_print_jobs j
    join public.order_financial_documents d on d.id=j.financial_document_id
    where j.id=(select receipt_job_id from sellertray_printer_fixture)
  ),
  'receipt print freezes receipt, amount and UOM-aware item facts for hardware output'
);

select extensions.is(
  (
    select o.status from public.orders o
    where o.id=(select order_id from sellertray_printer_fixture)
  ),
  'completed','requesting a print does not mutate the completed sale'
);

select extensions.is(
  (
    select o.amount_paid from public.orders o
    where o.id=(select order_id from sellertray_printer_fixture)
  ),
  300::numeric,'requesting a print does not alter payment truth'
);

select extensions.is(
  (
    select s.quantity_on_hand
    from public.get_sellertray_branch_stock(
      (select tenant_id from sellertray_printer_fixture),
      (select branch_id from sellertray_printer_fixture)
    ) s
    where s.catalog_item_id=(select product_id from sellertray_printer_fixture)
  ),
  18::numeric,'requesting a print has no inventory effect'
);

select extensions.is(
  (
    select public.transition_sellertray_print_job(
      tenant_id,receipt_job_id,'printing',null,null,staff_user_id
    )->>'status'
    from sellertray_printer_fixture
  ),
  'printing','print attempt records hardware start separately from the sale'
);

select extensions.is(
  (
    select public.transition_sellertray_print_job(
      tenant_id,receipt_job_id,'printed',null,null,staff_user_id
    )->>'status'
    from sellertray_printer_fixture
  ),
  'printed','print attempt records successful hardware completion'
);

do $$
begin
  begin
    update public.sellertray_print_jobs
    set content_snapshot=jsonb_build_object('tampered',true)
    where id=(select receipt_job_id from sellertray_printer_fixture);
  exception when sqlstate '55000' then
    update sellertray_printer_fixture set terminal_update_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select terminal_update_rejected from sellertray_printer_fixture),
  'printed job source snapshot is immutable'
);

do $$
begin
  begin
    delete from public.sellertray_print_jobs
    where id=(select receipt_job_id from sellertray_printer_fixture);
  exception when sqlstate '55000' then
    update sellertray_printer_fixture set job_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select job_delete_rejected from sellertray_printer_fixture),
  'print attempt history cannot be deleted while the business exists'
);

update sellertray_printer_fixture
set receipt_result=public.request_sellertray_print_job(
  tenant_id,printer_id,'receipt',order_id,'RECEIPT-PRINT-002',staff_user_id
);
update sellertray_printer_fixture
set reprint_job_id=(receipt_result->>'jobId')::uuid;

select extensions.ok(
  (select reprint_job_id<>receipt_job_id from sellertray_printer_fixture),
  'reprint is a new print attempt rather than a new sale'
);

select extensions.is(
  (
    select count(*)::integer from public.order_financial_documents d
    where d.order_id=(select order_id from sellertray_printer_fixture)
      and d.document_type='receipt'
  ),
  1,'reprint does not create a second financial receipt'
);

select extensions.is(
  (
    select count(*)::integer from public.order_payments p
    where p.order_id=(select order_id from sellertray_printer_fixture)
      and p.status='confirmed'
  ),
  1,'reprint does not create a second payment'
);

do $$
begin
  begin
    delete from public.sellertray_printers
    where id=(select printer_id from sellertray_printer_fixture);
  exception when sqlstate '55000' then
    update sellertray_printer_fixture set printer_delete_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select printer_delete_rejected from sellertray_printer_fixture),
  'printer history is deactivated rather than deleted'
);

select public.save_sellertray_printer(
  tenant_id,printer_id,branch_id,register_id,'Counter Printer','BT-AA-BB-CC-01',58,false,false,owner_user_id
)
from sellertray_printer_fixture;

do $$
begin
  begin
    perform public.request_sellertray_print_job(
      (select tenant_id from sellertray_printer_fixture),
      (select printer_id from sellertray_printer_fixture),
      'receipt',
      (select order_id from sellertray_printer_fixture),
      'RECEIPT-INACTIVE',
      (select staff_user_id from sellertray_printer_fixture)
    );
  exception when sqlstate '23514' then
    update sellertray_printer_fixture set inactive_rejected=true;
  end;
end
$$;

select extensions.ok(
  (select inactive_rejected from sellertray_printer_fixture),
  'inactive printer cannot accept new print attempts'
);

select set_config('request.jwt.claim.sub',(select staff_user_id::text from sellertray_printer_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
select extensions.is(
  (
    select count(*)::integer
    from public.get_sellertray_printers(
      (select tenant_id from sellertray_printer_fixture),
      (select branch_id from sellertray_printer_fixture),
      (select register_id from sellertray_printer_fixture)
    )
  ),
  0,'Staff printer read hides inactive devices'
);

select set_config('request.jwt.claim.sub',(select manager_user_id::text from sellertray_printer_fixture),true);
select extensions.is(
  (
    select count(*)::integer
    from public.get_sellertray_printers(
      (select tenant_id from sellertray_printer_fixture),
      (select branch_id from sellertray_printer_fixture),
      (select register_id from sellertray_printer_fixture)
    )
  ),
  1,'Manager device view retains inactive printer configuration'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated','public.save_sellertray_printer(uuid,uuid,uuid,uuid,text,text,integer,boolean,boolean,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.request_sellertray_print_job(uuid,uuid,text,uuid,text,uuid)','EXECUTE'
  )
  and not has_function_privilege(
    'authenticated','public.transition_sellertray_print_job(uuid,uuid,text,text,text,uuid)','EXECUTE'
  ),
  'printer configuration and print-job mutations remain server-only'
);

select * from extensions.finish();
rollback;