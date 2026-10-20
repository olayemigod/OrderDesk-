begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(30);

create temp table sellertray_c1a_fixture (
  admin_user_id uuid not null,
  owner_user_id uuid not null,
  manager_user_id uuid not null,
  staff_user_id uuid not null,
  tenant_id uuid not null,
  monthly_price_id uuid,
  yearly_price_id uuid,
  commercial_order_id uuid,
  installment_obligation_id uuid,
  installment_template_id uuid,
  subscription_template_id uuid,
  installment_agreement_id uuid,
  subscription_agreement_id uuid,
  owner_acceptance_id uuid,
  manager_acceptance_id uuid,
  replacement_agreement_id uuid,
  replacement_acceptance_id uuid,
  manager_without_authority_rejected boolean not null default false,
  staff_delegation_rejected boolean not null default false,
  manager_delegation_rejected boolean not null default false,
  non_admin_publish_rejected boolean not null default false,
  superseded_acceptance_rejected boolean not null default false,
  template_mutation_rejected boolean not null default false,
  agreement_mutation_rejected boolean not null default false,
  acceptance_mutation_rejected boolean not null default false
) on commit drop;

insert into sellertray_c1a_fixture(
  admin_user_id,owner_user_id,manager_user_id,staff_user_id,tenant_id
) values (
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select admin_user_id,'c1a-admin-'||substr(admin_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_c1a_fixture
union all
select owner_user_id,'c1a-owner-'||substr(owner_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_c1a_fixture
union all
select manager_user_id,'c1a-manager-'||substr(manager_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_c1a_fixture
union all
select staff_user_id,'c1a-staff-'||substr(staff_user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now() from sellertray_c1a_fixture;

insert into public.platform_admins(user_id,role)
select admin_user_id,'admin' from sellertray_c1a_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'C1A Agreement Tenant','c1a-'||substr(tenant_id::text,1,8),'C1A','trial'
from sellertray_c1a_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner' from sellertray_c1a_fixture
union all
select tenant_id,manager_user_id,'manager' from sellertray_c1a_fixture
union all
select tenant_id,staff_user_id,'staff' from sellertray_c1a_fixture;

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','monthly','NGN',100,
         now()-interval '1 day','C1A fixture monthly price',admin_user_id,admin_user_id,now()
  from sellertray_c1a_fixture
  returning id
)
update sellertray_c1a_fixture set monthly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_price_versions(
    price_kind,plan_code,billing_cycle,currency,gross_amount,
    effective_from,change_reason,created_by_user_id,approved_by_user_id,approved_at
  )
  select 'subscription','business','yearly','NGN',1000,
         now()-interval '1 day','C1A fixture yearly price',admin_user_id,admin_user_id,now()
  from sellertray_c1a_fixture
  returning id
)
update sellertray_c1a_fixture set yearly_price_id=(select id from inserted);

with inserted as (
  insert into public.sellertray_commercial_orders(
    tenant_id,order_reference,currency,total_gross_amount,ordered_at,created_by_user_id
  )
  select tenant_id,'C1A-'||upper(substr(tenant_id::text,1,8)),'NGN',1000,now(),admin_user_id
  from sellertray_c1a_fixture
  returning id
)
update sellertray_c1a_fixture set commercial_order_id=(select id from inserted);

insert into public.sellertray_commercial_order_price_snapshots(
  tenant_id,commercial_order_id,line_no,line_type,source_price_version_id,description_snapshot
)
select tenant_id,commercial_order_id,1,'subscription',yearly_price_id,'Annual SellerTray subscription'
from sellertray_c1a_fixture;
set constraints all immediate;

set constraints all deferred;

with inserted as (
  insert into public.sellertray_commercial_installment_obligations(
    tenant_id,commercial_order_id,structure_code,currency,obligated_amount,created_by_user_id
  )
  select tenant_id,commercial_order_id,'two_installment_70_30','NGN',1000,admin_user_id
  from sellertray_c1a_fixture
  returning id
)
update sellertray_c1a_fixture set installment_obligation_id=(select id from inserted);

insert into public.sellertray_commercial_installment_schedule(
  tenant_id,installment_obligation_id,sequence_no,percentage,amount_due
)
select tenant_id,installment_obligation_id,1,70,700 from sellertray_c1a_fixture
union all
select tenant_id,installment_obligation_id,2,30,300 from sellertray_c1a_fixture;
set constraints all immediate;

select extensions.ok(
  to_regclass('public.sellertray_commercial_agreement_template_versions') is not null
  and to_regclass('public.sellertray_commercial_agreements') is not null
  and to_regclass('public.sellertray_commercial_agreement_acceptances') is not null
  and to_regprocedure('public.publish_sellertray_commercial_agreement_template_version(text,text,text,text,timestamptz,uuid)') is not null
  and to_regprocedure('public.issue_sellertray_commercial_agreement(uuid,uuid,uuid,uuid,text,text,uuid,uuid)') is not null
  and to_regprocedure('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)') is not null,
  'C1A agreement tables and governed commands exist'
);

select extensions.is(
  (select count(*)::integer from pg_class c where c.oid in (
    'public.sellertray_commercial_agreement_template_versions'::regclass,
    'public.sellertray_commercial_agreements'::regclass,
    'public.sellertray_commercial_agreement_acceptances'::regclass
  ) and c.relrowsecurity),
  3,
  'all C1A persistence tables enable RLS'
);

select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_commercial_agreements','SELECT')
  and not has_table_privilege('authenticated','public.sellertray_commercial_agreement_acceptances','INSERT')
  and not has_function_privilege(
    'authenticated',
    'public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)',
    'EXECUTE'
  ),
  'C1A persistence and acceptance command remain behind service authority'
);

select extensions.ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_legal_acceptances' and column_name='terms_version')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_legal_acceptances' and column_name='privacy_version')
  and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_legal_acceptances' and column_name='tenant_id'),
  'existing user Terms/Privacy acceptance remains a separate user-level ledger'
);

