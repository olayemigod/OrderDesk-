import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';

import { supabase } from '../lib/supabase';

const PENDING_KEY = 'sellertray.whatsapp.embedded-signup.pending.v1';
const CONNECT_PAGE = 'https://sellertray.vercel.app/whatsapp/connect';

export type WhatsAppConnectionRecord = {
  id: string;
  tenantId: string;
  metaBusinessId: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  connectionStatus: 'pending' | 'connected' | 'error' | 'disconnected';
  onboardingMethod: 'embedded_signup' | 'coexistence' | 'manual' | null;
  credentialMode: 'platform_system_user' | 'business_integration_system_user' | null;
  webhookSubscriptionStatus: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorMessage: string | null;
};

export type WhatsAppConnectionReadiness = {
  inboundReady: boolean;
  outboundReady: boolean;
  messagingReady: boolean;
  webhookReady: boolean;
  credentialReady: boolean;
  reason: string | null;
  checkedAt: string | null;
};

export type WhatsAppConnectionStatusPayload = {
  connection: WhatsAppConnectionRecord | null;
  readiness: WhatsAppConnectionReadiness;
};

type PendingSignup = {
  tenantId: string;
  state: string;
  startedAt: string;
};

export type EmbeddedSignupCallback =
  | {
      status: 'success';
      tenantId: string;
      authorizationCode: string;
      wabaId: string;
      phoneNumberId: string;
      metaBusinessId: string | null;
      state: string;
    }
  | {
      status: 'cancelled' | 'error';
      tenantId: string | null;
      state: string | null;
      message: string | null;
    };

export async function loadWhatsAppConnectionStatus(
  tenantId: string,
): Promise<WhatsAppConnectionStatusPayload> {
  return invokeConnection({ action: 'status', tenantId });
}

export async function completeWhatsAppEmbeddedSignup(input: {
  tenantId: string;
  authorizationCode: string;
  wabaId: string;
  phoneNumberId: string;
  metaBusinessId?: string | null;
}): Promise<WhatsAppConnectionStatusPayload> {
  return invokeConnection({
    action: 'complete_embedded_signup',
    tenantId: input.tenantId,
    authorizationCode: input.authorizationCode,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    metaBusinessId: input.metaBusinessId ?? null,
    onboardingMethod: 'embedded_signup',
  });
}

export async function disconnectWhatsApp(
  tenantId: string,
): Promise<WhatsAppConnectionStatusPayload> {
  return invokeConnection({ action: 'disconnect', tenantId });
}

