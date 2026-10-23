import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.');
}

const client = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const invokeFunction = client.functions.invoke.bind(client.functions);
client.functions.invoke = (async (functionName, options) => {
  const result = await invokeFunction(functionName, options);
  if (result.error) {
    const context = (result.error as { context?: unknown }).context;
    if (typeof Response !== 'undefined' && context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: unknown; message?: unknown };
        const governedMessage = typeof payload.error === 'string' && payload.error.trim()
          ? payload.error.trim()
          : typeof payload.message === 'string' && payload.message.trim()
            ? payload.message.trim()
            : null;
        if (governedMessage) result.error.message = governedMessage;
      } catch {
        // Keep the Supabase transport error when the response has no readable JSON body.
      }
    }
  }
  return result;
}) as typeof client.functions.invoke;

export const supabase = client;

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

export function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