select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_c1a_fixture),
    (select owner_user_id from sellertray_c1a_fixture),
    'can_accept_commercial_agreements'
  ),
  'Owner commercial agreement authority is always valid'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_c1a_fixture),
    (select manager_user_id from sellertray_c1a_fixture),
    'can_accept_commercial_agreements'
  ),
  'Manager does not inherit commercial signing authority by default'
);

select extensions.ok(
  not public.sellertray_user_has_capability(
    (select tenant_id from sellertray_c1a_fixture),
    (select staff_user_id from sellertray_c1a_fixture),
    'can_accept_commercial_agreements'
  ),
  'Cashier cannot hold commercial signing authority'
);

do $$
begin
  begin
    perform public.set_sellertray_member_capability(
      f.tenant_id,f.staff_user_id,'can_accept_commercial_agreements',true,f.owner_user_id
    ) from sellertray_c1a_fixture f;
  exception when sqlstate '42501' then
    update sellertray_c1a_fixture set staff_delegation_rejected=true;
  end;
end
$$;
select extensions.ok((select staff_delegation_rejected from sellertray_c1a_fixture),'Owner cannot delegate contract signing to a Cashier');

do $$
begin
  begin
    perform public.set_sellertray_member_capability(
      f.tenant_id,f.manager_user_id,'can_accept_commercial_agreements',true,f.manager_user_id
    ) from sellertray_c1a_fixture f;
  exception when sqlstate '42501' then
    update sellertray_c1a_fixture set manager_delegation_rejected=true;
  end;
end
$$;
select extensions.ok((select manager_delegation_rejected from sellertray_c1a_fixture),'Manager cannot self-delegate contract signing authority');

do $$
begin
  begin
    perform public.publish_sellertray_commercial_agreement_template_version(
      'installment_agreement','unauthorised-v1','Unauthorised template','Not allowed',now(),f.owner_user_id
    ) from sellertray_c1a_fixture f;
  exception when sqlstate '42501' then
    update sellertray_c1a_fixture set non_admin_publish_rejected=true;
  end;
