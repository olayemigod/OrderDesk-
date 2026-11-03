begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

select extensions.ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sellertray_commercial_adjustments' and column_name='discount_input_type'),
  'commercial adjustments preserve discount input type'
);
select extensions.ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sellertray_commercial_adjustments' and column_name='discount_input_value'),
  'commercial adjustments preserve authored discount value'
);
select extensions.ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sellertray_commercial_adjustments' and column_name='discount_calculation_base_amount'),
  'commercial adjustments preserve authoritative calculation base'
);
select extensions.ok(
  has_function_privilege('service_role','public.platform_admin_record_commercial_discount(uuid,uuid,uuid,uuid,text,numeric,text,jsonb)','EXECUTE'),
  'service role can call governed Admin discount authority'
);
select extensions.ok(
  not has_function_privilege('authenticated','public.platform_admin_record_commercial_discount(uuid,uuid,uuid,uuid,text,numeric,text,jsonb)','EXECUTE'),
  'authenticated clients cannot bypass Admin discount authority'
);
select extensions.ok(
  position('admin.pricing.manage' in lower(pg_get_functiondef('public.platform_admin_record_commercial_discount(uuid,uuid,uuid,uuid,text,numeric,text,jsonb)'::regprocedure))) > 0,
  'discount authority requires pricing-management capability'
);
select extensions.ok(
  position('total_gross_amount * v_discount_value / 100' in lower(pg_get_functiondef('public.record_sellertray_commercial_discount_internal(uuid,uuid,uuid,text,numeric,text,jsonb,uuid)'::regprocedure))) > 0,
  'percentage discount is derived server-side from immutable order gross'
);
select extensions.ok(
  position('percentage' in lower(pg_get_functiondef('public.record_sellertray_commercial_discount_internal(uuid,uuid,uuid,text,numeric,text,jsonb,uuid)'::regprocedure))) > 0
  and position('100' in pg_get_functiondef('public.record_sellertray_commercial_discount_internal(uuid,uuid,uuid,text,numeric,text,jsonb,uuid)'::regprocedure)) > 0,
  'percentage discount is bounded at 100 percent'
);
select extensions.ok(
  position('below confirmed payments' in lower(pg_get_functiondef('public.record_sellertray_commercial_discount_internal(uuid,uuid,uuid,text,numeric,text,jsonb,uuid)'::regprocedure))) > 0,
  'discount fails closed when it would undercut confirmed payment facts'
);
select extensions.ok(
  position('supersede_sellertray_stale_installment_checkouts' in lower(pg_get_functiondef('public.record_sellertray_commercial_discount_internal(uuid,uuid,uuid,text,numeric,text,jsonb,uuid)'::regprocedure))) > 0,
  'discount supersedes stale installment checkout reservations'
);
select extensions.ok(
  position('discounttype' in lower(pg_get_functiondef('public.platform_admin_record_commercial_discount(uuid,uuid,uuid,uuid,text,numeric,text,jsonb)'::regprocedure))) > 0
  and position('calculationbaseamount' in lower(pg_get_functiondef('public.platform_admin_record_commercial_discount(uuid,uuid,uuid,uuid,text,numeric,text,jsonb)'::regprocedure))) > 0,
  'audit detail records authored type, value and calculation base'
);
select extensions.ok(
  position('discountinputtype' in lower(pg_get_functiondef('public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)'::regprocedure))) > 0
  and position('discountinputvalue' in lower(pg_get_functiondef('public.get_sellertray_commercial_settlement_detail_internal(uuid,uuid)'::regprocedure))) > 0,
  'shared settlement detail exposes authored discount metadata'
);
select extensions.ok(
  to_regprocedure('public.platform_admin_record_commercial_adjustment(uuid,uuid,uuid,uuid,numeric,text,jsonb)') is not null,
  'legacy amount-only adjustment authority remains available for rolling compatibility'
);
select extensions.ok(
  position('command id was already used with different input' in lower(pg_get_functiondef('public.record_sellertray_commercial_discount_internal(uuid,uuid,uuid,text,numeric,text,jsonb,uuid)'::regprocedure))) > 0,
  'discount command replay is payload-sensitive and idempotent'
);

select * from extensions.finish();
rollback;
