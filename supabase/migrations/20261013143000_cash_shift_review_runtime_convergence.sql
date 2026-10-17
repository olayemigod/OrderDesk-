begin;

-- Restore the governed cashier review command when an environment has the
-- cashier schema and other write commands but missed this RPC during schema
-- convergence. Mutations remain service-role only and enforce branch access
-- plus SellerTray capability checks inside the shared database boundary.
create or replace function public.review_sellertray_cash_shift(
  p_tenant_id uuid,
  p_shift_id uuid,
  p_decision text,
  p_note text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shift public.sellertray_cash_shifts%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision,'')));
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if p_tenant_id is null or p_shift_id is null or p_actor_user_id is null
     or v_decision not in ('accepted','follow_up') then
    raise exception 'Shift, review decision and reviewer are required' using errcode='22023';
  end if;
  if v_decision='follow_up' and v_note is null then
    raise exception 'Enter a note for a shift that needs follow-up' using errcode='22023';
  end if;
  if v_note is not null and char_length(v_note)>500 then
    raise exception 'Shift review note is too long' using errcode='22023';
  end if;

  select * into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id=p_tenant_id and s.id=p_shift_id
  for update;
  if not found then
    raise exception 'Cashier shift not found' using errcode='22023';
  end if;

  if not public.sellertray_user_can_operate_branch(
    p_tenant_id,v_shift.branch_id,p_actor_user_id
  ) then
    raise exception 'You do not have access to review this cashier shift' using errcode='42501';
  end if;
  if not public.sellertray_user_has_capability(
    p_tenant_id,p_actor_user_id,'can_review_shift'
  ) then
    raise exception 'You do not have permission to review cashier shifts' using errcode='42501';
  end if;

  if v_shift.status='reviewed' then
    if v_shift.review_decision<>v_decision or v_shift.review_note is distinct from v_note then
      raise exception 'This cashier shift was already reviewed with a different decision' using errcode='23505';
    end if;
    return jsonb_build_object(
      'shiftId',p_shift_id,
      'status','reviewed',
      'decision',v_shift.review_decision,
      'idempotentReplay',true
    );
  end if;

  if v_shift.status<>'closed' then
    raise exception 'Close the cashier shift before manager review' using errcode='23514';
  end if;

  update public.sellertray_cash_shifts
  set status='reviewed',
      review_decision=v_decision,
      review_note=v_note,
      reviewed_by_user_id=p_actor_user_id,
      reviewed_at=now(),
      updated_at=now()
  where tenant_id=p_tenant_id and id=p_shift_id;

  return jsonb_build_object(
    'shiftId',p_shift_id,
    'status','reviewed',
    'decision',v_decision,
    'idempotentReplay',false
  );
end;
$$;

revoke all on function public.review_sellertray_cash_shift(uuid,uuid,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.review_sellertray_cash_shift(uuid,uuid,text,text,uuid)
  to service_role;

commit;