end
$$;
select extensions.ok((select non_admin_publish_rejected from sellertray_c1a_fixture),'merchant users cannot publish platform agreement templates');

update sellertray_c1a_fixture f
set installment_template_id=public.publish_sellertray_commercial_agreement_template_version(
  'installment_agreement','2026.1','SellerTray Installment Agreement','Approved installment agreement template',
  now()-interval '1 minute',f.admin_user_id
);
update sellertray_c1a_fixture f
set subscription_template_id=public.publish_sellertray_commercial_agreement_template_version(
  'subscription_order','2026.1','SellerTray Subscription Order','Approved subscription order template',
  now()-interval '1 minute',f.admin_user_id
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_commercial_agreement_template_versions t join sellertray_c1a_fixture f on t.id=f.installment_template_id
    where t.content_sha256=encode(extensions.digest(t.content_body,'sha256'),'hex')
      and char_length(t.content_sha256)=64
  ),
  'published agreement template stores server-computed SHA-256 integrity evidence'
);

update sellertray_c1a_fixture f
set installment_agreement_id=public.issue_sellertray_commercial_agreement(
  f.tenant_id,f.commercial_order_id,f.installment_obligation_id,f.installment_template_id,
  'AGR-INSTALL-'||upper(substr(f.tenant_id::text,1,8)),
  'Merchant-specific installment agreement for C1A test',
  null,f.admin_user_id
);
update sellertray_c1a_fixture f
set subscription_agreement_id=public.issue_sellertray_commercial_agreement(
  f.tenant_id,f.commercial_order_id,null,f.subscription_template_id,
  'AGR-SUB-'||upper(substr(f.tenant_id::text,1,8)),
  'Merchant-specific subscription order for C1A test',
  null,f.admin_user_id
);

select extensions.ok(
  exists(
    select 1 from public.sellertray_commercial_agreements a join sellertray_c1a_fixture f on a.id=f.installment_agreement_id
    join public.sellertray_commercial_agreement_template_versions t on t.id=a.template_version_id
    where a.tenant_id=f.tenant_id
      and a.commercial_order_id=f.commercial_order_id
      and a.installment_obligation_id=f.installment_obligation_id
      and a.agreement_family='installment_agreement'
      and a.template_version_code=t.version_code
      and a.template_content_sha256=t.content_sha256
      and a.content_sha256=encode(extensions.digest(a.rendered_content,'sha256'),'hex')
  ),
  'merchant agreement snapshots exact template and rendered-content integrity facts'
);

