-- Disposable network-none restored database only. No persistent fixture.
-- Reuse the canonical synthetic commerce fixture from the existing pgTAP test.
BEGIN;
DO $$
BEGIN
 IF (SELECT count(*) FROM auth.users)<>5 OR
    (SELECT count(*) FROM auth.sessions)<>5 OR
    (SELECT count(*) FROM public.tenants)<>0 OR
    (SELECT count(*) FROM public.tenant_members)<>0 OR
    (SELECT count(*) FROM supabase_migrations.schema_migrations)<>54 OR
    current_setting('cron.launch_active_jobs',true) IS DISTINCT FROM 'off'
 THEN RAISE EXCEPTION 'Unexpected reconstructed local baseline'; END IF;
END $$;
CREATE TEMP TABLE retained_cohort ON COMMIT DROP AS SELECT id,email FROM auth.users;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.tenant_members t JOIN retained_cohort h ON h.id=t.user_id)
 OR EXISTS(SELECT 1 FROM public.branch_user_access t JOIN retained_cohort h ON h.id=t.user_id)
 OR EXISTS(SELECT 1 FROM public.tenant_member_capabilities t JOIN retained_cohort h ON h.id=t.user_id)
 OR EXISTS(SELECT 1 FROM public.platform_admins t JOIN retained_cohort h ON h.id=t.user_id)
 OR EXISTS(SELECT 1 FROM public.platform_admin_capability_grant_versions t JOIN retained_cohort h ON h.id=t.grantee_user_id)
 OR EXISTS(SELECT 1 FROM public.sellertray_internal_setup_staff t JOIN retained_cohort h ON h.id=t.user_id)
 OR EXISTS(SELECT 1 FROM public.sellertray_internal_setup_staff_assignments t JOIN retained_cohort h ON h.id=t.staff_user_id)
 OR EXISTS(SELECT 1 FROM public.sellertray_internal_setup_invitation_reservations t JOIN retained_cohort h ON t.auth_user_id=h.id OR t.email_normalized=lower(btrim(h.email)))
 THEN RAISE EXCEPTION 'Historical authority remains'; END IF;
 RAISE NOTICE 'All eight retained-cohort authority categories: zero';
 PERFORM set_config('oa5.retained_ids',(SELECT jsonb_agg(id ORDER BY id)::text FROM retained_cohort),true);
END $$;
create temp table oa5_quarantine_fixture(
  tenant_id uuid not null default gen_random_uuid(),
  owner_id uuid not null default gen_random_uuid(),
  branch_id uuid,
  customer_id uuid not null default gen_random_uuid(),
  order_id uuid not null default gen_random_uuid()
) on commit drop;
insert into oa5_quarantine_fixture default values;

insert into auth.users(id,email,aud,role,created_at,updated_at)
select owner_id,'oa5-quarantine-owner-'||left(owner_id::text,8)||'@example.com',
       'authenticated','authenticated',now(),now()
from oa5_quarantine_fixture;

insert into public.tenants(id,name,slug,merchant_code,subscription_status)
select tenant_id,'OA5 synthetic quarantine merchant',
       'oa5-quarantine-'||left(tenant_id::text,8),'O5Q','active'
from oa5_quarantine_fixture;

insert into public.tenant_members(tenant_id,user_id,role)
select tenant_id,owner_id,'owner'
from oa5_quarantine_fixture;

update oa5_quarantine_fixture f
set branch_id=b.id
from public.branches b
where b.tenant_id=f.tenant_id and b.is_default=true;

update public.tenant_subscriptions s
set status='active',trial_ends_at=null,grace_ends_at=null
from oa5_quarantine_fixture f where s.tenant_id=f.tenant_id;

insert into public.customers(id,tenant_id,wa_id,display_name,phone)
select customer_id,tenant_id,
       '2348000000981','OA5 Synthetic Customer','2348000000981'
from oa5_quarantine_fixture;

insert into public.orders(id,tenant_id,branch_id,customer_id,status,source,
                          customer_note,parser_source,review_reasons,currency,total_amount)
select order_id,tenant_id,branch_id,customer_id,
       'needs_review','manual','OA5 synthetic quarantine sale',
       'manual','{}'::text[],'NGN',1200
from oa5_quarantine_fixture;


DO $$
DECLARE f record;
BEGIN
 SELECT * INTO STRICT f FROM oa5_quarantine_fixture;
 PERFORM set_config('oa5.test_tenant',f.tenant_id::text,true);
 PERFORM set_config('oa5.test_branch',f.branch_id::text,true);
 PERFORM set_config('oa5.test_customer',f.customer_id::text,true);
 PERFORM set_config('oa5.test_order',f.order_id::text,true);
 PERFORM set_config('oa5.test_owner',f.owner_id::text,true);
 PERFORM set_config('request.jwt.claim.sub',f.owner_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE actor text; checked integer:=0; changed integer;
 t uuid:=current_setting('oa5.test_tenant')::uuid;
 b uuid:=current_setting('oa5.test_branch')::uuid;
 c uuid:=current_setting('oa5.test_customer')::uuid;
 o uuid:=current_setting('oa5.test_order')::uuid;
BEGIN
 IF current_user<>'authenticated' OR auth.uid() IS DISTINCT FROM current_setting('oa5.test_owner')::uuid
 OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=t)
 OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=b)
 OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=c)
 OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=o)
 THEN RAISE EXCEPTION 'Synthetic owner read positive control failed'; END IF;
 FOR actor IN SELECT jsonb_array_elements_text(current_setting('oa5.retained_ids')::jsonb)
 LOOP
  PERFORM set_config('request.jwt.claim.sub',actor,true);
  IF auth.uid() IS DISTINCT FROM actor::uuid
  OR EXISTS(SELECT 1 FROM public.tenants WHERE id=t)
  OR EXISTS(SELECT 1 FROM public.branches WHERE id=b)
  OR EXISTS(SELECT 1 FROM public.customers WHERE id=c)
  OR EXISTS(SELECT 1 FROM public.orders WHERE id=o)
  OR EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=t)
  OR public.sellertray_current_user_can_read_branch(t,b) IS DISTINCT FROM false
  OR public.sellertray_current_user_can_access_branch(t,b) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'Retained actor read/branch denial failed'; END IF;
  BEGIN
   UPDATE public.orders SET customer_note='OA5 forbidden update' WHERE id=o;
   GET DIAGNOSTICS changed=ROW_COUNT;
   IF changed<>0 THEN RAISE EXCEPTION 'Retained actor order write succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  checked:=checked+1;
 END LOOP;
 IF checked<>5 THEN RAISE EXCEPTION 'Incomplete cohort'; END IF;
 PERFORM set_config('request.jwt.claim.sub',current_setting('oa5.test_owner'),true);
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=o AND customer_note='OA5 synthetic quarantine sale')
 THEN RAISE EXCEPTION 'Owner restoration or order integrity failed'; END IF;
 RAISE NOTICE 'Five retained actors: merchant/branch/customer/order read and order write denial PASS';
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'LOCAL_RETAINED_AUTH_QUARANTINE=PASS' AS result;
