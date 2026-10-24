// Optional isolated SQL execution when Docker is unavailable. Pass the absolute
// path to @electric-sql/pglite/dist/index.js as argv[2]. Full migration replay
// and pgTAP coverage remain Database CI responsibilities.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table platform_admins(user_id uuid,role text);
create table tenants(id uuid,subscription_status text,whatsapp_connection_status text);
create table subscription_plans(code text,usage_event_code text);
create table tenant_subscriptions(tenant_id uuid,status text,plan_code text,current_period_start timestamptz,current_period_end timestamptz,trial_started_at timestamptz,trial_ends_at timestamptz);
create table ai_parser_attempts(tenant_id uuid,outcome text,input_tokens integer,cached_input_tokens integer,output_tokens integer,reasoning_tokens integer,total_tokens integer,catalogue_items_total integer,catalogue_items_sent integer,catalogue_aliases_sent integer,model text,created_at timestamptz);
create table usage_events(tenant_id uuid,event_code text,quantity integer,occurred_at timestamptz);
`);
await db.exec(readFileSync(resolve(import.meta.dirname, '../migrations/20261022064000_platform_admin_bounded_bootstrap.sql'), 'utf8'));

const admin = '10000000-0000-4000-8000-000000000001';
const connected = '20000000-0000-4000-8000-000000000001';
const failing = '20000000-0000-4000-8000-000000000002';
await assert.rejects(db.query('select platform_admin_bootstrap($1)', [admin]), /administrator access/);
await assert.rejects(db.query('select platform_admin_operations_summary($1)', [admin]), /administrator access/);

await db.exec(`
insert into platform_admins values('${admin}','support');
insert into subscription_plans values('business','AI_ORDER_ACTIVITY');
insert into tenants values('${connected}','active','connected'),('${failing}','trial','error');
insert into tenant_subscriptions values('${connected}','active','business',now()-interval '10 days',now()+interval '20 days',null,null);
insert into ai_parser_attempts values
('${connected}','success',10,2,4,1,15,100,20,4,'test-model',now()-interval '1 day'),
('${connected}','provider_error',5,0,1,0,6,100,10,2,'test-model',now()-interval '2 days'),
('${connected}','success',999,0,0,0,999,999,999,999,'old-model',now()-interval '20 days');
insert into usage_events values
('${connected}','AI_ORDER_ACTIVITY',1,now()-interval '1 day'),
('${connected}','AI_ORDER_ACTIVITY',7,now()-interval '20 days');
`);

const bootstrap = (await db.query('select platform_admin_bootstrap($1) result', [admin])).rows[0].result;
assert.equal(bootstrap.actorRole, 'support');
assert.equal(bootstrap.merchantCount, 2);
assert.equal(bootstrap.legacyTrialRecords, 1);
assert.equal('tenants' in bootstrap, false, 'bootstrap never returns merchant rows');

const operations = (await db.query('select platform_admin_operations_summary($1) result', [admin])).rows[0].result;
assert.deepEqual(operations.whatsapp, { connected: 1, errors: 1, pending: 0, notConnected: 0 });
assert.equal(operations.ai.attempts, 2, 'AI data is limited to each merchant current period');
assert.equal(operations.ai.successes, 1);
assert.equal(operations.ai.nonSuccess, 1);
assert.equal(operations.ai.totalTokens, 21);
assert.equal(operations.ai.meteredExternalOrderUnits, 1);
assert.equal(Number(operations.ai.catalogueItemsSentAvg), 15);

const grant = (await db.query(`select has_function_privilege('authenticated','platform_admin_operations_summary(uuid)','EXECUTE') allowed`)).rows[0];
assert.equal(grant.allowed, false, 'browser callers cannot impersonate an administrator');
await db.close();
console.log('Isolated PostgreSQL bounded Admin assertions passed; full migration replay requires Database CI.');
