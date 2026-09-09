import { useCallback, useEffect, useState } from 'react';

import {
  addOrderItem,
  deleteOrderItem,
  loadOrders,
  subscribeToOrderChanges,
  unsubscribeFromOrderChanges,
  updateOrderItem,
  updateOrderStatus,
  type OrderItemInput,
} from '../data/ordersRepository';
import type { MerchantOrder, OrderStatus } from '../domain/order';

export function useOrders() {
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadOrders();
      setOrders(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = subscribeToOrderChanges(() => {
      void refresh();
    });

    return () => {
      void unsubscribeFromOrderChanges(channel);
    };
  }, [refresh]);

  const setStatus = useCallback(
    async (orderId: string, status: OrderStatus) => {
      const previous = orders;
      setOrders((current) =>
        current.map((order) => (order.id === orderId ? { ...order, status } : order)),
      );

      try {
        await updateOrderStatus(orderId, status);
        setError(null);
      } catch (err) {
        setOrders(previous);
        setError(err instanceof Error ? err.message : 'Unable to update order.');
        throw err;
      }
    },
    [orders],
  );

  const addItem = useCallback(
    async (orderId: string, item: OrderItemInput) => {
      try {
        await addOrderItem(orderId, item);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to add order item.');
        throw err;
      }
    },
    [refresh],
  );

  const editItem = useCallback(
    async (itemId: string, item: OrderItemInput) => {
      try {
        await updateOrderItem(itemId, item);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to update order item.');
        throw err;
      }
    },
    [refresh],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      try {
        await deleteOrderItem(itemId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to remove order item.');
        throw err;
      }
    },
    [refresh],
  );

  return { orders, loading, error, refresh, setStatus, addItem, editItem, removeItem };
}
