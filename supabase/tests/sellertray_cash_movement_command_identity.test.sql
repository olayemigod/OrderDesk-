begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

create temp table sellertray_cash_movement_command_fixture (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  branch_id uuid,
  register_id uuid,
  shift_id uuid,
  first_result jsonb,
  replay_result jsonb,
  reference_replay jsonb,
  command_conflict boolean not null default false,
  reference_conflict boolean not null default false
) on commit drop;

insert into sellertray_cash_movement_command_fixture(tenant_id,owner_user_id)
values(gen_random_uuid(),gen_random_uuid());

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_user_id,
  'cash-command-'||substr(owner_user_id::text,1,8)||'@example.com',
  'authenticated','authenticated',now(),now()
from sellertray_cash_movement_command_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Cash Command Test',
  'sellertray-cash-command-'||substr(tenant_id::text,1,8),'CCT','active'
from sellertray_cash_movement_command_fixture;

update public.tenant_subscriptions
set status='active',trial_ends_at=null,grace_ends_at=null
where tenant_id=(select tenant_id from sellertray_cash_movement_command_fixture);

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_user_id,'owner'
from sellertray_cash_movement_command_fixture;

update sellertray_cash_movement_command_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update sellertray_cash_movement_command_fixture f
set register_id=r.id
from public.sellertray_registers r
where r.tenant_id=f.tenant_id
  and r.branch_id=f.branch_id
  and r.is_default=true;

update sellertray_cash_movement_command_fixture
set shift_id=(public.open_sellertray_cash_shift(
  tenant_id,branch_id,register_id,1000,owner_user_id
)->>'shiftId')::uuid;

select extensions.ok(
  exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='sellertray_shift_cash_movements'
      and column_name='command_id_hash'
  ),
  'cash movements store an internal retry hash separately from the reference'
);

select extensions.ok(
  to_regprocedure('public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,text,uuid)') is not null,
  'authoritative cash movement command accepts an explicit hidden retry identity'
);

select extensions.ok(
  to_regprocedure('public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid)') is not null,
  'legacy internal cash movement command remains available as a compatibility wrapper'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_sellertray_shift_cash_movement(uuid,uuid,text,numeric,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'authoritative cash movement command is service-only'
);

update sellertray_cash_movement_command_fixture
set first_result=public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'cash_in',200,'FLOAT-100','Additional till float',null,
  'cash:cash_in:test001',owner_user_id
);

select extensions.is(
  (select (first_result->>'expectedCash')::numeric from sellertray_cash_movement_command_fixture),
  1200::numeric,'first governed cash movement changes the drawer once'
);

update sellertray_cash_movement_command_fixture
set replay_result=public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'cash_in',200,'FLOAT-100','Additional till float',null,
  'cash:cash_in:test001',owner_user_id
);

select extensions.is(
  (select replay_result->>'idempotentReplay' from sellertray_cash_movement_command_fixture),
  'true','exact retry of the same hidden command identity replays safely'
);

select extensions.is(
  (
    select count(*)::integer
    from public.sellertray_shift_cash_movements m
    where m.tenant_id=(select tenant_id from sellertray_cash_movement_command_fixture)
      and m.shift_id=(select shift_id from sellertray_cash_movement_command_fixture)
      and m.reference='FLOAT-100'
  ),
  1,'exact retry does not duplicate drawer activity'
);

do $$
begin
  begin
    perform public.record_sellertray_shift_cash_movement(
      (select tenant_id from sellertray_cash_movement_command_fixture),
      (select shift_id from sellertray_cash_movement_command_fixture),
      'cash_in',200,'FLOAT-CHANGED','Additional till float',null,
      'cash:cash_in:test001',
      (select owner_user_id from sellertray_cash_movement_command_fixture)
    );
  exception when sqlstate '23505' then
    update sellertray_cash_movement_command_fixture set command_conflict=true;
  end;
end
$$;

select extensions.ok(
  (select command_conflict from sellertray_cash_movement_command_fixture),
  'one hidden cash command identity cannot be reused with a changed reference'
);

update sellertray_cash_movement_command_fixture
set reference_replay=public.record_sellertray_shift_cash_movement(
  tenant_id,shift_id,'cash_in',200,'FLOAT-100','Additional till float',null,
  'cash:cash_in:test002',owner_user_id
);

select extensions.is(
  (select reference_replay->>'idempotentReplay' from sellertray_cash_movement_command_fixture),
  'true','same visible reference and same facts replay across a different transport identity'
);

do $$
begin
  begin
    perform public.record_sellertray_shift_cash_movement(
      (select tenant_id from sellertray_cash_movement_command_fixture),
      (select shift_id from sellertray_cash_movement_command_fixture),
      'cash_in',250,'FLOAT-100','Different retry facts',null,
      'cash:cash_in:test003',
      (select owner_user_id from sellertray_cash_movement_command_fixture)
    );
  exception when sqlstate '23505' then
    update sellertray_cash_movement_command_fixture set reference_conflict=true;
  end;
end
$$;

select extensions.ok(
  (select reference_conflict from sellertray_cash_movement_command_fixture),
  'visible cash reference remains an independent conflicting-duplicate guard'
);

select extensions.is(
  (
    select t.expected_cash
    from public.sellertray_cash_shift_totals(
      (select tenant_id from sellertray_cash_movement_command_fixture),
      (select shift_id from sellertray_cash_movement_command_fixture)
    ) t
  ),
  1200::numeric,'retries and rejected conflicts do not change drawer truth'
);

select extensions.ok(
  exists(
    select 1
    from public.sellertray_shift_cash_movements m
    where m.tenant_id=(select tenant_id from sellertray_cash_movement_command_fixture)
      and m.reference='FLOAT-100'
      and m.command_id_hash ~ '^[0-9a-f]{32}$'
      and position('FLOAT-100' in m.command_id_hash)=0
  ),
  'stored retry identity is hashed and does not expose the merchant reference'
);

select * from extensions.finish();
rollback;
