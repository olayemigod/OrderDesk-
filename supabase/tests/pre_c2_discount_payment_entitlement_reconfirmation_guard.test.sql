begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select extensions.ok(
  position('sellertray_order_form_confirmations' in lower(pg_get_functiondef(
    'public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure
  ))) > 0
  and position('reconcile_sellertray_installment_entitlement_package_core' in lower(pg_get_functiondef(
    'public.reconcile_sellertray_installment_entitlement(uuid,uuid)'::regprocedure
  ))) > 0,
  'entitlement reconciliation enforces current Order Form confirmation before calling the event-writing core'
);
select extensions.ok(
  to_regprocedure(
    'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)'
  ) is not null
  and has_function_privilege(
    'service_role',
    'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reconcile_sellertray_installment_entitlement_package_core(uuid,uuid)',
    'EXECUTE'
  ),
  'clean-history and upgraded databases preserve the guarded C1B entitlement core'
);

select extensions.ok(
  not has_function_privilege('authenticated',
    'public.reconcile_sellertray_installment_entitlement(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role',
    'public.reconcile_sellertray_installment_entitlement(uuid,uuid)','EXECUTE'),
  'entitlement reconciliation remains behind the governed service boundary'
);
select extensions.ok(
  position('s.status in (''preparing'',''initialized'')' in lower(pg_get_functiondef(
    'public.reissue_sellertray_order_forms_after_discount()'::regprocedure
  ))) > 0
  and position('billing_checkout_sessions' in lower(pg_get_functiondef(
    'public.reissue_sellertray_order_forms_after_discount()'::regprocedure
  ))) > 0,
  'new Order Forms always retire prepared/initialized checkout sessions even if rounded amounts remain equal'
);

create temp table discount_guard_fixture(
  actor_id uuid not null, tenant_id uuid not null, order_id uuid not null,
  obligation_id uuid not null, price_monthly_id uuid,price_yearly_id uuid,
  price_setup_id uuid, branch_id uuid,schedule_id uuid,template_id uuid,
  original_form_id uuid,master_version_id uuid,checkout_id uuid,
  first_discount uuid not null,second_discount uuid not null,
  checkout_command uuid not null,
  late_webhook_rejected boolean not null default false
) on commit drop;

insert into discount_guard_fixture(actor_id,tenant_id,order_id,obligation_id,
    first_discount,second_discount,checkout_command)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select actor_id,'discount-guard-'||left(actor_id::text,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from discount_guard_fixture;
insert into public.platform_admins(user_id,role)
select actor_id,'admin' from discount_guard_fixture;
insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'Discount Gate Fixture','discount-gate-'||left(tenant_id::text,8),
  'DGG','trial' from discount_guard_fixture;
insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,actor_id,'owner' from discount_guard_fixture;
update discount_guard_fixture f set branch_id=b.id
from public.branches b where b.tenant_id=f.tenant_id and b.is_default=true;

-- 1,000.02 = annual subscription 1,000.00 plus Branch setup 0.02.
-- On 70:30, the first installment rounds to 700.01 both before and
-- after a one-cent discount. The former URL must still be retired.
with p as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',100,
    now()-interval '10 minutes','Discount gate monthly 10-for-12 anchor',
    actor_id,actor_id,now() from discount_guard_fixture returning id
)
update discount_guard_fixture set price_monthly_id=(select id from p);
with p as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',1000,
    now()-interval '9 minutes','Discount gate annual 10-for-12 test',
    actor_id,actor_id,now() from discount_guard_fixture returning id
)
update discount_guard_fixture set price_yearly_id=(select id from p);
with p as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,effective_from,
    change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'branch_setup',null,null,'NGN',0.02,
    now()-interval '8 minutes','Discount gate setup rounding test',
    actor_id,actor_id,now() from discount_guard_fixture returning id
)
update discount_guard_fixture set price_setup_id=(select id from p);

insert into public.sellertray_commercial_orders(
  id,tenant_id,order_reference,currency,total_gross_amount,created_by_user_id
)
select order_id,tenant_id,'DGG-'||left(order_id::text,8),'NGN',1000.02,actor_id
from discount_guard_fixture;
insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select tenant_id,order_id,1,'subscription',price_yearly_id,'Annual SellerTray subscription'
from discount_guard_fixture;
insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,
  branch_id,description_snapshot
)
select tenant_id,order_id,2,'branch_setup',price_setup_id,branch_id,'Branch setup'
from discount_guard_fixture;
set constraints all immediate;
set constraints validate_sellertray_commercial_installment_obligation deferred;
set constraints validate_sellertray_commercial_installment_schedule_line deferred;

