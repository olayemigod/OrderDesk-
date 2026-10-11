import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const app = readFileSync(resolve(appRoot, 'src/MerchantApp.tsx'), 'utf8');
const ai = readFileSync(resolve(appRoot, 'src/AiInsights.tsx'), 'utf8');
const edge = readFileSync(resolve(appRoot, '../../supabase/functions/merchant-ai/index.ts'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  app.includes("import AiInsights from './AiInsights'") &&
    app.includes("{ id: 'ai', label: 'Ask SellerTray' }") &&
    app.includes("page === 'ai' && <AiInsights tenantId={business.id}"),
  'Merchant Web must expose Ask SellerTray through the management shell.',
);

requireValue(
  app.includes("import PurchasingManagement from './PurchasingManagement'") &&
    app.includes("{ id: 'purchasing', label: 'Purchasing & Suppliers' }") &&
    app.includes("page === 'purchasing' && <PurchasingManagement tenantId={business.id} currency={business.currency}"),
  'Merchant Web must expose the governed Purchasing & Suppliers workspace.',
);

requireValue(
  ai.includes("functions.invoke('merchant-ai'") &&
    ai.includes('This assistant is read-only') &&
    ai.includes('cannot execute sales, stock, payment, purchasing or settings changes'),
  'Ask SellerTray must use the governed merchant-ai Edge Function and state its read-only boundary.',
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
