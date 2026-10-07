"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CardPayment } from "../../card-payment";
import { formatUsd } from "../../checkout-totals";
import { useOrders } from "../../order-context";
import { startHostedCheckout } from "../../stripe-client";
import { useState } from "react";

export default function CheckoutPayPage() {
  return (
    <Suspense fallback={<PayBody message="Loading the pending order…" />}>
      <CheckoutPayClient />
    </Suspense>
  );
}

function CheckoutPayClient() {
  const params = useSearchParams();
  const orderId = params.get("order");
  const { orders, markPaid } = useOrders();
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const order = orders.find((item) => item.id === orderId);

  if (!order) {
    return (
      <PayBody
        message="That order is not in this browser. Place it again from checkout, or open pending orders on the same device."
      />
    );
  }

  if (order.status !== "pending_hosted") {
    return (
      <PayBody
        message={`Order ${order.id} is ${order.status}. Card retry is only for pending card orders.`}
        orderId={order.id}
      />
    );
  }

  return (
    <section className="stack-page section" aria-labelledby="pay-title">
      <div className="container">
        <p className="overline overline-accent">Stripe test</p>
        <div className="stack-intro">
          <div>
            <h1 id="pay-title">Pay {order.id}</h1>
            <p>
              {formatUsd(order.grandTotal)} USD. Test mode only. Card numbers stay on Stripe.
            </p>
            {paid ? <p>Stripe test payment recorded. This is not a live merchant charge.</p> : null}
            {error ? <p className="stack-hint">{error}</p> : null}
          </div>
          <Link className="button button-outline" href="/orders">
            Pending orders
          </Link>
        </div>
        {paid ? null : order.payment === "element" ? (
          <CardPayment
            orderId={order.id}
            items={order.lines}
            email={order.customer.email}
            onPaid={() => {
              markPaid(order.id);
              setPaid(true);
            }}
          />
        ) : (
          <button
            className="button button-primary"
            type="button"
            onClick={async () => {
              const result = await startHostedCheckout({
                orderId: order.id,
                items: order.lines,
                email: order.customer.email,
              });
              if (result.ok) {
                window.location.assign(result.url);
                return;
              }
              setError(result.error);
            }}
          >
            Open Stripe test Checkout
          </button>
        )}
      </div>
    </section>
  );
}

function PayBody({ message, orderId }: { message: string; orderId?: string }) {
  return (
    <section className="stack-page section">
      <div className="container">
        <h1>{orderId ?? "Pay"}</h1>
        <p>{message}</p>
        <Link className="button button-outline" href="/orders">
          Pending orders
        </Link>
      </div>
    </section>
  );
}
