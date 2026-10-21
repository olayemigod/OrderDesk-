-- Merchant Web QA Round 2: expose immutable sale/payment transaction rows on each cashier shift.
-- This is a read-model extension only. Payment, order, shift and ledger authorities remain unchanged.

create or replace function public.get_sellertray_cash_shift_management_detail(
  p_tenant_id uuid,
  p_shift_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_shift public.sellertray_cash_shifts%rowtype;
  v_totals record;
  v_branch_name text;
  v_register_name text;
  v_cashier_name text;
  v_movements jsonb;
  v_corrections jsonb;
  v_payment_summary jsonb;
  v_transactions jsonb;
  v_can_correct boolean := false;
  v_can_review boolean := false;
begin
  if v_user_id is null then
    raise exception 'SellerTray authentication required' using errcode = '42501';
  end if;

  select tm.role
    into v_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id
    and tm.user_id = v_user_id;

  if v_role not in ('owner', 'manager')
     or not public.sellertray_user_has_capability(p_tenant_id, v_user_id, 'can_view_reports') then
    raise exception 'Merchant Web cash management is available to Owners and Managers' using errcode = '42501';
  end if;

  select *
    into v_shift
  from public.sellertray_cash_shifts s
  where s.tenant_id = p_tenant_id
    and s.id = p_shift_id;

  if not found then
    raise exception 'Cashier shift not found' using errcode = 'P0002';
  end if;

  if not public.sellertray_user_can_read_branch(p_tenant_id, v_shift.branch_id, v_user_id) then
    raise exception 'You do not have access to this cashier shift' using errcode = '42501';
  end if;

  select b.name, r.name
    into v_branch_name, v_register_name
  from public.branches b
  join public.sellertray_registers r
    on r.tenant_id = b.tenant_id
   and r.branch_id = b.id
  where b.tenant_id = p_tenant_id
    and b.id = v_shift.branch_id
    and r.id = v_shift.register_id;

  select left(
    coalesce(
      nullif(
        btrim(
          regexp_replace(
            coalesce(
              u.raw_user_meta_data ->> 'full_name',
              u.raw_user_meta_data ->> 'name',
              u.email,
              'Cashier'
            ),
            '\s+',
            ' ',
            'g'
          )
        ),
        ''
      ),
      'Cashier'
    ),
    120
  )
    into v_cashier_name
  from auth.users u
  where u.id = v_shift.opened_by_user_id;

  v_cashier_name := coalesce(v_cashier_name, 'Cashier');

  select *
    into v_totals
  from public.sellertray_cash_shift_totals(p_tenant_id, p_shift_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'movementId', m.id,
        'movementType', m.movement_type,
        'amount', m.amount,
        'currency', m.currency,
        'reference', m.reference,
        'reason', m.reason,
        'expenseCategory', m.expense_category,
        'actorUserId', m.actor_user_id,
        'actorName', left(
          coalesce(
            nullif(
              btrim(
                regexp_replace(
                  coalesce(
                    au.raw_user_meta_data ->> 'full_name',
                    au.raw_user_meta_data ->> 'name',
                    au.email,
                    'Team member'
                  ),
                  '\s+',
                  ' ',
                  'g'
                )
              ),
              ''
            ),
            'Team member'
          ),
          120
        ),
        'createdAt', m.created_at,
        'replacementForCorrectionId', rc.id,
        'correctionReason', rc.reason
      )
      order by m.created_at desc, m.id desc
    ),
    '[]'::jsonb
  )
    into v_movements
  from public.sellertray_shift_cash_movements m
  left join auth.users au on au.id = m.actor_user_id
  left join public.sellertray_shift_cash_movement_corrections rc
    on rc.tenant_id = m.tenant_id
   and rc.replacement_movement_id = m.id
  where m.tenant_id = p_tenant_id
    and m.shift_id = p_shift_id
    and m.superseded_at is null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'correctionId', c.id,
        'correctionKind', c.correction_kind,
        'reason', c.reason,
        'actorUserId', c.actor_user_id,
        'actorName', left(
          coalesce(
            nullif(
              btrim(
                regexp_replace(
                  coalesce(
                    au.raw_user_meta_data ->> 'full_name',
                    au.raw_user_meta_data ->> 'name',
                    au.email,
                    'Team member'
                  ),
                  '\s+',
                  ' ',
                  'g'
                )
              ),
              ''
            ),
            'Team member'
          ),
          120
        ),
        'originalMovementId', c.original_movement_id,
        'replacementMovementId', c.replacement_movement_id,
        'createdAt', c.created_at
      )
      order by c.created_at desc, c.id desc
    ),
    '[]'::jsonb
  )
    into v_corrections
  from public.sellertray_shift_cash_movement_corrections c
  left join auth.users au on au.id = c.actor_user_id
  where c.tenant_id = p_tenant_id
    and c.shift_id = p_shift_id;

  v_payment_summary := public.get_sellertray_shift_payment_summary(p_tenant_id, p_shift_id);

  select coalesce(
    jsonb_agg(t.payload order by t.business_at desc, t.order_id desc),
    '[]'::jsonb
  )
    into v_transactions
  from (
    select
      p.order_id,
      p.business_at,
      jsonb_build_object(
        'orderId', o.id,
        'reference', coalesce(nullif(o.public_order_id, ''), upper(left(o.id::text, 8))),
        'customerName', coalesce(nullif(c.display_name, ''), 'Walk-in customer'),
        'source', coalesce(nullif(o.source, ''), 'pos'),
        'status', coalesce(nullif(o.status, ''), 'unknown'),
        'paymentStatus', coalesce(nullif(o.payment_status, ''), 'unknown'),
        'paymentMethods', p.payment_methods,
        'subtotalAmount', coalesce(o.subtotal_amount, o.total_amount, 0),
        'taxAmount', coalesce(o.tax_amount, 0),
        'totalAmount', coalesce(o.gross_amount, o.total_amount, 0),
        'amountPaid', coalesce(o.amount_paid, p.captured_amount, 0),
        'capturedInShift', p.captured_amount,
        'outstandingAmount', greatest(
          coalesce(o.gross_amount, o.total_amount, 0) - coalesce(o.amount_paid, p.captured_amount, 0),
          0
        ),
        'currency', coalesce(nullif(o.currency, ''), v_shift.currency),
        'operatorName', coalesce(nullif(o.pos_operator_name, ''), v_cashier_name),
        'businessAt', p.business_at,
        'createdAt', o.created_at
      ) as payload
    from (
      select
        sp.order_id,
        max(sp.business_at) as business_at,
        coalesce(sum(sp.amount), 0) as captured_amount,
        string_agg(
          distinct coalesce(
            nullif(sp.display_name, ''),
            initcap(replace(coalesce(sp.method_type, sp.method_key, 'payment'), '_', ' '))
          ),
          ', '
          order by coalesce(
            nullif(sp.display_name, ''),
            initcap(replace(coalesce(sp.method_type, sp.method_key, 'payment'), '_', ' '))
          )
        ) as payment_methods
      from public.sellertray_shift_payments sp
      where sp.tenant_id = p_tenant_id
        and sp.shift_id = p_shift_id
      group by sp.order_id
    ) p
    join public.orders o
      on o.tenant_id = p_tenant_id
     and o.id = p.order_id
    left join public.customers c
      on c.tenant_id = o.tenant_id
     and c.id = o.customer_id
  ) t;

  v_can_correct := v_shift.status = 'open'
    and public.orderdesk_subscription_can_write(p_tenant_id)
    and public.sellertray_user_can_operate_branch(p_tenant_id, v_shift.branch_id, v_user_id)
    and public.sellertray_user_has_capability(p_tenant_id, v_user_id, 'can_correct_cash_movement');

  v_can_review := v_shift.status = 'closed'
    and public.orderdesk_subscription_can_write(p_tenant_id)
    and public.sellertray_user_can_operate_branch(p_tenant_id, v_shift.branch_id, v_user_id)
    and public.sellertray_user_has_capability(p_tenant_id, v_user_id, 'can_review_shift');

  return jsonb_build_object(
    'shiftId', v_shift.id,
    'branchId', v_shift.branch_id,
    'branchName', v_branch_name,
    'registerId', v_shift.register_id,
    'registerName', v_register_name,
    'status', v_shift.status,
    'currency', v_shift.currency,
    'cashierUserId', v_shift.opened_by_user_id,
    'cashierName', v_cashier_name,
    'openingCash', v_totals.opening_cash,
    'cashSales', v_totals.cash_sales,
    'cashRefunds', v_totals.cash_refunds,
    'cashIn', v_totals.cash_in,
    'cashOut', v_totals.cash_out,
    'expenses', v_totals.expenses,
    'expectedCash', case when v_shift.status = 'open' then v_totals.expected_cash else v_shift.expected_cash end,
    'declaredCash', v_shift.declared_cash,
    'variance', v_shift.variance,
    'closeNote', v_shift.close_note,
    'reviewDecision', v_shift.review_decision,
    'reviewNote', v_shift.review_note,
    'openedAt', v_shift.opened_at,
    'closedAt', v_shift.closed_at,
    'reviewedAt', v_shift.reviewed_at,
    'movements', v_movements,
    'corrections', v_corrections,
    'paymentSummary', v_payment_summary,
    'transactions', v_transactions,
    'canCorrect', v_can_correct,
    'canReview', v_can_review
  );
end;
$function$;

comment on function public.get_sellertray_cash_shift_management_detail(uuid, uuid)
is 'Owner/Manager shift reconciliation detail, including immutable shift-payment-backed sale transaction rows.';
