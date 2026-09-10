import { useCallback, useEffect, useState } from 'react';

import {
  createCatalogueItem,
  loadCatalogue,
  setCatalogueItemActive,
  updateCatalogueItem,
  type CatalogueItem,
  type CatalogueItemInput,
} from '../data/catalogueRepository';

export function useCatalogue(tenantId: string | null) {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(Boolean(tenantId));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      setItems(await loadCatalogue(tenantId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load catalogue.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createItem = useCallback(
    async (input: CatalogueItemInput) => {
      if (!tenantId) throw new Error('No active business selected.');
      try {
        await createCatalogueItem(tenantId, input);
        await refresh();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to add catalogue item.');
        throw err;
      }
    },
    [refresh, tenantId],
  );

  const editItem = useCallback(
    async (itemId: string, input: CatalogueItemInput) => {
      if (!tenantId) throw new Error('No active business selected.');
      try {
        await updateCatalogueItem(itemId, tenantId, input);
        await refresh();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to update catalogue item.');
        throw err;
      }
    },
    [refresh, tenantId],
  );

  const setActive = useCallback(
    async (itemId: string, active: boolean) => {
      if (!tenantId) throw new Error('No active business selected.');
      try {
        await setCatalogueItemActive(itemId, tenantId, active);
        await refresh();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to update catalogue item status.');
        throw err;
      }
    },
    [refresh, tenantId],
  );

  return { items, loading, error, refresh, createItem, editItem, setActive };
}
