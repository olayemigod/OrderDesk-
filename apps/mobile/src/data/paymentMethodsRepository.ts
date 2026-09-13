import { supabase } from '../lib/supabase';

export type PaymentMethodType =
  | 'bank_transfer'
  | 'paystack'
  | 'flutterwave'
  | 'cash_on_delivery'
  | 'pay_on_pickup';

export type PaymentMethodMode = 'test' | 'live';
export type PaymentMethodConfigurationStatus =
  | 'ready'
  | 'credentials_required'
  | 'configured'
  | 'error';

export type MerchantPaymentMethod = {
  id: string;
  tenantId: string;
  methodType: PaymentMethodType;
  displayName: string;
  isEnabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  mode: PaymentMethodMode;
  configurationStatus: PaymentMethodConfigurationStatus;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankCode: string | null;
  instructions: string | null;
  updatedAt: string;
};

type PaymentMethodRow = {
  id: string;
  tenant_id: string;
  method_type: PaymentMethodType;
  display_name: string;
  is_enabled: boolean;
  is_default: boolean;
  sort_order: number;
  mode: PaymentMethodMode;
  configuration_status: PaymentMethodConfigurationStatus;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_code: string | null;
  instructions: string | null;
  updated_at: string;
};

export type PaymentMethodInput = {
  methodId?: string | null;
  methodType: PaymentMethodType;
  displayName: string;
  isEnabled: boolean;
  isDefault: boolean;
  sortOrder?: number;
  mode?: PaymentMethodMode;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankCode?: string | null;
  instructions?: string | null;
};

export async function loadPaymentMethods(tenantId: string): Promise<MerchantPaymentMethod[]> {
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from('merchant_payment_methods')
    .select(
      'id,tenant_id,method_type,display_name,is_enabled,is_default,sort_order,mode,configuration_status,bank_name,bank_account_name,bank_account_number,bank_code,instructions,updated_at',
    )
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;

  return ((data ?? []) as PaymentMethodRow[]).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    methodType: row.method_type,
    displayName: row.display_name,
    isEnabled: row.is_enabled,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    mode: row.mode,
    configurationStatus: row.configuration_status,
    bankName: row.bank_name,
    bankAccountName: row.bank_account_name,
    bankAccountNumber: row.bank_account_number,
    bankCode: row.bank_code,
    instructions: row.instructions,
    updatedAt: row.updated_at,
  }));
}

export async function savePaymentMethod(
  tenantId: string,
  input: PaymentMethodInput,
): Promise<string> {
  const data = await invokePaymentSettings({
    action: 'save_method',
    tenantId,
    methodId: input.methodId ?? null,
    methodType: input.methodType,
    displayName: input.displayName,
    isEnabled: input.isEnabled,
    isDefault: input.isDefault,
    sortOrder: input.sortOrder ?? 100,
    mode: input.mode ?? 'live',
    bankName: cleanOptional(input.bankName),
    bankAccountName: cleanOptional(input.bankAccountName),
    bankAccountNumber: cleanOptional(input.bankAccountNumber),
    bankCode: cleanOptional(input.bankCode),
    instructions: cleanOptional(input.instructions),
  });

  const method =
    data && typeof data === 'object' && 'method' in data && data.method && typeof data.method === 'object'
      ? data.method as Record<string, unknown>
      : null;
  const id = method && typeof method.id === 'string' ? method.id : null;
  if (!id) throw new Error('SellerTray returned an invalid payment method id.');
  return id;
}

export async function connectPaymentGateway(
  tenantId: string,
  methodId: string,
  provider: 'paystack' | 'flutterwave',
  secretKey: string,
  secretHash?: string | null,
): Promise<void> {
  await invokePaymentSettings({
    action: 'connect_gateway',
    tenantId,
    methodId,
    provider,
    secretKey: secretKey.trim(),
    secretHash: cleanOptional(secretHash),
  });
}

export async function disconnectPaymentGateway(
  tenantId: string,
  methodId: string,
): Promise<void> {
  await invokePaymentSettings({
    action: 'disconnect_gateway',
    tenantId,
    methodId,
  });
}

async function invokePaymentSettings(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('payment-settings', { body });

  if (error) {
    let message = error.message || 'SellerTray could not update payment settings.';
    if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
      try {
        const payload = await (error.context as Response).clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the SDK message.
      }
    }
    throw new Error(message);
  }

  return data;
}

function cleanOptional(value: string | null | undefined): string | null {
  const clean = value?.trim() ?? '';
  return clean || null;
}
