import { supabase } from '../lib/supabase';

export type PaymentGate = 'none' | 'before_processing' | 'before_ready' | 'before_fulfillment';
export type WhatsAppPushMode = 'actionable_only' | 'all_messages' | 'orders_payments_only';

export type OperationalPolicy = {
  paymentGate: PaymentGate;
  allowCodDispatchUnpaid: boolean;
  requireCodPaymentBeforeCompletion: boolean;
  allowPickupReadyUnpaid: boolean;
  requirePickupPaymentBeforeCompletion: boolean;
  requireDeliveryProvider: boolean;
  requireDeliveryReference: boolean;
  requireCustomerDeliveryConfirmation: boolean;
  whatsappPushMode: WhatsAppPushMode;
};

export const defaultOperationalPolicy: OperationalPolicy = {
  paymentGate: 'before_fulfillment',
  allowCodDispatchUnpaid: true,
  requireCodPaymentBeforeCompletion: true,
  allowPickupReadyUnpaid: true,
  requirePickupPaymentBeforeCompletion: true,
  requireDeliveryProvider: false,
  requireDeliveryReference: false,
  requireCustomerDeliveryConfirmation: false,
  whatsappPushMode: 'actionable_only',
};

export async function loadOperationalPolicy(tenantId: string): Promise<OperationalPolicy> {
  const { data, error } = await supabase.rpc('sellertray_get_operational_policy', {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
  return parsePolicy(data);
}

export async function saveOperationalPolicy(
  tenantId: string,
  policy: OperationalPolicy,
): Promise<OperationalPolicy> {
  const { data, error } = await supabase.rpc('sellertray_save_operational_policy', {
    p_tenant_id: tenantId,
    p_payment_gate: policy.paymentGate,
    p_allow_cod_dispatch_unpaid: policy.allowCodDispatchUnpaid,
    p_require_cod_payment_before_completion: policy.requireCodPaymentBeforeCompletion,
    p_allow_pickup_ready_unpaid: policy.allowPickupReadyUnpaid,
    p_require_pickup_payment_before_completion: policy.requirePickupPaymentBeforeCompletion,
    p_require_delivery_provider: policy.requireDeliveryProvider,
    p_require_delivery_reference: policy.requireDeliveryReference,
    p_require_customer_delivery_confirmation: policy.requireCustomerDeliveryConfirmation,
    p_whatsapp_push_mode: policy.whatsappPushMode,
  });
  if (error) throw error;
  return parsePolicy(data);
}

function parsePolicy(value: unknown): OperationalPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultOperationalPolicy;
  }
  const row = value as Record<string, unknown>;
  const paymentGate = row.paymentGate;
  const whatsappPushMode = row.whatsappPushMode;
  return {
    paymentGate:
      paymentGate === 'none' ||
      paymentGate === 'before_processing' ||
      paymentGate === 'before_ready' ||
      paymentGate === 'before_fulfillment'
        ? paymentGate
        : defaultOperationalPolicy.paymentGate,
    allowCodDispatchUnpaid: booleanValue(row.allowCodDispatchUnpaid, true),
    requireCodPaymentBeforeCompletion: booleanValue(row.requireCodPaymentBeforeCompletion, true),
    allowPickupReadyUnpaid: booleanValue(row.allowPickupReadyUnpaid, true),
    requirePickupPaymentBeforeCompletion: booleanValue(row.requirePickupPaymentBeforeCompletion, true),
    requireDeliveryProvider: booleanValue(row.requireDeliveryProvider, false),
    requireDeliveryReference: booleanValue(row.requireDeliveryReference, false),
    requireCustomerDeliveryConfirmation: booleanValue(row.requireCustomerDeliveryConfirmation, false),
    whatsappPushMode:
      whatsappPushMode === 'all_messages' ||
      whatsappPushMode === 'orders_payments_only' ||
      whatsappPushMode === 'actionable_only'
        ? whatsappPushMode
        : defaultOperationalPolicy.whatsappPushMode,
  };
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
