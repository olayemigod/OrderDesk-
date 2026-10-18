import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const app = readFileSync(resolve(appRoot, 'src/MerchantApp.tsx'), 'utf8');
const navigation = readFileSync(resolve(appRoot, 'src/portalNavigation.ts'), 'utf8');
const management = readFileSync(resolve(appRoot, 'src/ManagementPage.tsx'), 'utf8');
const orders = readFileSync(resolve(appRoot, 'src/OrdersManagement.tsx'), 'utf8');
const orderReads = readFileSync(resolve(appRoot, '../../supabase/migrations/20261018003000_sales_orders_management_reads.sql'), 'utf8');
const ai = readFileSync(resolve(appRoot, 'src/AiInsights.tsx'), 'utf8');
const edge = readFileSync(resolve(appRoot, '../../supabase/functions/merchant-ai/index.ts'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  app.includes("import AiInsights from './AiInsights'") &&
    navigation.includes("{ id: 'ai', label: 'Ask SellerTray', section: 'Insights', available: true }") &&
    app.includes("page === 'ai' && <AiInsights tenantId={business.id}"),
  'Merchant Web must expose Ask SellerTray through the management shell.',
);

requireValue(
  app.includes("import PurchasingManagement from './PurchasingManagement'") &&
    navigation.includes("{ id: 'purchasing', label: 'Purchase Orders & Receiving', section: 'Purchasing', available: true }") &&
    app.includes("page === 'purchasing' && <PurchasingManagement tenantId={business.id} currency={business.currency}"),
  'Merchant Web must expose the governed Purchasing workspace.',
);

requireValue(
  navigation.includes("{ id: 'suppliers', label: 'Suppliers', section: 'Purchasing', available: true }") &&
    app.includes("page === 'suppliers'") &&
    app.includes('<ManagementPage page={page}') &&
    management.includes("import SuppliersManagement from './SuppliersManagement'") &&
    management.includes("if (page === 'suppliers') return <SuppliersManagement tenantId={tenantId} currency={currency} />"),
  'Merchant Web must expose governed Supplier management through the shared management shell.',
);

requireValue(
  app.includes("import OrdersManagement from './OrdersManagement'") &&
    navigation.includes("{ id: 'orders', label: 'Orders', section: 'Sales', available: true }") &&
    app.includes("page === 'orders' && branch && <OrdersManagement tenantId={business.id} branchId={branch.id} currency={business.currency}") &&
    orders.includes("functions.invoke('order-draft-action'") &&
    orders.includes("rpc('get_sellertray_order_management_list'") &&
    orders.includes("rpc('get_sellertray_order_management_detail'") &&
    !orders.includes(".from('orders')") &&
    orderReads.includes('and o.deleted_at is null') &&
    orders.includes("selected?.source === 'pos'") &&
    orders.includes("selected.status === 'draft'") &&
    orders.includes("selected.paymentStatus === 'unpaid'"),
  'Merchant Web Orders must use governed reads, the authenticated draft-action boundary and exclude deleted drafts.',
);

requireValue(
  ai.includes("functions.invoke('merchant-ai'") &&
    ai.includes('This assistant is read-only') &&
    ai.includes('cannot execute sales, stock, payment, purchasing or settings changes'),
  'Ask SellerTray must use the governed merchant-ai Edge Function and state its read-only boundary.',
);

requireValue(
  ai.includes('aria-labelledby="sellertray-ai-question-heading"') &&
    ai.includes('aria-describedby="sellertray-ai-question-help"') &&
    ai.includes('role="alert"') &&
    ai.includes('aria-live="polite"') &&
    ai.includes('aria-busy={busy}'),
  'Ask SellerTray must expose labelled question input, announced errors/results and busy state for assistive technology.',
);

requireValue(
  !ai.includes('api.openai.com') &&
    !ai.includes('OPENAI_API_KEY') &&
    !ai.includes('SELLERTRAY_AI_INSIGHTS_MODEL') &&
    !ai.includes('SUPABASE_SERVICE_ROLE_KEY') &&
    !ai.includes("rpc('sellertray_ai_insight_context'"),
  'Browser AI code must not access OpenAI secrets/endpoints or bypass the Edge Function context boundary.',
);

requireValue(
  edge.includes("/auth/v1/user") &&
    edge.includes("/rest/v1/rpc/sellertray_ai_insight_context") &&
    edge.includes('authorization,') &&
    edge.includes("p_scope: 'merchant_ai_insight'") &&
    edge.includes('RATE_LIMIT_PER_MINUTE'),
  'merchant-ai must authenticate the caller, execute governed context with the user JWT, and apply a server rate limit.',
);

requireValue(
  edge.includes("https://api.openai.com/v1/responses") &&
    edge.includes('store: false') &&
    edge.includes("type: 'json_schema'") &&
    edge.includes('strict: true') &&
    edge.includes('max_output_tokens: 1200') &&
    edge.includes('safety_identifier:'),
  'merchant-ai must use server-side Responses API structured output without provider storage.',
);

requireValue(
  edge.includes('MAX_QUESTION_LENGTH = 1200') &&
    edge.includes('MAX_CONTEXT_CHARS = 120_000') &&
    edge.includes('readRequestTextLimited') &&
    edge.includes('AbortSignal.timeout'),
  'merchant-ai must bound request, question, context and provider execution size/time.',
);

requireValue(
  edge.includes("record_sellertray_ai_insight_attempt") &&
    edge.includes("outcome: 'success'") &&
    edge.includes("outcome: 'provider_error'") &&
    edge.includes("outcome: 'invalid_output'") &&
    edge.includes("outcome: 'network_error'") &&
    edge.includes("outcome: 'rate_limited'") &&
    edge.includes("outcome: 'context_error'"),
  'merchant-ai must record outcome/token telemetry for every governed request path.',
);

requireValue(
  !edge.includes('save_sellertray_') &&
    !edge.includes('place_sellertray_') &&
    !edge.includes('complete_sellertray_') &&
    !edge.includes('record_sellertray_inventory') &&
    !edge.includes('set_sellertray_member_') &&
    !edge.includes('set_sellertray_whatsapp_branch'),
  'Read-only merchant-ai must not contain SellerTray business mutation commands.',
);

if (failures.length) {
  console.error('SellerTray AI security preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray AI security preflight passed.');
