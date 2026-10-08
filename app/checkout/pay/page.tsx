"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CardPayment } from "../../card-payment";
import { formatUsd } from "../../checkout-totals";
import type { OrderSummary } from "../../order-api";
import { useOrders } from "../../order-context";
import { orderStatusLabels } from "../../order-record";
import { OrderSummaryCard } from "../../order-summary-card";
import { startHostedCheckout } from "../../stripe-client";
import { fetchServerOrder, fetchStoreFeatures } from "../../store-client";

export default function CheckoutPayPage() {
  return (
    <Suspense fallback={<PayBody message="Loading the order…" />}>
      <CheckoutPayClient />
    </Suspense>
  );
}

type ServerOrder =
  | { state: "loading" }
  | { state: "browser_only" }
  | { state: "found"; order: OrderSummary }
  | { state: "missing" }
  | { state: "error"; error: string };

function CheckoutPayClient() {
  const params = useSearchParams();
  const orderId = params.get("order");
  const { orders, markPaid } = useOrders();
  const [server, setServer] = useState<ServerOrder>({ state: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState(false);
  const local = orders.find((item) => item.id === orderId);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    void (async () => {
      let features;
      try {
        features = await fetchStoreFeatures();
      } catch {
        if (!cancelled) setServer({ state: "error", error: "The store could not be reached. Try again in a moment." });
        return;
      }
      if (!features.durableOrders) {
        if (!cancelled) setServer({ state: "browser_only" });
        return;
      }
      const result = await fetchServerOrder(orderId);
      if (cancelled) return;
      if (result.ok) setServer({ state: "found", order: result.order });
      else setServer(result.missing ? { state: "missing" } : { state: "error", error: result.error });
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, paid, confirming]);

  // The server is authoritative; bring this browser's copy up to date.
  const serverStatus = server.state === "found" ? server.order.status : null;
  useEffect(() => {
    if (serverStatus === "paid" && local && local.status !== "paid") markPaid(local.id);
  }, [serverStatus, local, markPaid]);

  const lines = server.state === "found" ? server.order.lines : local?.lines;
  const items = useMemo(
    () => (lines ?? []).map((line) => ({ productId: line.productId, quantity: line.quantity })),
    [lines],
  );

  if (!orderId) return <PayBody message="Open an order from its confirmation link or your account." />;
  if (server.state === "loading") return <PayBody message="Loading the order…" />;
  if (server.state === "error") return <PayBody message={server.error} />;

  const order: OrderSummary | null = server.state === "found"
    ? server.order
    : local
      ? { ...local, savedToAccount: false }
      : null;
  if (!order) {
    return (
      <PayBody
        message={server.state === "missing"
          ? "No order has that ID. Check the link from your confirmation, or place the order again from checkout."
          : "That order is not in this browser. Place it again from checkout, or open pending orders on the same device."}
      />
    );
  }

  // Only prefills Stripe's fields when this browser placed the order.
  const payer = local?.customer.email;
  const canPay = order.status === "pending_hosted" && !paid && !confirming;

  return (
    <section className="stack-page section" aria-labelledby="pay-title">
      <div className="container">
        <p className="overline overline-accent">{server.state === "found" ? "Saved order" : "This browser"}</p>
        <div className="stack-intro">
          <div>
            <h1 id="pay-title">Order {order.id}</h1>
            <p>
              {paid
                ? "Stripe test payment recorded. This is not a live merchant charge."
                : confirming
                  ? "Stripe accepted the test payment. The store is still confirming it; reload this page in a moment."
                  : `${orderStatusLabels[order.status]} · ${formatUsd(order.grandTotal)} USD.`}
              {canPay ? " Test mode only. Card numbers stay on Stripe." : null}
            </p>
            {error ? <p className="stack-hint" role="alert">{error}</p> : null}
          </div>
          <Link className="button button-outline" href={order.savedToAccount ? "/account" : "/"}>
            {order.savedToAccount ? "Your account" : "Back to home"}
          </Link>
        </div>

        <OrderSummaryCard order={paid ? { ...order, status: "paid" } : order} headingLevel={2} />

        {canPay ? (
          <div className="pay-actions">
            {order.payment === "element" ? (
              <CardPayment
                orderId={order.id}
                items={items}
                email={payer}
                onPaid={(recorded) => {
                  if (recorded && local) markPaid(order.id);
                  if (recorded) setPaid(true);
                  else setConfirming(true);
                }}
              />
            ) : (
              <button
                className="button button-primary"
                type="button"
                aria-busy={opening}
                onClick={async () => {
                  if (opening) return;
                  setOpening(true);
                  setError(null);
                  const result = await startHostedCheckout({ orderId: order.id, items, email: payer });
                  if (result.ok) {
                    window.location.assign(result.url);
                    return;
                  }
                  setOpening(false);
                  setError(result.error);
                }}
              >
                {opening ? "Opening Stripe…" : "Open Stripe test Checkout"}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PayBody({ message }: { message: string }) {
  return (
    <section className="stack-page section" aria-labelledby="pay-title">
      <div className="container">
        <h1 id="pay-title">Order</h1>
        <p role="status">{message}</p>
        <Link className="button button-outline" href="/account">
          Your orders
        </Link>
      </div>
    </section>
  );
}
