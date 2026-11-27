-- Only for the already reconstructed, network-none disposable restore.
-- Run as postgres (not supabase_admin). No migration or ledger changes.
-- The scheduler must remain globally disabled in this local rehearsal.
BEGIN;
DO $$
BEGIN
 IF current_user <> 'postgres' OR inet_server_addr() IS NOT NULL
 OR current_setting('cron.launch_active_jobs',true) IS DISTINCT FROM 'off'
 OR (SELECT count(*) FROM public.tenants)<>0
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>54
 OR (SELECT count(*) FROM auth.users)<>5
 OR (SELECT count(*) FROM auth.sessions)<>5
 OR (SELECT count(*) FROM cron.job)<>5
 OR EXISTS(SELECT 1 FROM cron.job WHERE active OR username<>'postgres')
 OR (SELECT count(*) FROM cron.job WHERE jobname IN (
   'sellertray-prepare-usage-settlements','sellertray-whatsapp-notification-retry',
   'sellertray-merchant-push-retry','sellertray-agreement-package-retry',
   'sellertray-lifecycle-notifications'))<>5
 OR EXISTS(SELECT 1 FROM net.http_request_queue)
 THEN RAISE EXCEPTION 'Unexpected local canonical or scheduler baseline'; END IF;
END $$;
CREATE TEMP TABLE oa5_cron_before ON COMMIT DROP AS
 SELECT jobid,jobname,schedule,command,username,active FROM cron.job;
DO $$
DECLARE spec record; v_id bigint; lifecycle_id bigint;
BEGIN
 -- Mirror the named scheduling calls without executing their commands.
 FOR spec IN SELECT * FROM oa5_cron_before WHERE jobname IN (
   'sellertray-prepare-usage-settlements','sellertray-whatsapp-notification-retry',
   'sellertray-merchant-push-retry') ORDER BY jobid
 LOOP
   v_id:=cron.schedule(spec.jobname,spec.schedule,spec.command);
   IF v_id IS DISTINCT FROM spec.jobid THEN RAISE EXCEPTION 'Named job identity changed'; END IF;
   PERFORM cron.alter_job(v_id,active=>false);
   IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=v_id AND NOT active)
   THEN RAISE EXCEPTION 'Named job pause failed'; END IF;
 END LOOP;
 -- The hosted historical roster has no lifecycle job. Rehearse its creation
 -- path by removing the existing local canonical job inside this transaction.
 SELECT jobid INTO STRICT lifecycle_id FROM oa5_cron_before WHERE jobname='sellertray-lifecycle-notifications';
 PERFORM cron.unschedule(lifecycle_id);
 v_id:=cron.schedule('sellertray-lifecycle-notifications','17 * * * *',
   'select public.materialize_sellertray_lifecycle_notifications();');
 PERFORM cron.alter_job(v_id,active=>false);
 IF (SELECT count(*) FROM cron.job)<>5 OR EXISTS(SELECT 1 FROM cron.job WHERE active)
 OR EXISTS(SELECT 1 FROM oa5_cron_before b WHERE b.jobname<>'sellertray-lifecycle-notifications'
    AND NOT EXISTS(SELECT 1 FROM cron.job j WHERE j.jobid=b.jobid AND j.jobname=b.jobname
        AND j.schedule=b.schedule AND j.command=b.command AND j.username=b.username AND NOT j.active))
 OR EXISTS(SELECT 1 FROM net.http_request_queue)
 THEN RAISE EXCEPTION 'Scheduler transaction invariants failed'; END IF;
 RAISE NOTICE 'Named schedule, new lifecycle job, exact pauses and original job preservation: PASS';
END $$;
ROLLBACK;
DO $$
BEGIN
 IF (SELECT count(*) FROM cron.job)<>5 OR EXISTS(SELECT 1 FROM cron.job WHERE active)
 OR EXISTS(SELECT 1 FROM net.http_request_queue)
 THEN RAISE EXCEPTION 'Unexpected post-rollback scheduler state'; END IF;
END $$;
SELECT 'LOCAL_CRON_ATOMICITY=PASS' AS result;