select extensions.ok(
  exists(
    select 1
    from public.sellertray_commercial_agreements a
    join sellertray_c1a_fixture f on a.id=f.installment_agreement_id
    where a.commercial_snapshot->>'commercial_order_id'=f.commercial_order_id::text
      and a.commercial_snapshot->>'order_reference'='C1A-'||upper(substr(f.tenant_id::text,1,8))
      and a.commercial_snapshot->>'currency'='NGN'
      and jsonb_array_length(a.commercial_snapshot->'price_snapshots')=1
      and a.commercial_snapshot#>>'{installment,installment_obligation_id}'=f.installment_obligation_id::text
      and a.commercial_snapshot#>>'{installment,structure_code}'='two_installment_70_30'
      and jsonb_array_length(a.commercial_snapshot#>'{installment,schedule}')=2
  ),
  'agreement commercial snapshot is derived server-side from governed C1 order, pricing and installment facts'
);

select extensions.is(
  public.issue_sellertray_commercial_agreement(
    f.tenant_id,f.commercial_order_id,null,f.subscription_template_id,
    'AGR-SUB-'||upper(substr(f.tenant_id::text,1,8)),
    'Merchant-specific subscription order for C1A test',
    null,f.admin_user_id
  ),
  f.subscription_agreement_id,
  'identical agreement issuance retries idempotently'
) from sellertray_c1a_fixture f;

do $$
begin
  begin
    perform public.accept_sellertray_commercial_agreement(
      f.tenant_id,f.subscription_agreement_id,'Manager Without Authority','{}'::jsonb,gen_random_uuid(),f.manager_user_id
    ) from sellertray_c1a_fixture f;
  exception when sqlstate '42501' then
    update sellertray_c1a_fixture set manager_without_authority_rejected=true;
  end;
end
$$;
select extensions.ok((select manager_without_authority_rejected from sellertray_c1a_fixture),'Manager acceptance fails closed without explicit signing authority');

select public.set_sellertray_member_capability(
  tenant_id,manager_user_id,'can_accept_commercial_agreements',true,owner_user_id
) from sellertray_c1a_fixture;
select extensions.ok(
  public.sellertray_user_has_capability(
    (select tenant_id from sellertray_c1a_fixture),
    (select manager_user_id from sellertray_c1a_fixture),
    'can_accept_commercial_agreements'
  ),
  'Owner can explicitly delegate commercial signing authority to a Manager'
);

select extensions.ok(
  exists(
    select 1 from public.tenant_member_capability_events e join sellertray_c1a_fixture f
      on e.tenant_id=f.tenant_id and e.user_id=f.manager_user_id
    where e.capability='can_accept_commercial_agreements'
      and e.new_allowed=true
      and e.actor_user_id=f.owner_user_id
  ),
  'Manager signing delegation is immutably audited through capability events'
);

update sellertray_c1a_fixture f
set owner_acceptance_id=public.accept_sellertray_commercial_agreement(
  f.tenant_id,f.installment_agreement_id,'Test Business Owner',jsonb_build_object('channel','merchant-web'),gen_random_uuid(),f.owner_user_id
);
select extensions.ok(
  public.sellertray_installment_agreement_is_accepted(
    (select tenant_id from sellertray_c1a_fixture),
    (select commercial_order_id from sellertray_c1a_fixture),
    (select installment_obligation_id from sellertray_c1a_fixture)
  ),
  'accepted current installment agreement exposes a governed C1B-readable acceptance fact'
);

update sellertray_c1a_fixture f
set manager_acceptance_id=public.accept_sellertray_commercial_agreement(
  f.tenant_id,f.subscription_agreement_id,'Authorised Test Manager',jsonb_build_object('channel','merchant-web'),gen_random_uuid(),f.manager_user_id
);
select extensions.ok(
  exists(
    select 1 from public.sellertray_commercial_agreement_acceptances ac join sellertray_c1a_fixture f on ac.id=f.manager_acceptance_id
    join public.sellertray_commercial_agreements a on a.id=ac.agreement_id
    where ac.accepted_role='manager'
      and ac.accepted_by_user_id=f.manager_user_id
      and ac.template_version_id=a.template_version_id
      and ac.template_content_sha256=a.template_content_sha256
      and ac.agreement_content_sha256=a.content_sha256
      and ac.acceptance_method='merchant_web_authenticated'
  ),
  'acceptance snapshots representative authority and exact agreement/template hashes'
);

update sellertray_c1a_fixture f
set replacement_agreement_id=public.issue_sellertray_commercial_agreement(
  f.tenant_id,f.commercial_order_id,f.installment_obligation_id,f.installment_template_id,
  'AGR-INSTALL-R2-'||upper(substr(f.tenant_id::text,1,8)),
  'Replacement merchant-specific installment agreement for C1A test',
  f.installment_agreement_id,f.admin_user_id
);
select extensions.ok(
  not public.sellertray_installment_agreement_is_accepted(
    (select tenant_id from sellertray_c1a_fixture),
    (select commercial_order_id from sellertray_c1a_fixture),
    (select installment_obligation_id from sellertray_c1a_fixture)
  ),
  'superseding an accepted installment agreement requires acceptance of the replacement before C1B can proceed'
);

do $$
begin
  begin
    perform public.accept_sellertray_commercial_agreement(
      f.tenant_id,f.installment_agreement_id,'Test Business Owner','{}'::jsonb,gen_random_uuid(),f.owner_user_id
    ) from sellertray_c1a_fixture f;
  exception when sqlstate '23514' then
    update sellertray_c1a_fixture set superseded_acceptance_rejected=true;
  end;
end
$$;
select extensions.ok((select superseded_acceptance_rejected from sellertray_c1a_fixture),'superseded commercial agreement cannot be accepted');

update sellertray_c1a_fixture f
set replacement_acceptance_id=public.accept_sellertray_commercial_agreement(
  f.tenant_id,f.replacement_agreement_id,'Authorised Test Manager',jsonb_build_object('channel','merchant-web'),gen_random_uuid(),f.manager_user_id
);
select extensions.ok(
  public.sellertray_installment_agreement_is_accepted(
    (select tenant_id from sellertray_c1a_fixture),
    (select commercial_order_id from sellertray_c1a_fixture),
    (select installment_obligation_id from sellertray_c1a_fixture)
  ),
  'accepted replacement becomes the current governed installment agreement fact'
);

select extensions.is(
  public.accept_sellertray_commercial_agreement(
    f.tenant_id,f.subscription_agreement_id,'Authorised Test Manager',jsonb_build_object('channel','merchant-web'),ac.command_id,f.manager_user_id
  ),
  ac.id,
  'identical acceptance command replays idempotently'
)
from sellertray_c1a_fixture f
join public.sellertray_commercial_agreement_acceptances ac on ac.id=f.manager_acceptance_id;

do $$
begin
  begin
    update public.sellertray_commercial_agreement_template_versions set title=title
    where id=(select installment_template_id from sellertray_c1a_fixture);
  exception when sqlstate '55000' then
    update sellertray_c1a_fixture set template_mutation_rejected=true;
  end;
end
$$;
select extensions.ok((select template_mutation_rejected from sellertray_c1a_fixture),'published agreement template version is immutable');

do $$
begin
  begin
    update public.sellertray_commercial_agreements set agreement_reference=agreement_reference
    where id=(select replacement_agreement_id from sellertray_c1a_fixture);
  exception when sqlstate '55000' then
    update sellertray_c1a_fixture set agreement_mutation_rejected=true;
  end;
end
$$;
select extensions.ok((select agreement_mutation_rejected from sellertray_c1a_fixture),'issued merchant agreement is immutable');

do $$
begin
  begin
    update public.sellertray_commercial_agreement_acceptances set accepted_legal_name=accepted_legal_name
    where id=(select replacement_acceptance_id from sellertray_c1a_fixture);
  exception when sqlstate '55000' then
    update sellertray_c1a_fixture set acceptance_mutation_rejected=true;
  end;
end
$$;
select extensions.ok((select acceptance_mutation_rejected from sellertray_c1a_fixture),'merchant agreement acceptance evidence is immutable');

select extensions.is(
  (select status from public.tenant_subscriptions where tenant_id=(select tenant_id from sellertray_c1a_fixture)),
  'trial'::text,
  'C1A agreement acceptance does not mutate legacy runtime subscription state'
);

select extensions.ok(
  position('tenant_subscriptions' in pg_get_functiondef('public.accept_sellertray_commercial_agreement(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure))=0,
  'C1A acceptance command contains no hidden runtime entitlement mutation'
);

select extensions.ok(
  exists(
    select 1 from pg_constraint c
    where c.conrelid='public.sellertray_commercial_agreements'::regclass
      and c.confrelid='public.sellertray_commercial_installment_obligations'::regclass
      and c.conname='sellertray_commercial_agreements_installment_same_order'
  ),
  'installment agreement is relationally bound to the same C1 commercial order and obligation'
);

select extensions.ok(
  exists(
    select 1 from pg_constraint c
    where c.conrelid='public.sellertray_commercial_agreement_acceptances'::regclass
      and c.confrelid='public.sellertray_commercial_agreements'::regclass
  ),
  'acceptance evidence cannot detach from its immutable merchant agreement'
);

select * from extensions.finish();
rollback;
