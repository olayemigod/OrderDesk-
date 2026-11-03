begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(27);

-- C2 schedule choices are immutable policy-version data. Legacy C1 policies
-- retain the same table and earlier resolution contract without intermixing.
select extensions.ok(
  exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='sellertray_installment_policy_versions'
      and column_name='policy_context'),
  'C2 policy versions share the canonical policy store but have their own context'
);
select extensions.ok(
  not has_table_privilege('service_role','public.sellertray_installment_policy_allowed_templates','INSERT'),
  'Even the service gateway cannot directly append to a published policy allowed set'
);
select extensions.ok(
  to_regclass('public.sellertray_installment_policy_allowed_templates') is not null,
  'Allowed alternative schedules are a separate version-linked set'
);
select extensions.ok(
  (select c.relrowsecurity from pg_class c
   where c.oid='public.sellertray_installment_policy_allowed_templates'::regclass),
  'Allowed schedule set is protected by RLS'
);
select extensions.ok(
  not has_table_privilege('authenticated','public.sellertray_installment_policy_allowed_templates','INSERT'),
  'Merchant clients cannot publish alternative schedules'
);
select extensions.ok(
  exists(select 1 from pg_trigger t where t.tgrelid=
    'public.sellertray_installment_policy_allowed_templates'::regclass
    and t.tgname='prevent_sellertray_installment_policy_allowed_template_mutation'
    and not t.tgisinternal),
  'Allowed template memberships cannot be updated/deleted'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_installment_policy_versions
   where policy_context='branch_commercial_v2' and scope_kind='platform'
     and billing_cycle in ('monthly','yearly')),
  2,
  'Seeded C2 policies have independent monthly/yearly versions'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_installment_policy_versions
   where policy_context='legacy' and scope_kind='platform' and billing_cycle='yearly'),
  1,
  'C1 yearly version is retained without backfill or rewrite'
);
select extensions.is(
  (select count(*)::integer from public.sellertray_installment_policy_versions
   where policy_context='legacy' and scope_kind='platform' and billing_cycle='monthly'),
  1,
  'C1 monthly version is retained without backfill or rewrite'
);

select extensions.is(
  (public.resolve_sellertray_installment_policy(null,null,null,'yearly',now())->>'enabled')::boolean,
  true,
  'The C1 yearly default remains enabled'
);
select extensions.is(
  (public.resolve_sellertray_installment_policy(null,null,null,'monthly',now())->>'enabled')::boolean,
  false,
  'The C1 monthly policy remains disabled'
);
select extensions.is(
  (public.resolve_sellertray_installment_policy(null,null,null,'yearly',now())->>'defaultTemplateId')::uuid,
  (select id from public.sellertray_installment_schedule_templates
   where template_code='two_installment_70_30' and version=1),
  'C1 still resolves its original 70/30 policy by ID'
);
select extensions.is(
  (public.resolve_sellertray_installment_policy_v2(null,null,null,'yearly',now())->>'defaultTemplateId')::uuid,
  (select id from public.sellertray_installment_schedule_templates
   where template_code='full_payment_100' and version=1),
  'C2 yearly resolves 100 percent upfront by configured default ID'
);
select extensions.is(
  (public.resolve_sellertray_installment_policy_v2(null,null,null,'monthly',now())->>'defaultTemplateId')::uuid,
  (select id from public.sellertray_installment_schedule_templates
   where template_code='full_payment_100' and version=1),
  'C2 monthly resolves 100 percent upfront by configured default ID'
);
select extensions.is(
  (public.resolve_sellertray_installment_policy_v2(null,null,null,'monthly',now())->>'enabled')::boolean,
  false,
  'Monthly alternatives remain off by policy'
);
select extensions.is(
  jsonb_array_length(public.resolve_sellertray_installment_policy_v2(null,null,null,'monthly',now())->'allowedAlternativeTemplateIds'),
  0,
  'Monthly policy starts with no allowed alternatives'
);
select extensions.is(
  jsonb_array_length(public.resolve_sellertray_installment_policy_v2(null,null,null,'yearly',now())->'allowedAlternativeTemplateIds'),
  2,
  'Yearly alternatives include only two explicitly allowed published presets'
);
select extensions.ok(
  public.sellertray_c2_installment_template_allowed(
    public.resolve_sellertray_installment_policy_v2(null,null,null,'monthly',now()),
    (select id from public.sellertray_installment_schedule_templates
     where template_code='full_payment_100' and version=1)),
  'Configured default is eligible even when alternatives are disabled'
);
select extensions.ok(
  not public.sellertray_c2_installment_template_allowed(
    public.resolve_sellertray_installment_policy_v2(null,null,null,'monthly',now()),
    (select id from public.sellertray_installment_schedule_templates
     where template_code='two_installment_70_30' and version=1)),
  'A disabled monthly policy rejects an otherwise published 70/30 template'
);
select extensions.ok(
  public.sellertray_c2_installment_template_allowed(
    public.resolve_sellertray_installment_policy_v2(null,null,null,'yearly',now()),
    (select id from public.sellertray_installment_schedule_templates
     where template_code='three_installment_60_20_20' and version=1)),
  'An enabled yearly policy allows a specifically listed alternative'
);
select extensions.ok(
  not public.sellertray_c2_installment_template_allowed(
    public.resolve_sellertray_installment_policy_v2(null,null,null,'yearly',now()),
    gen_random_uuid()),
  'A random published/unpublished schedule ID does not bypass the allowed set'
);