insert into public.sellertray_commercial_installment_obligations(
  id,tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
)
select obligation_id,tenant_id,order_id,'two_installment_70_30','NGN',1000.02,actor_id
from discount_guard_fixture;
with lines as (
  insert into public.sellertray_commercial_installment_schedule(
    tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
  )
  select tenant_id,obligation_id,1,70,700.01 from discount_guard_fixture
  union all
  select tenant_id,obligation_id,2,30,300.01 from discount_guard_fixture
  returning id,sequence_no
)
update discount_guard_fixture set schedule_id=(select id from lines where sequence_no=1);
set constraints all immediate;

-- The existing obligation-insert trigger snapshots the approved installment policy;
-- verify that authoritative snapshot rather than inserting a duplicate.
select extensions.ok(
  exists (
    select 1 from public.sellertray_installment_contract_snapshots snap
    join discount_guard_fixture f on f.obligation_id=snap.installment_obligation_id
    where snap.tenant_id=f.tenant_id and snap.template_code='two_installment_70_30'
  ),
  'governed obligation trigger freezes the active installment schedule template'
);

with t as (
  insert into public.sellertray_commercial_agreement_template_versions(
    agreement_family,version_code,title,content_body,content_sha256,
    effective_from,published_by_user_id,publication_scope,
    production_authorized_at,production_authorized_by_user_id,production_authorization_reason
  )
  select 'subscription_order','discount-gate-'||left(tenant_id::text,8),
    'Discount gate form','SellerTray Order Form for discount payment regression',
    repeat('0',64),now()-interval '2 minutes',actor_id,'production',
    now()-interval '1 minute',actor_id,
    'Temporary pgTAP approved Order Form template'
  from discount_guard_fixture returning id
)
update discount_guard_fixture set template_id=(select id from t);

with o as (
  insert into public.sellertray_commercial_order_forms(
    tenant_id,commercial_order_id,installment_obligation_id,
    order_form_template_version_id,template_version_code,template_content_sha256,
    order_form_reference,rendered_content,commercial_snapshot,
    commercial_snapshot_sha256,content_sha256,issued_by_user_id
  )
  select tenant_id,order_id,null,template_id,
    'pending',repeat('0',64),'DGG-OF-'||left(order_id::text,8),
    'pending','{}'::jsonb,repeat('0',64),repeat('0',64),actor_id
  from discount_guard_fixture returning id
)
update discount_guard_fixture set original_form_id=(select id from o);

-- Normal approved Master/Order Form acceptance is separate from payment.
update discount_guard_fixture f
set master_version_id=public.publish_sellertray_master_agreement_admin(
  'discount-gate-'||left(f.tenant_id::text,8),
  'SellerTray Master Agreement','Discount gate synthetic Master Agreement',
  now()-interval '1 minute','Temporary regression Master publication',f.actor_id
);
select public.accept_sellertray_master_agreement(
 f.tenant_id,f.master_version_id,'Discount Gate Owner',
 jsonb_build_object('channel','merchant_web','authority_confirmed',true),
 gen_random_uuid(),f.actor_id
) from discount_guard_fixture f;
-- Orchestration may also produce an installment-specific Order Form where
-- an authorized production template already exists. Confirm every current
-- instrument to model a merchant who has completed the pre-discount contract.
select public.create_sellertray_agreement_package(
 f.tenant_id,o.id,f.master_version_id
)
from discount_guard_fixture f
join public.sellertray_commercial_order_forms o
 on o.tenant_id=f.tenant_id and o.commercial_order_id=f.order_id
where not exists (select 1 from public.sellertray_commercial_order_forms next
 where next.tenant_id=o.tenant_id and next.supersedes_order_form_id=o.id);
select public.confirm_sellertray_agreement_package(
 f.tenant_id,o.id,'Discount Gate Owner',
 jsonb_build_object('authority_confirmed',true),gen_random_uuid(),f.actor_id
)
from discount_guard_fixture f
join public.sellertray_commercial_order_forms o
 on o.tenant_id=f.tenant_id and o.commercial_order_id=f.order_id
