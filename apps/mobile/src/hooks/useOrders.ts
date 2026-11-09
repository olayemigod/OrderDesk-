import { useCallback, useEffect, useRef, useState } from 'react';

import {
  addOrderItem,
  completeOrderFulfillment,
  createManualOrder,
  deleteOrderItem,
  loadOrders,
  startOrderDelivery,
  subscribeToOrderChanges,
  unsubscribeFromOrderChanges,
  updateOrderItem,
  updateOrderStatus,
  type ManualOrderInput,
  type OrderFulfillmentInput,
  type OrderItemInput,
} from '../data/ordersRepository';
import { isLikelyConnectivityError } from '../data/offlineSalesRepository';
import type { MerchantOrder, OrderStatus } from '../domain/order';

export function useOrders(tenantId: string | null) {
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [ordersScope, setOrdersScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Realtime can emit multiple events for a single sale (order, payment, stock).
  // A tenant gets one active read at a time, plus at most one queued recheck.
  // Do not show a full-screen loading state when refreshing already loaded orders.
  const currentTenantRef = useRef(tenantId);
  currentTenantRef.current = tenantId;
  const loadedTenantRef = useRef<string | null>(null);
  const inFlightRef = useRef<{ tenantId: string; pending: boolean; task: Promise<void> } | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setOrders([]);
      setOrdersScope(null);
      setLoading(false);
      setError(null);
      return;
    }

    const active = inFlightRef.current;
    if (active?.tenantId === tenantId) {
      active.pending = true;
      return active.task;
    }

    const operation = { tenantId, pending: false, task: Promise.resolve() };
    if (loadedTenantRef.current !== tenantId) setLoading(true);
    operation.task = (async () => {
      try {
        do {
          operation.pending = false;
          try {
            const next = await loadOrders(tenantId);
            if (currentTenantRef.current !== tenantId) break;
            setOrders(next);
            setOrdersScope(tenantId);
            loadedTenantRef.current = tenantId;
            setError(null);
          } catch (err) {
            if (currentTenantRef.current !== tenantId) break;
            setError(isLikelyConnectivityError(err) ? null : errorMessage(err, 'Unable to load orders.'));
          }
        } while (operation.pending && currentTenantRef.current === tenantId);
      } finally {
        if (inFlightRef.current === operation) inFlightRef.current = null;
        if (currentTenantRef.current === tenantId) setLoading(false);
      }
    })();
    inFlightRef.current = operation;
    return operation.task;
  }, [tenantId]);

  useEffect(() => {
    // Prevent showing another merchant's records during an account switch.
    loadedTenantRef.current = null;
    setOrders([]);
    setOrdersScope(null);
    setError(null);
    setLoading(Boolean(tenantId));
    void refresh();
    if (!tenantId) return undefined;

    const channel = subscribeToOrderChanges(tenantId, () => {
      void refresh();
    });

    return () => {
      void unsubscribeFromOrderChanges(channel);
    };
  }, [refresh, tenantId]);

  const createOrder = useCallback(
    async (input: Omit<ManualOrderInput, 'tenantId'>) => {
      if (!tenantId) throw new Error('No active business selected.');
      try {
        const orderId = await createManualOrder({ ...input, tenantId });
        await refresh();
        setError(null);
        return orderId;
      } catch (err) {
        setError(errorMessage(err, 'Unable to create order.'));
        throw err;
      }
    },
    [refresh, tenantId],
  );

  const setStatus = useCallback(
    async (orderId: string, status: OrderStatus, reason?: string | null) => {
      if (!tenantId) throw new Error('No active business selected.');
      const previous = orders;
      const normalizedReason = reason?.trim() || null;
      setOrders((current) =>
        current.map((order) =>
          order.id === orderId
            ? { ...order, status, statusReason: normalizedReason }
            : order,
        ),
      );

      try {
        await updateOrderStatus(tenantId, orderId, status, normalizedReason);
        setError(null);
      } catch (err) {
        setOrders(previous);
        setError(errorMessage(err, 'Unable to update order.'));
        throw err;
      }
    },
    [orders, tenantId],
  );

  const startDelivery = useCallback(
    async (orderId: string, input: OrderFulfillmentInput) => {
      try {
        await startOrderDelivery(orderId, input);
        await refresh();
        setError(null);
      } catch (err) {
        setError(errorMessage(err, 'Unable to start delivery.'));
        throw err;
      }
    },
    [refresh],
  );

  const completeFulfillment = useCallback(
    async (orderId: string, input: OrderFulfillmentInput) => {
      try {
        await completeOrderFulfillment(orderId, input);
        await refresh();
        setError(null);
      } catch (err) {
        setError(errorMessage(err, 'Unable to complete fulfillment.'));
        throw err;
      }
    },
    [refresh],
  );

  const addItem = useCallback(
    async (orderId: string, item: OrderItemInput) => {
      if (!tenantId) throw new Error('No active business selected.');
      try {
        await addOrderItem(tenantId, orderId, item);
        await refresh();
      } catch (err) {
        setError(errorMessage(err, 'Unable to add order item.'));
        throw err;
      }
    },
    [refresh, tenantId],
  );

  const editItem = useCallback(
    async (itemId: string, item: OrderItemInput) => {
      if (!tenantId) throw new Error('No active business selected.');
      const parentOrder = orders.find((order) => order.items.some((line) => line.id === itemId));
      if (!parentOrder) throw new Error('Unable to resolve the order for this item.');
      try {
        await updateOrderItem(tenantId, parentOrder.id, itemId, item);
        await refresh();
      } catch (err) {
        setError(errorMessage(err, 'Unable to update order item.'));
        throw err;
      }
    },
    [orders, refresh, tenantId],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      if (!tenantId) throw new Error('No active business selected.');
      const parentOrder = orders.find((order) => order.items.some((line) => line.id === itemId));
      if (!parentOrder) throw new Error('Unable to resolve the order for this item.');
      try {
        await deleteOrderItem(tenantId, parentOrder.id, itemId);
        await refresh();
      } catch (err) {
        setError(errorMessage(err, 'Unable to remove order item.'));
        throw err;
      }
    },
    [orders, refresh, tenantId],
  );

  return {
    // Reject even a single render of stale records during an account/Business switch.
    orders: ordersScope === tenantId ? orders : [],
    loading,
    error,
    refresh,
    createOrder,
    setStatus,
    startDelivery,
    completeFulfillment,
    addItem,
    editItem,
    removeItem,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return fallback;
}