-- Non-preset schedule names are ordinary data; changing the template_code
-- does not change eligibility or the expected line arithmetic.
insert into public.sellertray_installment_schedule_templates(
  template_code,version,display_name,status,provisional_entitlement_months,
  qualifying_settlement_sequence,effective_from,change_reason
) values (
  'c2_test_custom_45_55',1,'Custom 45 / 55','published',0,1,
  now()-interval '1 minute','pgTAP C2 custom schedule'
);
insert into public.sellertray_installment_schedule_template_lines(template_id,sequence_no,percentage,due_offset_days)
select t.id,1,45,0 from public.sellertray_installment_schedule_templates t
where t.template_code='c2_test_custom_45_55' and t.version=1
union all
select t.id,2,55,30 from public.sellertray_installment_schedule_templates t
where t.template_code='c2_test_custom_45_55' and t.version=1;
set constraints validate_sellertray_installment_template_header,
                validate_sellertray_installment_template_line immediate;

select extensions.ok(
  public.sellertray_c2_installment_template_allowed(
    jsonb_build_object('defaultTemplateId',
      (select id from public.sellertray_installment_schedule_templates
       where template_code='full_payment_100' and version=1),
      'enabled',true,'allowedAlternativeTemplateIds',
      jsonb_build_array((select id from public.sellertray_installment_schedule_templates
       where template_code='c2_test_custom_45_55' and version=1))),
    (select id from public.sellertray_installment_schedule_templates
     where template_code='c2_test_custom_45_55' and version=1)),
  'A custom 45/55 version can be explicitly allowed without a new runtime code branch'
);
select extensions.ok(
  not public.sellertray_c2_installment_template_allowed(
    public.resolve_sellertray_installment_policy_v2(null,null,null,'yearly',now()),
    (select id from public.sellertray_installment_schedule_templates
     where template_code='c2_test_custom_45_55' and version=1)),
  'A new published custom structure remains ineligible until a policy version allows it'
);
select extensions.ok(
  position('full_payment_100' in pg_get_functiondef(
    'public.create_sellertray_c2_branch_commercial_order(uuid,text,jsonb,text,uuid,text,uuid)'::regprocedure))=0,
  'C2 Branch order creation has no magic full-payment template-code conditional'
);
select extensions.ok(
  position('full_payment_100' in pg_get_functiondef(
    'public.validate_sellertray_branch_commercial_installment_policy()'::regprocedure))=0,
  'C2 Branch subject policy guard never authorizes by a template code'
);
select extensions.ok(
  position('full_payment_100' in pg_get_functiondef(
    'public.get_sellertray_installment_contract_checkout_policy(uuid,uuid,timestamptz)'::regprocedure))=0,
  'Checkout eligibility does not assign intrinsic eligibility to a template code'
);
select extensions.ok(
  not has_function_privilege('authenticated',
    'public.publish_sellertray_installment_policy_v2_admin(text,uuid,uuid,uuid,text,boolean,uuid,uuid[],timestamptz,timestamptz,text,uuid,uuid)',
    'EXECUTE'),
  'Only the platform service gateway can publish a new immutable installment policy version'
);

select * from extensions.finish();
rollback;