where not exists (select 1 from public.sellertray_commercial_order_forms next
 where next.tenant_id=o.tenant_id and next.supersedes_order_form_id=o.id);
select extensions.ok(
  not exists(
    select 1 from public.sellertray_commercial_order_forms o
    join discount_guard_fixture f on o.commercial_order_id=f.order_id
    where not exists (select 1 from public.sellertray_commercial_order_forms next
      where next.tenant_id=o.tenant_id and next.supersedes_order_form_id=o.id)
      and not exists (select 1 from public.sellertray_order_form_confirmations c
        where c.tenant_id=o.tenant_id and c.order_form_id=o.id)
  ),
  'all pre-discount current commercial Order Forms are confirmed'
);

-- Initially the current obligation is 70% due now.
select extensions.is(
  (public.get_sellertray_commercial_settlement_state(f.tenant_id,f.order_id)
    ->>'nextPayableAmount')::numeric,700.01::numeric,
  'test starts with 70% installment rounded to 700.01'
) from discount_guard_fixture f;

-- Reserve and initialize through the real Paystack checkout state machine.
-- The BEFORE INSERT payment guard does not permit directly inserting an
-- initialized Paystack URL; a production checkout must begin as preparing.
update discount_guard_fixture f
set checkout_id = (
  public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_id,f.checkout_command,f.actor_id,
    'discount-gate-'||left(f.actor_id::text,8)||'@example.com'
  )->>'sessionId'
)::uuid;

select public.begin_sellertray_installment_checkout_initialization(f.checkout_id)
from discount_guard_fixture f;
select public.complete_sellertray_installment_checkout_initialization(
  f.checkout_id,
  'sti-'||left(replace(f.tenant_id::text,'-',''),8)
    ||'-'||replace(f.checkout_command::text,'-',''),
  'https://paystack.example.invalid/stale'
)
from discount_guard_fixture f;
select extensions.is(
  (select s.status from public.billing_checkout_sessions s where s.id=f.checkout_id),
  'initialized'::text,
  'the original checkout is properly initialized through the governed provider lease'
) from discount_guard_fixture f;

select public.record_sellertray_commercial_discount_internal(
 f.tenant_id,f.order_id,f.first_discount,'fixed_amount',0.01,
 'Rounding-equal discount checkout invalidation','{}'::jsonb,f.actor_id
) from discount_guard_fixture f;

select extensions.is(
  (public.get_sellertray_commercial_settlement_state(f.tenant_id,f.order_id)
    ->>'nextPayableAmount')::numeric,700.01::numeric,
  'one-cent discount deliberately leaves current installment rounded unchanged'
) from discount_guard_fixture f;
select extensions.is(
  (select c.status from public.billing_checkout_sessions c
    where c.id=f.checkout_id),'superseded'::text,
  'the old Paystack checkout is superseded despite unchanged installment amount'
) from discount_guard_fixture f;
select extensions.is(
  (public.reserve_sellertray_installment_checkout(
    f.tenant_id,f.schedule_id,f.checkout_command,f.actor_id,
    'discount-gate-'||left(f.actor_id::text,8)||'@example.com'
  )->>'status'),'superseded'::text,
  'old checkout command replay does not resurrect a superseded payment URL'
) from discount_guard_fixture f;

do $$
declare f discount_guard_fixture%rowtype;
begin
  select * into strict f from discount_guard_fixture;
  begin
    perform public.confirm_sellertray_installment_payment_from_checkout(
      f.checkout_id,
      'sti-'||left(replace(f.tenant_id::text,'-',''),8)||'-'||replace(f.checkout_command::text,'-',''),
      'pg-tap-charge',700.01,'NGN',now(),'discount-gate-verified-provider-event'
    );
  exception when sqlstate '23514' then
    update discount_guard_fixture set late_webhook_rejected=true;
  end;
end;
$$;
select extensions.ok((select late_webhook_rejected from discount_guard_fixture),
  'superseded checkout cannot be newly recorded as confirmed payment');

