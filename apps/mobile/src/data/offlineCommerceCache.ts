import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadCommerceProducts, type CommerceProduct } from './commerceRepository';

const CACHE_PREFIX = 'sellertray.offline.products.v1';
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

type ProductCacheEnvelope = {
  version: 1;
  tenantId: string;
  cachedAt: string;
  products: CommerceProduct[];
};

export type CommerceProductLoadResult = {
  products: CommerceProduct[];
  source: 'live' | 'cache';
  cachedAt: string | null;
  liveError: string | null;
};

export async function loadCommerceProductsResilient(tenantId: string): Promise<CommerceProductLoadResult> {
  if (!tenantId) return { products: [], source: 'live', cachedAt: null, liveError: null };

  try {
    const products = await loadCommerceProducts(tenantId);
    const cachedAt = new Date().toISOString();
    await writeProductCache({ version: 1, tenantId, cachedAt, products }).catch(() => undefined);
    return { products, source: 'live', cachedAt: null, liveError: null };
  } catch (cause) {
    const liveError = cause instanceof Error ? cause.message : 'Unable to load live products.';
    const cached = await readProductCache(tenantId);
    if (!cached) throw cause;
    return {
      products: cached.products,
      source: 'cache',
      cachedAt: cached.cachedAt,
      liveError,
    };
  }
}

export async function clearCommerceProductCache(tenantId: string): Promise<void> {
  if (!tenantId) return;
  await AsyncStorage.removeItem(cacheKey(tenantId));
}

async function writeProductCache(envelope: ProductCacheEnvelope): Promise<void> {
  await AsyncStorage.setItem(cacheKey(envelope.tenantId), JSON.stringify(envelope));
}

async function readProductCache(tenantId: string): Promise<ProductCacheEnvelope | null> {
  const raw = await AsyncStorage.getItem(cacheKey(tenantId));
  if (!raw) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<ProductCacheEnvelope>;
    if (candidate.version !== 1 || candidate.tenantId !== tenantId || typeof candidate.cachedAt !== 'string') {
      await AsyncStorage.removeItem(cacheKey(tenantId));
      return null;
    }
    const cachedAtMs = new Date(candidate.cachedAt).getTime();
    if (!Number.isFinite(cachedAtMs) || Date.now() - cachedAtMs > MAX_CACHE_AGE_MS) {
      await AsyncStorage.removeItem(cacheKey(tenantId));
      return null;
    }
    if (!Array.isArray(candidate.products) || !candidate.products.every(isCommerceProduct)) {
      await AsyncStorage.removeItem(cacheKey(tenantId));
      return null;
    }
    return candidate as ProductCacheEnvelope;
  } catch {
    await AsyncStorage.removeItem(cacheKey(tenantId));
    return null;
  }
}

function isCommerceProduct(value: unknown): value is CommerceProduct {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || typeof row.name !== 'string'
    || (row.sku !== null && typeof row.sku !== 'string')
    || (row.category !== null && typeof row.category !== 'string')
    || (row.imageUrl !== null && typeof row.imageUrl !== 'string')
    || typeof row.stockUom !== 'string'
    || typeof row.allowFractionalStock !== 'boolean'
    || typeof row.isActive !== 'boolean'
    || !Array.isArray(row.uoms)
  ) return false;

  return row.uoms.every((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const uom = candidate as Record<string, unknown>;
    return typeof uom.id === 'string'
      && typeof uom.name === 'string'
      && typeof uom.conversionFactor === 'number'
      && Number.isFinite(uom.conversionFactor)
      && (uom.sellingPrice === null || (typeof uom.sellingPrice === 'number' && Number.isFinite(uom.sellingPrice)))
      && (uom.barcode === null || typeof uom.barcode === 'string')
      && typeof uom.allowFractional === 'boolean'
      && typeof uom.isDefaultSelling === 'boolean'
      && typeof uom.isDefaultPurchase === 'boolean';
  });
}

function cacheKey(tenantId: string): string {
  return `${CACHE_PREFIX}:${tenantId}`;
}
