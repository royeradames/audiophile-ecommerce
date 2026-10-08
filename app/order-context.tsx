"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  cancelOrder as toCancelled,
  markCollected as toCollected,
  markPaid as toPaid,
  readStoredOrders,
  writeStoredOrders,
  type OrderRecord,
} from "./order-record";

type OrderContextValue = {
  orders: OrderRecord[];
  addOrder: (order: OrderRecord) => void;
  /** Adds the order, or replaces this browser's copy with the server's. */
  saveOrder: (order: OrderRecord) => void;
  markPaid: (id: string) => void;
  markCollected: (id: string) => void;
  cancelOrder: (id: string) => void;
};

const OrderContext = createContext<OrderContextValue | null>(null);

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      setOrders(readStoredOrders());
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated) {
      writeStoredOrders(orders);
    }
  }, [hydrated, orders]);

  const addOrder = useCallback((order: OrderRecord) => {
    setOrders((current) => {
      const next = current.some((item) => item.id === order.id)
        ? current
        : [order, ...current];
      writeStoredOrders(next);
      return next;
    });
  }, []);

  const saveOrder = useCallback((order: OrderRecord) => {
    setOrders((current) => {
      const next = [order, ...current.filter((item) => item.id !== order.id)];
      writeStoredOrders(next);
      return next;
    });
  }, []);

  const markPaid = useCallback((id: string) => {
    const settledAt = new Date().toISOString();
    setOrders((current) => {
      const next = current.map((order) => (order.id === id ? toPaid(order, settledAt) : order));
      writeStoredOrders(next);
      return next;
    });
  }, []);

  const markCollected = useCallback((id: string) => {
    const settledAt = new Date().toISOString();
    setOrders((current) => {
      const next = current.map((order) => (order.id === id ? toCollected(order, settledAt) : order));
      writeStoredOrders(next);
      return next;
    });
  }, []);

  const cancelOrder = useCallback((id: string) => {
    setOrders((current) => {
      const next = current.map((order) => (order.id === id ? toCancelled(order) : order));
      writeStoredOrders(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      orders,
      addOrder,
      saveOrder,
      markPaid,
      markCollected,
      cancelOrder,
    }),
    [orders, addOrder, saveOrder, markPaid, markCollected, cancelOrder],
  );

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrders() {
  const value = useContext(OrderContext);
  if (!value) {
    throw new Error("useOrders must be used inside OrderProvider");
  }
  return value;
}
