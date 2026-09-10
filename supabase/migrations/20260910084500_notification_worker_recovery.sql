create or replace function public.claim_outbound_notifications(p_limit integer default 20)
returns setof public.outbound_notifications
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.outbound_notifications
  set delivery_status = 'failed',
      last_error = coalesce(last_error, 'Worker lease expired before delivery completed'),
      available_at = now(),
      updated_at = now()
  where delivery_status = 'sending'
    and updated_at < now() - interval '10 minutes';

  update public.outbound_notifications
  set delivery_status = 'template_required',
      updated_at = now()
  where delivery_status in ('pending', 'failed')
    and conversation_window_expires_at is not null
    and conversation_window_expires_at <= now();

  return query
  with candidates as (
    select n.id
    from public.outbound_notifications n
    where n.delivery_status in ('pending', 'failed')
      and n.attempt_count < 3
      and n.available_at <= now()
      and n.conversation_window_expires_at is not null
      and n.conversation_window_expires_at > now()
    order by n.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  )
  update public.outbound_notifications n
  set delivery_status = 'sending',
      attempt_count = n.attempt_count + 1,
      updated_at = now()
  from candidates c
  where n.id = c.id
  returning n.*;
end;
$$;

revoke all on function public.claim_outbound_notifications(integer) from public;
revoke all on function public.claim_outbound_notifications(integer) from anon;
revoke all on function public.claim_outbound_notifications(integer) from authenticated;
grant execute on function public.claim_outbound_notifications(integer) to service_role;