export async function startWhatsAppEmbeddedSignup(
  tenantId: string,
): Promise<void> {
  const state = createState();
  const pending: PendingSignup = {
    tenantId,
    state,
    startedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const returnTo = 'sellertray://whatsapp-connect';
  const url =
    CONNECT_PAGE +
    '?tenantId=' + encodeURIComponent(tenantId) +
    '&state=' + encodeURIComponent(state) +
    '&returnTo=' + encodeURIComponent(returnTo);

  const supported = await Linking.canOpenURL(url);
  if (!supported) {
    await AsyncStorage.removeItem(PENDING_KEY);
    throw new Error('SellerTray could not open the WhatsApp connection page.');
  }

  await Linking.openURL(url);
}

export async function parseEmbeddedSignupCallback(
  url: string,
): Promise<EmbeddedSignupCallback | null> {
  if (!url.startsWith('sellertray://whatsapp-connect')) return null;

  const parsed = parseQuery(url);
  const status = parsed.status ?? 'success';
  const tenantId = parsed.tenantId ?? null;
  const state = parsed.state ?? null;

  if (status === 'cancelled' || status === 'error') {
    const pending = await loadPending();
    if (pending && state && pending.state === state) {
      await AsyncStorage.removeItem(PENDING_KEY);
    }
    return {
      status,
      tenantId,
      state,
      message: parsed.message ?? null,
    };
  }

  const pending = await loadPending();
  if (!pending) {
    return null;
  }

  if (!tenantId || tenantId !== pending.tenantId) {
    throw new Error('WhatsApp connection returned for a different SellerTray business.');
  }

  if (!state || state !== pending.state) {
    throw new Error('WhatsApp connection security check failed. Start the connection again.');
  }

  const authorizationCode = parsed.code ?? '';
  const wabaId = parsed.wabaId ?? '';
  const phoneNumberId = parsed.phoneNumberId ?? '';

  if (!authorizationCode || !isMetaId(wabaId) || !isMetaId(phoneNumberId)) {
    throw new Error('Meta did not return the information SellerTray needs to complete WhatsApp setup.');
  }

  const age = Date.now() - new Date(pending.startedAt).getTime();
  if (!Number.isFinite(age) || age > 30 * 60 * 1000) {
    await AsyncStorage.removeItem(PENDING_KEY);
    throw new Error('WhatsApp connection session expired. Start the connection again.');
  }

  await AsyncStorage.removeItem(PENDING_KEY);
  return {
    status: 'success',
    tenantId,
    authorizationCode,
    wabaId,
    phoneNumberId,
    metaBusinessId: isMetaId(parsed.metaBusinessId ?? '') ? parsed.metaBusinessId! : null,
    state,
  };
}

async function invokeConnection(
  body: Record<string, unknown>,
): Promise<WhatsAppConnectionStatusPayload> {
  const { data, error } = await supabase.functions.invoke('whatsapp-connection', { body });
  if (error) {
    let message = error.message || 'Unable to update WhatsApp connection.';
    if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
      try {
        const payload = await (error.context as Response).clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {
        // Keep SDK error message.
      }
    }
    throw new Error(message);
  }

  return normalizeStatusPayload(data);
}

function normalizeStatusPayload(value: unknown): WhatsAppConnectionStatusPayload {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const rawConnection =
    row.connection && typeof row.connection === 'object' && !Array.isArray(row.connection)
      ? row.connection as Record<string, unknown>
      : null;

  const rawReadiness =
    row.readiness && typeof row.readiness === 'object' && !Array.isArray(row.readiness)
      ? row.readiness as Record<string, unknown>
      : {};

  return {
    connection: rawConnection ? {
      id: stringValue(rawConnection.id),
      tenantId: stringValue(rawConnection.tenant_id),
      metaBusinessId: optionalString(rawConnection.meta_business_id),
      wabaId: optionalString(rawConnection.waba_id),
      phoneNumberId: optionalString(rawConnection.phone_number_id),
      displayPhoneNumber: optionalString(rawConnection.display_phone_number),
      verifiedName: optionalString(rawConnection.verified_name),
      connectionStatus: connectionStatus(rawConnection.connection_status),
      onboardingMethod: onboardingMethod(rawConnection.onboarding_method),
      credentialMode: credentialMode(rawConnection.credential_mode),
      webhookSubscriptionStatus: optionalString(rawConnection.webhook_subscription_status),
      connectedAt: optionalString(rawConnection.connected_at),
      lastVerifiedAt: optionalString(rawConnection.last_verified_at),
      lastErrorMessage: optionalString(rawConnection.last_error_message),
    } : null,
    readiness: {
      inboundReady: rawReadiness.inboundReady === true,
      outboundReady: rawReadiness.outboundReady === true,
      messagingReady: rawReadiness.messagingReady === true,
      webhookReady: rawReadiness.webhookReady === true,
      credentialReady: rawReadiness.credentialReady === true,
      reason: optionalString(rawReadiness.reason),
      checkedAt: optionalString(rawReadiness.checkedAt),
    },
  };
}

async function loadPending(): Promise<PendingSignup | null> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingSignup>;
    if (
      typeof value.tenantId === 'string' &&
      typeof value.state === 'string' &&
      typeof value.startedAt === 'string'
    ) {
      return value as PendingSignup;
    }
  } catch {
    // Invalid old state.
  }
  await AsyncStorage.removeItem(PENDING_KEY);
  return null;
}

function parseQuery(url: string): Record<string, string> {
  const queryIndex = url.indexOf('?');
  if (queryIndex < 0) return {};
  const fragmentIndex = url.indexOf('#', queryIndex);
  const query = url.slice(queryIndex + 1, fragmentIndex >= 0 ? fragmentIndex : undefined);
  const params = new URLSearchParams(query);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function createState(): string {
  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join('.');
}

function isMetaId(value: string): boolean {
  return /^[0-9]{5,40}$/.test(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function connectionStatus(value: unknown): WhatsAppConnectionRecord['connectionStatus'] {
  return value === 'pending' || value === 'connected' || value === 'error' || value === 'disconnected'
    ? value
    : 'error';
}

function onboardingMethod(value: unknown): WhatsAppConnectionRecord['onboardingMethod'] {
  return value === 'embedded_signup' || value === 'coexistence' || value === 'manual'
    ? value
    : null;
}

function credentialMode(value: unknown): WhatsAppConnectionRecord['credentialMode'] {
  return value === 'platform_system_user' || value === 'business_integration_system_user'
    ? value
    : null;
}
