begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(29);

create temp table sellertray_feedback_fixture(
  tenant_id uuid not null,
  owner_id uuid not null,
  manager_id uuid not null,
  staff_id uuid not null,
  outsider_id uuid not null,
  feedback_id uuid
) on commit drop;

insert into sellertray_feedback_fixture
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'feedback-owner-'||substr(owner_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_feedback_fixture
union all
select manager_id,'feedback-manager-'||substr(manager_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_feedback_fixture
union all
select staff_id,'feedback-staff-'||substr(staff_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_feedback_fixture
union all
select outsider_id,'feedback-outsider-'||substr(outsider_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_feedback_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Feedback Test','feedback-'||substr(tenant_id::text,1,8),'FBT','active'
from sellertray_feedback_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner' from sellertray_feedback_fixture
union all
select tenant_id,manager_id,'manager' from sellertray_feedback_fixture
union all
select tenant_id,staff_id,'staff' from sellertray_feedback_fixture;

select extensions.has_table('public','sellertray_feedback','feedback table exists');
select extensions.has_table('public','sellertray_feedback_management_events','feedback management audit table exists');
select extensions.has_function('public','submit_sellertray_feedback',array['uuid','uuid','text','smallint','text','text','text','jsonb'],'feedback submission command exists');
select extensions.has_function('public','sellertray_feedback_state',array['uuid'],'feedback state command exists');
select extensions.has_function('public','get_sellertray_feedback_dashboard',array['uuid','integer'],'feedback management dashboard exists');
select extensions.has_function('public','manage_sellertray_feedback',array['uuid','uuid','text','text'],'feedback management command exists');

grant select,update on sellertray_feedback_fixture to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from sellertray_feedback_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_feedback_fixture
set feedback_id=public.submit_sellertray_feedback(
  tenant_id,null,'experience',5::smallint,'SellerTray works well for this workflow.','1.0.0','android','{"surface":"more"}'::jsonb
);

select extensions.ok((select feedback_id is not null from sellertray_feedback_fixture),'signed-in member can submit feedback');
select extensions.ok((public.sellertray_feedback_state((select tenant_id from sellertray_feedback_fixture))->>'hasSubmitted')::boolean,'app can tell that the current user has submitted feedback');
select extensions.is((public.sellertray_feedback_state((select tenant_id from sellertray_feedback_fixture))->>'submissionCount')::integer,1,'feedback state reports the current user submission count');
select extensions.is(
  (public.get_sellertray_feedback_dashboard((select tenant_id from sellertray_feedback_fixture),100)->'summary'->>'submissionCount')::integer,
  1,
  'owner feedback dashboard reports tenant submission count'
);
select extensions.ok(
  (public.get_sellertray_feedback_dashboard((select tenant_id from sellertray_feedback_fixture),100)->'members') @>
    jsonb_build_array(jsonb_build_object(
      'userId',(select owner_id from sellertray_feedback_fixture),
      'hasSubmitted',true
    )),
  'owner feedback dashboard shows which tenant member has submitted feedback'
);

select set_config('request.jwt.claim.sub',(select manager_id::text from sellertray_feedback_fixture),true);
select extensions.is(
  (public.get_sellertray_feedback_dashboard((select tenant_id from sellertray_feedback_fixture),100)->'summary'->>'submissionCount')::integer,
  1,
  'manager can open the tenant feedback dashboard'
);
select extensions.is(
  public.manage_sellertray_feedback(
    (select tenant_id from sellertray_feedback_fixture),
    (select feedback_id from sellertray_feedback_fixture),
    'reviewing',
    'Follow-up started'
  )->>'status',
  'reviewing',
  'manager can start feedback review'
);

reset role;
select extensions.is(
  (select status from public.sellertray_feedback where id=(select feedback_id from sellertray_feedback_fixture)),
  'reviewing',
  'feedback status moves to reviewing'
);
select extensions.ok(
  (select reviewed_at is not null from public.sellertray_feedback where id=(select feedback_id from sellertray_feedback_fixture)),
  'starting review records review time'
);
select extensions.is(
  (select admin_note from public.sellertray_feedback where id=(select feedback_id from sellertray_feedback_fixture)),
  'Follow-up started',
  'management note is preserved'
);
select extensions.is(
  (select count(*) from public.sellertray_feedback_management_events where feedback_id=(select feedback_id from sellertray_feedback_fixture)),
  1::bigint,
  'starting review appends one management audit event'
);
select extensions.is(
  (select actor_user_id from public.sellertray_feedback_management_events where feedback_id=(select feedback_id from sellertray_feedback_fixture) order by created_at desc,id desc limit 1),
  (select manager_id from sellertray_feedback_fixture),
  'management audit records the manager actor'
);

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from sellertray_feedback_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
select extensions.is(
  public.manage_sellertray_feedback(
    (select tenant_id from sellertray_feedback_fixture),
    (select feedback_id from sellertray_feedback_fixture),
    'resolved',
    'Follow-up completed'
  )->>'status',
  'resolved',
  'owner can resolve feedback'
);

reset role;
select extensions.ok(
  (select resolved_at is not null from public.sellertray_feedback where id=(select feedback_id from sellertray_feedback_fixture)),
  'resolving feedback records resolution time'
);
select extensions.is(
  (select count(*) from public.sellertray_feedback_management_events where feedback_id=(select feedback_id from sellertray_feedback_fixture)),
  2::bigint,
  'resolving feedback appends a second management audit event'
);
select extensions.is(
  (select actor_user_id from public.sellertray_feedback_management_events where feedback_id=(select feedback_id from sellertray_feedback_fixture) and to_status='resolved' order by created_at desc,id desc limit 1),
  (select owner_id from sellertray_feedback_fixture),
  'resolution audit records the owner actor'
);

set local role authenticated;
select set_config('request.jwt.claim.sub',(select staff_id::text from sellertray_feedback_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);
select extensions.throws_ok(
  format(
    'select public.manage_sellertray_feedback(%L::uuid,%L::uuid,''resolved'',null)',
    (select tenant_id::text from sellertray_feedback_fixture),
    (select feedback_id::text from sellertray_feedback_fixture)
  ),
  '42501',
  'Only an Owner or Manager can manage feedback for this business',
  'staff cannot manage feedback'
);
select extensions.throws_ok(
  format('select public.get_sellertray_feedback_dashboard(%L::uuid,100)',(select tenant_id::text from sellertray_feedback_fixture)),
  '42501',
  'Only an Owner or Manager can view feedback for this business',
  'staff cannot open the management feedback dashboard'
);

select set_config('request.jwt.claim.sub',(select outsider_id::text from sellertray_feedback_fixture),true);
select extensions.throws_ok(
  format('select public.sellertray_feedback_state(%L::uuid)',(select tenant_id::text from sellertray_feedback_fixture)),
  '42501',
  'You do not have access to this business',
  'non-member cannot inspect business feedback state'
);
select extensions.throws_ok(
  format(
    'select public.submit_sellertray_feedback(%L::uuid,null,''general'',5::smallint,''No access'',null,null,''{}''::jsonb)',
    (select tenant_id::text from sellertray_feedback_fixture)
  ),
  '42501',
  'You do not have access to this business',
  'non-member cannot submit business feedback'
);
select extensions.throws_ok(
  format('select public.get_sellertray_feedback_dashboard(%L::uuid,100)',(select tenant_id::text from sellertray_feedback_fixture)),
  '42501',
  'Only an Owner or Manager can view feedback for this business',
  'non-member cannot open the management feedback dashboard'
);
select extensions.throws_ok(
  format(
    'select public.manage_sellertray_feedback(%L::uuid,%L::uuid,''resolved'',null)',
    (select tenant_id::text from sellertray_feedback_fixture),
    (select feedback_id::text from sellertray_feedback_fixture)
  ),
  '42501',
  'Only an Owner or Manager can manage feedback for this business',
  'non-member cannot manage business feedback'
);

select set_config('request.jwt.claim.sub',(select owner_id::text from sellertray_feedback_fixture),true);
select extensions.throws_ok(
  format(
    'select public.manage_sellertray_feedback(%L::uuid,%L::uuid,''reviewing'',null)',
    (select tenant_id::text from sellertray_feedback_fixture),
    (select feedback_id::text from sellertray_feedback_fixture)
  ),
  '22023',
  'Resolved feedback cannot return to review',
  'resolved feedback cannot regress to reviewing'
);

reset role;
select * from extensions.finish();
rollback;
