begin;
select plan(9);

select ok(position('orderdesk_subscription_can_write' in pg_get_functiondef('public.invite_orderdesk_team_member(uuid,uuid,text,text)'::regprocedure))>0,'team invite enforces subscription writability internally');
select ok(position('orderdesk_subscription_can_write' in pg_get_functiondef('public.change_orderdesk_team_member(uuid,uuid,uuid,text,text)'::regprocedure))>0,'team membership changes enforce subscription writability internally');
select ok(position('orderdesk_subscription_can_write' in pg_get_functiondef('public.cancel_orderdesk_team_invitation(uuid,uuid,uuid)'::regprocedure))>0,'invitation cancellation enforces subscription writability internally');
select ok(not has_function_privilege('authenticated','public.invite_orderdesk_team_member(uuid,uuid,text,text)','EXECUTE'),'authenticated clients cannot directly invoke team invitation mutation');
select ok(not has_function_privilege('authenticated','public.change_orderdesk_team_member(uuid,uuid,uuid,text,text)','EXECUTE'),'authenticated clients cannot directly invoke team membership mutation');
select ok(not has_function_privilege('authenticated','public.cancel_orderdesk_team_invitation(uuid,uuid,uuid)','EXECUTE'),'authenticated clients cannot directly invoke invitation cancellation');
select ok(has_function_privilege('service_role','public.invite_orderdesk_team_member(uuid,uuid,text,text)','EXECUTE'),'service boundary can invoke team invitation mutation');
select ok(has_function_privilege('service_role','public.change_orderdesk_team_member(uuid,uuid,uuid,text,text)','EXECUTE'),'service boundary can invoke team membership mutation');
select ok(has_function_privilege('service_role','public.cancel_orderdesk_team_invitation(uuid,uuid,uuid)','EXECUTE'),'service boundary can invoke invitation cancellation');

select * from finish();
rollback;
