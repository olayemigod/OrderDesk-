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
create table tenants(id uuid,name text,slug text,business_email text,business_phone text,business_type text,currency text,timezone text,onboarding_status text,subscription_status text,whatsapp_connection_status text,created_at timestamptz,updated_at timestamptz);
create table subscription_plans(code text,name text);
create table tenant_subscriptions(tenant_id uuid,status text,plan_code text,current_period_end timestamptz,trial_ends_at timestamptz,grace_ends_at timestamptz);
create table orders(tenant_id uuid,currency text,source text,total_amount numeric,amount_paid numeric,created_at timestamptz,deleted_at timestamptz,status text);
create table outbound_notifications(tenant_id uuid,delivery_status text);
create table branches(id uuid,tenant_id uuid,code text,name text,is_active boolean,is_default boolean);
create table tenant_members(tenant_id uuid,role text);
create table sellertray_commercial_entitlement_events(tenant_id uuid,event_type text,effective_from timestamptz,effective_until timestamptz);
create table inbound_messages(tenant_id uuid,received_at timestamptz);
create table tenant_admin_notes(tenant_id uuid,support_note text,updated_at timestamptz);
create table sellertray_commercial_orders(tenant_id uuid,ordered_at timestamptz);
create table sellertray_commercial_agreements(tenant_id uuid);
create table sellertray_commercial_agreement_acceptances(tenant_id uuid);
create table sellertray_commercial_order_price_snapshots(tenant_id uuid,line_type text);
create table sellertray_commercial_branch_setup_readiness(tenant_id uuid);
create table platform_admin_audit(id uuid,tenant_id uuid,action text,created_at timestamptz);
`);
await db.exec(readFileSync(resolve(import.meta.dirname, '../migrations/20261021215930_platform_admin_merchant_portfolio.sql'), 'utf8'));

const admin = '10000000-0000-4000-8000-000000000001';
const merchant = '20000000-0000-4000-8000-000000000001';
await assert.rejects(db.query('select platform_admin_merchant_portfolio($1)', [admin]), /administrator access/);
await assert.rejects(db.query('select platform_admin_merchant_detail($1,$2)', [admin, merchant]), /administrator access/);

await db.exec(`
insert into platform_admins values('${admin}','support');
insert into subscription_plans values('business','Business');
insert into tenants values
('${merchant}','Alpha Shop','alpha','alpha@example.com','+234800000001','retail','NGN','Africa/Lagos','complete','active','connected',now()-interval '90 days',now()),
('20000000-0000-4000-8000-000000000002','Bravo Shop','bravo','bravo@example.com',null,'retail','GHS','Africa/Accra','started','past_due','error',now()-interval '15 days',now()),
('20000000-0000-4000-8000-000000000003','Charlie Shop','charlie','charlie@example.com',null,'retail','NGN','Africa/Lagos','started','pending','pending',now()-interval '5 days',now());
insert into tenant_subscriptions values
('${merchant}','active','business',now()+interval '30 days',null,null),
('20000000-0000-4000-8000-000000000002','past_due','business',now()-interval '2 days',null,null);
insert into branches values('${merchant}','${merchant}','MAIN','Main branch',true,true);
insert into tenant_members values('${merchant}','owner'),('${merchant}','manager'),('${merchant}','staff');
insert into orders values
('${merchant}','NGN','pos',100,80,now()-interval '1 day',null,'completed'),
('${merchant}','USD','whatsapp',50,50,now()-interval '2 days',null,'completed'),
('${merchant}','NGN','pos',999,999,now()-interval '1 day',null,'draft'),
('${merchant}','NGN','manual',999,999,now()-interval '1 day',now(),'completed');
insert into tenant_admin_notes values('${merchant}','Account owner asked for onboarding support.',now());
insert into sellertray_commercial_entitlement_events values('${merchant}','installment.provisional_activated',now()-interval '60 days',now()+interval '30 days');
insert into platform_admin_audit values(gen_random_uuid(),'${merchant}','set_support_note',now());
`);

const portfolio = async (search = null, filter = 'all', afterName = null, afterId = null, limit = 25) =>
  (await db.query('select platform_admin_merchant_portfolio($1,$2,$3,$4,$5,$6) result', [admin, search, filter, afterName, afterId, limit])).rows[0].result;

const first = await portfolio(null, 'all', null, null, 2);
assert.equal(first.items.length, 2);
assert.equal(first.hasMore, true);
assert.ok(first.nextCursor);
const second = await portfolio(null, 'all', first.nextCursor.afterName, first.nextCursor.afterId, 2);
assert.equal(second.items.length, 1);
assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 3, 'keyset pages do not overlap');
assert.equal((await portfolio('bravo')).items[0].name, 'Bravo Shop');
assert.equal((await portfolio(null, 'attention')).items.some((item) => item.name === 'Bravo Shop'), true);
assert.equal((await portfolio(null, 'connected')).items.length, 1);
assert.equal((await portfolio(null, 'restricted')).items.length, 2);
await assert.rejects(portfolio(null, 'unsupported'), /Unsupported merchant filter/);

const detail = (await db.query('select platform_admin_merchant_detail($1,$2) result', [admin, merchant])).rows[0].result;
assert.equal(detail.merchant.activatedAt !== null, true);
assert.equal(detail.team.total, 3);
assert.equal(detail.performance.completedOrders, 2, 'draft and deleted orders are excluded');
assert.equal(detail.performance.money.find((item) => item.currency === 'NGN').merchantGmv, 100);
assert.equal(detail.performance.money.find((item) => item.currency === 'USD').merchantGmv, 50, 'currencies stay separate');
assert.equal(detail.performance.money.find((item) => item.currency === 'NGN').recordedPaidValue, 80);
assert.equal(detail.performance.money.find((item) => item.currency === 'NGN').outstandingOrderValue, 20);
assert.equal(detail.recentAdminActivity.length, 1);
await assert.rejects(db.query('select platform_admin_merchant_detail($1,$2)', [admin, '20000000-0000-4000-8000-000000000099']), /Merchant not found/);

const grants = (await db.query(`select has_function_privilege('authenticated','platform_admin_merchant_portfolio(uuid,text,text,text,uuid,integer)','EXECUTE') allowed`)).rows[0];
assert.equal(grants.allowed, false, 'browser callers cannot impersonate an administrator');
await db.close();
console.log('Isolated PostgreSQL merchant portfolio assertions passed; full migration replay requires Database CI.');
