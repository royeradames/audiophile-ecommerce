"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useOrders } from "../../order-context";
import { formatUsd } from "../../checkout-totals";
import { fetchStripePaymentIntent, fetchStripeSession } from "../../stripe-client";

export default function StripeReturnPage() {
  return (
    <Suspense fallback={<StripeReturnBody status="Preparing Stripe return…" />}>
      <StripeReturnClient />
    </Suspense>
  );
}

function StripeReturnClient() {
  const params = useSearchParams();
  const { markPaid, orders } = useOrders();
  const sessionId = params.get("session_id");
  const paymentIntentId = params.get("payment_intent");
  const requestedOrder = params.get("order");
  const [status, setStatus] = useState(
    sessionId || paymentIntentId
      ? "Checking the Stripe test payment…"
      : "No Stripe session was returned. The order stays unpaid.",
  );
  const [paid, setPaid] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(requestedOrder);

  useEffect(() => {
    if (!sessionId && !paymentIntentId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = sessionId
        ? await fetchStripeSession(sessionId)
        : await fetchStripePaymentIntent(paymentIntentId ?? "");
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      const id = result.orderId ?? requestedOrder;
      setOrderId(id);
      if (result.paid && id) {
        markPaid(id);
        setPaid(true);
        setStatus(`Stripe test payment recorded for ${id}. This is not a live AZUL or live Stripe merchant charge.`);
        return;
      }
      setStatus(`Stripe status is ${result.paymentStatus || "unpaid"}. The order stays pending.`);
    })();
    return () => {
      cancelled = true;
    };
  }, [markPaid, paymentIntentId, requestedOrder, sessionId]);

  const order = orders.find((item) => item.id === orderId);

  return (
    <StripeReturnBody
      status={status}
      paid={paid}
      orderId={orderId}
      total={order ? formatUsd(order.grandTotal) : null}
    />
  );
}

function StripeReturnBody({
  status,
  paid = false,
  orderId,
  total,
}: {
  status: string;
  paid?: boolean;
  orderId?: string | null;
  total?: string | null;
}) {
  return (
    <section className="stack-page section" aria-labelledby="stripe-return-title">
      <div className="container">
        <p className="overline overline-accent">{paid ? "Stripe test" : "Pending"}</p>
        <div className="stack-intro">
          <div>
            <h1 id="stripe-return-title">{paid ? "Test payment recorded" : "Stripe return"}</h1>
            <p>{status}</p>
            {orderId ? <p>Order {orderId}{total ? ` · ${total}` : ""}</p> : null}
          </div>
          <div className="stack-intro-actions">
            <Link className="button button-outline" href="/orders">
              Pending orders
            </Link>
            <Link className="button button-primary" href="/">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
