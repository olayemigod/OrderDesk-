begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(18);

select extensions.is(
  (select count(*)::integer from public.sellertray_installment_schedule_templates
   where template_code in ('two_installment_70_30','three_installment_60_20_20') and version=1),
  2,
  'OA2 preserves both approved C1B installment structures as governed templates'
);

select extensions.is(
  (select sum(l.percentage)::numeric
   from public.sellertray_installment_schedule_template_lines l
   join public.sellertray_installment_schedule_templates t on t.id=l.template_id
   where t.template_code='two_installment_70_30' and t.version=1),
  100::numeric,
  '70 / 30 template reconciles to 100 percent'
);

select extensions.is(
  (select count(*)::integer
   from public.sellertray_installment_schedule_template_lines l
   join public.sellertray_installment_schedule_templates t on t.id=l.template_id
   where t.template_code='three_installment_60_20_20' and t.version=1),
  3,
  '60 / 20 / 20 remains a three-line template'
);

select extensions.is(
  (public.resolve_sellertray_installment_policy(null,null,null,'yearly',now())->>'enabled')::boolean,
  true,
  'yearly installment availability is preserved as the initial governed default'
);

select extensions.is(
  (public.resolve_sellertray_installment_policy(null,null,null,'monthly',now())->>'enabled')::boolean,
  false,
  'monthly installments are disabled by policy rather than hard-coded runtime logic'
);

select extensions.ok(
  has_function_privilege('service_role','public.get_sellertray_commercial_settlement_state(uuid,uuid)','EXECUTE'),
  'service role can read the shared OA2 settlement projection'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.get_sellertray_commercial_settlement_state(uuid,uuid)','EXECUTE'),
  'merchant clients cannot bypass governed settlement wrappers'
);

select extensions.ok(
  has_function_privilege('service_role','public.record_sellertray_commercial_adjustment_internal(uuid,uuid,uuid,numeric,text,jsonb,uuid)','EXECUTE'),
  'service role can append an audited commercial adjustment through the internal authority'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.record_sellertray_commercial_adjustment_internal(uuid,uuid,uuid,numeric,text,jsonb,uuid)','EXECUTE'),
  'authenticated clients cannot directly append commercial adjustments'
);

select extensions.ok(
  has_function_privilege('service_role','public.record_sellertray_commercial_direct_payment_internal(uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb,uuid)','EXECUTE'),
  'service role can append a governed direct payment without manufacturing a provider event'
);

select extensions.ok(
  not has_function_privilege('authenticated','public.record_sellertray_commercial_direct_payment_internal(uuid,uuid,uuid,text,text,numeric,timestamptz,text,jsonb,uuid)','EXECUTE'),
  'authenticated clients cannot directly append direct-payment confirmations'
);

select extensions.ok(
  position(
    'superseded' in lower((
      select pg_get_constraintdef(c.oid)
      from pg_constraint c
      where c.conrelid='public.billing_checkout_sessions'::regclass
        and c.conname='billing_checkout_sessions_status_check'
    ))
  ) > 0,
  'checkout status authority includes terminal superseded state for stale attempts'
);

select extensions.ok(
  position(
    'rows between unbounded preceding and 1 preceding' in
    lower(pg_get_functiondef('public.get_sellertray_commercial_settlement_state(uuid,uuid)'::regprocedure))
  ) > 0,
  'settlement allocation is server-owned and deterministic in schedule sequence order'
);

select extensions.ok(
  (select c.relrowsecurity from pg_class c where c.oid='public.sellertray_commercial_adjustments'::regclass),
  'commercial adjustments are protected by RLS in addition to function privileges'
);

select extensions.ok(
  (select c.relrowsecurity from pg_class c where c.oid='public.sellertray_commercial_direct_payment_confirmations'::regclass),
  'direct-payment facts are protected by RLS in addition to function privileges'
);

-- A non-preset schedule can be introduced without changing client code. The
-- deferred validator proves a 50:50 structure is representable and valid.
insert into public.sellertray_installment_schedule_templates(
  template_code,version,display_name,status,provisional_entitlement_months,
  qualifying_settlement_sequence,effective_from,change_reason
) values (
  'test_two_installment_50_50',1,'50 / 50','published',1,1,now(),'pgTAP custom schedule representability check'
);
insert into public.sellertray_installment_schedule_template_lines(template_id,sequence_no,percentage)
select id,1,50 from public.sellertray_installment_schedule_templates
where template_code='test_two_installment_50_50' and version=1
union all
select id,2,50 from public.sellertray_installment_schedule_templates
where template_code='test_two_installment_50_50' and version=1;
set constraints validate_sellertray_installment_template_header, validate_sellertray_installment_template_line immediate;

select extensions.is(
  (select sum(l.percentage)::numeric
   from public.sellertray_installment_schedule_template_lines l
   join public.sellertray_installment_schedule_templates t on t.id=l.template_id
   where t.template_code='test_two_installment_50_50' and t.version=1),
  100::numeric,
  'custom 50 / 50 schedule validates without a schema or client release'
);

-- Installment availability can be disabled by appending policy. Existing policy
-- history remains present; resolution chooses the latest effective version.
insert into public.sellertray_installment_policy_versions(
  scope_kind,billing_cycle,enabled,default_template_id,effective_from,change_reason
) values (
  'platform','yearly',false,null,clock_timestamp()-interval '1 second','pgTAP global disable check'
);

select extensions.is(
  (public.resolve_sellertray_installment_policy(null,null,null,'yearly',now())->>'enabled')::boolean,
  false,
  'installments can be disabled by governed policy without deployment-time code changes'
);

select extensions.is(
  (select count(*)::integer
   from public.sellertray_installment_policy_versions
   where scope_kind='platform' and billing_cycle='yearly'),
  2,
  'disabling installments appends policy history instead of rewriting the previous commercial rule'
);

select * from extensions.finish();
rollback;
