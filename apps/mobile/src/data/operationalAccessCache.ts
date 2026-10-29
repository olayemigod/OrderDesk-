import AsyncStorage from '@react-native-async-storage/async-storage';
import { isCachedOperationalAccessAllowed, type CachedOperationalAccess } from './offlineAccessPolicy';

const key = (tenantId: string, actorUserId: string) => `sellertray.operational-access.v1:${tenantId}:${actorUserId}`;

export async function cacheOperationalAccess(tenantId: string, actorUserId: string, access: CachedOperationalAccess): Promise<void> {
  await AsyncStorage.setItem(key(tenantId, actorUserId), JSON.stringify(access));
}

export async function assertCachedOperationalAccess(tenantId: string, actorUserId: string): Promise<void> {
  let value: CachedOperationalAccess | null = null;
  try { const raw = await AsyncStorage.getItem(key(tenantId, actorUserId)); value = raw ? JSON.parse(raw) as CachedOperationalAccess : null; } catch { /* Missing or invalid authority fails closed. */ }
  if (!isCachedOperationalAccessAllowed(value)) throw new Error('Connect to SellerTray to confirm this Business is ready for selling. Setup, payment or plan access may need attention.');
}