-- Fully waive the remaining commercial balance without creating any payment.
select public.record_sellertray_commercial_discount_internal(
 f.tenant_id,f.order_id,f.second_discount,'fixed_amount',1000.01,
 'Remaining purchase price waived for entitlement gate regression',
 '{}'::jsonb,f.actor_id
) from discount_guard_fixture f;
select extensions.is(
  (public.get_sellertray_commercial_settlement_state(f.tenant_id,f.order_id)
    ->>'outstandingAmount')::numeric,0::numeric,
  '100% waiver makes the governed monetary obligation fully settled'
) from discount_guard_fixture f;

-- Synthetic setup readiness only: no production fact is touched.
insert into public.sellertray_commercial_branch_setup_readiness(
 tenant_id,commercial_order_id,branch_id,command_id,evidence,
 actor_user_id,reason,ready_at
)
select tenant_id,order_id,branch_id,gen_random_uuid(),
 jsonb_build_object('source','pgtap_discount_guard'),actor_id,
 'Synthetic approved branch setup in pgTAP regression',now()
from discount_guard_fixture;

select public.reconcile_sellertray_installment_entitlement(
 f.tenant_id,f.obligation_id
) from discount_guard_fixture f;

select extensions.is(
 (select count(*)::integer from public.sellertray_commercial_entitlement_events e
  join discount_guard_fixture f on e.commercial_order_id=f.order_id),
 0, 'unconfirmed replacement blocks otherwise fully-qualified new entitlement events'
);
select extensions.ok(
 (select sub.status='trial'
  from public.tenant_subscriptions sub
  join discount_guard_fixture f on sub.tenant_id=f.tenant_id),
 'unconfirmed replacement does not activate legacy compatibility subscription'
);
select extensions.ok(
 (select count(*)::integer from public.sellertray_commercial_order_forms o
  join discount_guard_fixture f on o.commercial_order_id=f.order_id
  where not exists (select 1 from public.sellertray_commercial_order_forms next
   where next.tenant_id=o.tenant_id and next.supersedes_order_form_id=o.id)) >= 1
  and not exists(
    select 1 from public.sellertray_commercial_order_forms o
    join discount_guard_fixture f on o.commercial_order_id=f.order_id
    where not exists(select 1 from public.sellertray_commercial_order_forms next
      where next.tenant_id=o.tenant_id and next.supersedes_order_form_id=o.id)
      and exists(select 1 from public.sellertray_order_form_confirmations c
        where c.tenant_id=o.tenant_id and c.order_form_id=o.id)
  ),
  'all current replacement Order Forms remain unconfirmed after both discounts'
);

-- The current replacement alone can unlock subsequent entitlement release.
select public.create_sellertray_agreement_package(
 f.tenant_id,o.id,f.master_version_id
)
from discount_guard_fixture f
join public.sellertray_commercial_order_forms o
 on o.tenant_id=f.tenant_id and o.commercial_order_id=f.order_id
where not exists (select 1 from public.sellertray_commercial_order_forms next
 where next.tenant_id=o.tenant_id and next.supersedes_order_form_id=o.id);

select public.confirm_sellertray_agreement_package(
  f.tenant_id,o.id,'Discount Gate Owner',
  jsonb_build_object('authority_confirmed',true),gen_random_uuid(),f.actor_id
)
from discount_guard_fixture f
join public.sellertray_commercial_order_forms o
 on o.tenant_id=f.tenant_id and o.commercial_order_id=f.order_id
where not exists (select 1 from public.sellertray_commercial_order_forms next
 where next.tenant_id=o.tenant_id and next.supersedes_order_form_id=o.id);

select public.reconcile_sellertray_installment_entitlement(
 f.tenant_id,f.obligation_id
) from discount_guard_fixture f;

select extensions.is(
 (select count(*)::integer from public.sellertray_commercial_entitlement_events e
  join discount_guard_fixture f on e.commercial_order_id=f.order_id
  where e.event_type='installment.full_entitlement_released'),
 1, 'after current Order Form confirmation, reconciler releases full entitlement once'
);
select extensions.is(
 (select count(*)::integer from public.sellertray_commercial_entitlement_events e
  join discount_guard_fixture f on e.commercial_order_id=f.order_id
  where e.event_type='installment.full_entitlement_released'),
 1, 'idempotent full settlement event is not duplicated'
);

select * from extensions.finish();
rollback;
