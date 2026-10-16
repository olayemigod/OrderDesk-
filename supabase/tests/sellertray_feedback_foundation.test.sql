begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

create temp table sellertray_feedback_fixture(
  tenant_id uuid not null,
  user_id uuid not null,
  outsider_id uuid not null,
  feedback_id uuid
) on commit drop;

insert into sellertray_feedback_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null);

insert into auth.users(id,email,aud,role,created_at,updated_at)
select user_id,'feedback-owner-'||substr(user_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_feedback_fixture
union all
select outsider_id,'feedback-outsider-'||substr(outsider_id::text,1,8)||'@example.com','authenticated','authenticated',now(),now()
from sellertray_feedback_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'SellerTray Feedback Test','feedback-'||substr(tenant_id::text,1,8),'FBT','active'
from sellertray_feedback_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,user_id,'owner' from sellertray_feedback_fixture;

select extensions.has_table('public','sellertray_feedback','feedback table exists');
select extensions.has_function('public','submit_sellertray_feedback',array['uuid','uuid','text','smallint','text','text','text','jsonb'],'feedback submission command exists');
select extensions.has_function('public','sellertray_feedback_state',array['uuid'],'feedback state command exists');

grant select,update on sellertray_feedback_fixture to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from sellertray_feedback_fixture),true);
select set_config('request.jwt.claim.role','authenticated',true);

update sellertray_feedback_fixture
set feedback_id=public.submit_sellertray_feedback(
  tenant_id,null,'experience',5,'SellerTray works well for this workflow.','1.0.0','android','{"surface":"more"}'::jsonb
);

select extensions.ok((select feedback_id is not null from sellertray_feedback_fixture),'signed-in member can submit feedback');
select extensions.ok((public.sellertray_feedback_state((select tenant_id from sellertray_feedback_fixture))->>'hasSubmitted')::boolean,'app can tell that the current user has submitted feedback');
select extensions.is((public.sellertray_feedback_state((select tenant_id from sellertray_feedback_fixture))->>'submissionCount')::integer,1,'feedback state reports the current user submission count');

select set_config('request.jwt.claim.sub',(select outsider_id::text from sellertray_feedback_fixture),true);
select extensions.throws_ok(
  format('select public.sellertray_feedback_state(%L::uuid)',(select tenant_id from sellertray_feedback_fixture)),
  '42501',
  'You do not have access to this business',
  'non-member cannot inspect business feedback state'
);
select extensions.throws_ok(
  format(
    'select public.submit_sellertray_feedback(%L::uuid,null,''general'',5,''No access'',null,null,''{}''::jsonb)',
    (select tenant_id from sellertray_feedback_fixture)
  ),
  '42501',
  'You do not have access to this business',
  'non-member cannot submit business feedback'
);

reset role;
select * from extensions.finish();
rollback;
