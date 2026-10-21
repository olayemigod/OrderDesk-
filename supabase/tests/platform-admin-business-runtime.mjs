// Optional isolated SQL execution when Docker is unavailable. Pass the absolute
// path to @electric-sql/pglite/dist/index.js as argv[2]. This checks the real RPC
// bodies against minimal source-shaped tables; full schema/pgTAP remains CI.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table platform_admins(user_id uuid,role text);
create table tenants(id uuid,name text,created_at timestamptz,whatsapp_connection_status text);
create table orders(tenant_id uuid,branch_id uuid,currency text,source text,total_amount numeric,created_at timestamptz,deleted_at timestamptz,status text);
create table sale_returns(currency text,amount numeric,created_at timestamptz,status text);
create table sellertray_commercial_orders(currency text,total_gross_amount numeric,ordered_at timestamptz);
create table sellertray_commercial_installment_payment_confirmations(currency text,amount numeric,paid_at timestamptz,installment_obligation_id uuid);
create table sellertray_commercial_installment_obligations(id uuid,currency text,obligated_amount numeric);
create table sellertray_commercial_entitlement_events(tenant_id uuid,commercial_order_id uuid,effective_from timestamptz,effective_until timestamptz,event_type text);
create table sellertray_commercial_order_price_snapshots(tenant_id uuid,commercial_order_id uuid,branch_id uuid,line_type text);
create table sellertray_commercial_branch_setup_readiness(tenant_id uuid,commercial_order_id uuid,branch_id uuid);
`);
await db.exec(readFileSync(resolve(import.meta.dirname,'../migrations/20261021201432_platform_admin_business_dashboard.sql'),'utf8'));
const admin='10000000-0000-4000-8000-000000000001';
const merchant='20000000-0000-4000-8000-000000000001';
const other='20000000-0000-4000-8000-000000000002';
const order='30000000-0000-4000-8000-000000000001';
await assert.rejects(db.query('select platform_admin_business_summary($1,30)',[admin]),/administrator access/);
await assert.rejects(db.query('select platform_admin_business_attention(null)'),/administrator access/);
await db.exec(`begin;
insert into platform_admins values('${admin}','support');
insert into tenants values('${merchant}','Active',now()-interval '40 days','connected'),('${other}','Inactive',now()-interval '1 day','pending');
insert into orders values
('${merchant}','${merchant}','NGN','pos',100,now()-interval '1 day',null,'completed'),
('${other}','${other}','GHS','whatsapp',50,now()-interval '30 days',null,'completed'),
('${merchant}','${merchant}','NGN','pos',70,now()-interval '31 days',null,'completed'),
('${merchant}','${merchant}','NGN','pos',9999,now()-interval '1 day',null,'draft'),
('${merchant}','${merchant}','NGN','pos',9999,now()-interval '1 day',now(),'completed'),
('${merchant}','${merchant}','NGN','pos',9999,now()-interval '1 day',null,'cancelled');
insert into sale_returns values('NGN',20,now()-interval '1 day','completed');
insert into sellertray_commercial_orders values('NGN',1000,now()-interval '2 days');
insert into sellertray_commercial_installment_obligations values('${order}','NGN',1000);
insert into sellertray_commercial_installment_payment_confirmations values('NGN',700,now()-interval '1 day','${order}');
insert into sellertray_commercial_entitlement_events values
('${other}','${order}',now()-interval '40 days',now()+interval '2 days','installment.provisional_activated'),
('${other}','${order}',now()-interval '40 days',now()+interval '300 days','installment.full_entitlement_released');
insert into sellertray_commercial_order_price_snapshots values('${other}','${order}','${other}','branch_setup');
`);
const summary = async () => (await db.query('select platform_admin_business_summary($1,30) result',[admin])).rows[0].result;
const attention = async () => (await db.query('select platform_admin_business_attention($1) result',[admin])).rows[0].result;
let s=await summary();
assert.equal(s.current.completed_orders,2,'draft, deleted and cancelled orders excluded');
assert.equal(s.previous.completed_orders,1,'adjacent equal periods do not double count boundary');
assert.equal(s.current.new_merchants,1);
assert.equal(s.activatedMerchants,1,'provisional/full events count one activation');
assert.equal(s.money.find(x=>x.currency==='NGN'&&x.period==='current').merchant_gmv,100);
assert.equal(s.money.find(x=>x.currency==='GHS'&&x.period==='current').merchant_gmv,50,'currency remains separate');
assert.equal(s.money.find(x=>x.currency==='NGN'&&x.period==='current').installment_collections,700,'order value is not collection');
assert.equal(s.outstanding[0].balance,300,'balance counts confirmed payments once');
assert.equal(s.insights[0].change,1,'deterministic insight calculated by server');
let a=await attention();
assert.ok(!a.items.some(x=>x.signal==='entitlement_ending'),'full entitlement supersedes provisional expiry');
assert.ok(a.items.some(x=>x.signal==='inactive_14d'));
assert.ok(a.items.some(x=>x.signal==='setup_incomplete'));
await db.exec(`insert into sellertray_commercial_branch_setup_readiness values('${other}','${order}','${other}')`);
assert.ok(!(await attention()).items.some(x=>x.signal==='setup_incomplete'),'setup authority clears readiness attention');
await db.exec('savepoint invalid_period');
await assert.rejects(db.query('select platform_admin_business_summary($1,31)',[admin]),/Business period/);
await db.exec('rollback to invalid_period');
await db.exec(`insert into tenants select gen_random_uuid(),'Pending '||n,now(),'pending' from generate_series(1,25) n;
insert into sellertray_commercial_order_price_snapshots select id,'${order}',id,'branch_setup' from tenants where name like 'Pending %'`);
a=await attention();
assert.equal(a.items.length,20,'response bound does not truncate total');
assert.ok(a.total>20);
await db.exec('rollback');
const grants = (await db.query(`select has_function_privilege('authenticated','platform_admin_business_summary(uuid,integer)','EXECUTE') allowed`)).rows[0];
assert.equal(grants.allowed,false,'browser cannot impersonate admin through direct RPC');
await db.close();
console.log('Isolated PostgreSQL dashboard assertions passed; full migration replay requires Database CI.');
