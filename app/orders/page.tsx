"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatPrice } from "../catalog";
import { useOrders } from "../order-context";
import {
  canCancel,
  canMarkCollected,
  canMarkPaid,
  isPending,
  orderStatusLabels,
  type OrderRecord,
} from "../order-record";
import { paymentMethodLabels, pickupCityLabels } from "../payment-methods";
import { fetchPaidOrderIds } from "../stripe-client";
import type { StaffAccess } from "../staff-session";
import { useCopyFeedback } from "../use-copy-feedback";

export default function OrdersPage() {
  const { orders, markPaid, markCollected, cancelOrder } = useOrders();
  const [access, setAccess] = useState<StaffAccess | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [refundsNeeded, setRefundsNeeded] = useState<Array<{ orderId: string; payments: number }>>([]);
  const pending = orders.filter((order) => isPending(order.status));
  const settled = orders.filter((order) => !isPending(order.status));

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/staff/session")
      .then((response) => response.json())
      .then((body: StaffAccess) => {
        if (!cancelled) {
          setAccess(body);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!access?.ok) {
      return;
    }
    let cancelled = false;
    void fetchPaidOrderIds().then(({ paid, refundsNeeded: refunds }) => {
      if (cancelled) {
        return;
      }
      paid.forEach((id) => markPaid(id));
      setRefundsNeeded(refunds);
    });
    return () => {
      cancelled = true;
    };
  }, [access, markPaid]);

  if (!access) {
    return (
      <section className="stack-page section">
        <div className="container">
          <h1>Pending orders</h1>
          <p>Checking staff access…</p>
        </div>
      </section>
    );
  }

  if (!access.ok && access.mode === "unconfigured") {
    return (
      <section className="stack-page section" aria-labelledby="orders-title">
        <div className="container">
          <h1 id="orders-title">Pending orders</h1>
          <p>
            Set STAFF_PASSWORD on the server before opening this queue outside
            localhost. Localhost stays open for software-first testing.
          </p>
        </div>
      </section>
    );
  }

  if (!access.ok) {
    return (
      <section className="stack-page section" aria-labelledby="orders-title">
        <div className="container">
          <p className="overline overline-accent">Owner queue</p>
          <h1 id="orders-title">Staff password</h1>
          <form
            className="stack-editor"
            onSubmit={async (event) => {
              event.preventDefault();
              setLoginError(null);
              const response = await fetch("/api/staff/session", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ password }),
              });
              const body = (await response.json()) as StaffAccess & { error?: string };
              if (!response.ok) {
                setLoginError(body.error || "Could not sign in.");
                return;
              }
              setAccess({ ok: true, mode: "password" });
            }}
          >
            <label className="form-field" htmlFor="staff-password">
              <span>Password</span>
              <input
                id="staff-password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {loginError ? <p className="stack-hint">{loginError}</p> : null}
            <button className="button button-primary" type="submit">
              Open queue
            </button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="stack-page section" aria-labelledby="orders-title">
      <div className="container">
        <p className="overline overline-accent">Owner queue</p>
        <div className="stack-intro">
          <div>
            <h1 id="orders-title">Pending orders</h1>
            <p>
              Place-order confirmation is not paid. Match Banreservas, Popular,
              or Zelle credits to the order ID, then mark paid. Stripe test
              payments can mark paid through the return page or webhook ledger.
              Mark collected after the AZUL terminal or cash.
            </p>
          </div>
          <div className="stack-intro-actions">
            <Link className="button button-outline" href="/payments">
              Payment stack
            </Link>
            <Link className="button button-primary" href="/checkout">
              Open checkout
            </Link>
          </div>
        </div>

        {refundsNeeded.length ? (
          <div className="order-empty refund-notice" role="alert">
            <h2>Refund needed</h2>
            <p>
              More than one Stripe test payment succeeded for{" "}
              {refundsNeeded.map((entry) => `${entry.orderId} (${entry.payments} payments)`).join(", ")}.
              Refund the extra payment in the Stripe dashboard.
            </p>
          </div>
        ) : null}

        {orders.length === 0 ? (
          <div className="order-empty">
            <h2>No orders in this browser</h2>
            <p>
              Add a product, place a test order, then return here. This queue
              lists orders placed in this browser.
            </p>
            <Link className="button button-primary" href="/headphones">
              Browse headphones
            </Link>
          </div>
        ) : (
          <div className="order-board">
            <OrderGroup
              id="needs-action"
              title="Needs action"
              empty="No unpaid orders."
              orders={pending}
              onMarkPaid={markPaid}
              onMarkCollected={markCollected}
              onCancel={cancelOrder}
            />
            <OrderGroup
              id="settled"
              title="Settled"
              empty="No paid, collected, or cancelled orders yet."
              orders={settled}
              onMarkPaid={markPaid}
              onMarkCollected={markCollected}
              onCancel={cancelOrder}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function OrderGroup({
  id,
  title,
  empty,
  orders,
  onMarkPaid,
  onMarkCollected,
  onCancel,
}: {
  id: string;
  title: string;
  empty: string;
  orders: OrderRecord[];
  onMarkPaid: (id: string) => void;
  onMarkCollected: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <section className="order-group" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>
        {title} <span>{orders.length}</span>
      </h2>
      {orders.length === 0 ? (
        <p className="order-group-empty">{empty}</p>
      ) : (
        <ul className="order-list">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderCard
                order={order}
                onMarkPaid={onMarkPaid}
                onMarkCollected={onMarkCollected}
                onCancel={onCancel}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OrderCard({
  order,
  onMarkPaid,
  onMarkCollected,
  onCancel,
}: {
  order: OrderRecord;
  onMarkPaid: (id: string) => void;
  onMarkCollected: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const created = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(order.createdAt));

  return (
    <article className="order-card" aria-labelledby={`${order.id}-title`}>
      <header className="order-card-head">
        <div>
          <p className={`stack-status order-status is-${order.status}`}>
            {orderStatusLabels[order.status]}
          </p>
          <h3 id={`${order.id}-title`}>{order.id}</h3>
          <p>{created}</p>
        </div>
        <CopyButton value={order.id} />
      </header>

      <dl className="order-meta">
        <div>
          <dt>Method</dt>
          <dd>{paymentMethodLabels[order.payment]}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{formatPrice(order.grandTotal)}</dd>
        </div>
        <div>
          <dt>Customer</dt>
          <dd>
            {order.customer.name}
            <span>{order.customer.email}</span>
          </dd>
        </div>
        {order.payment === "in_person" && order.pickupCity ? (
          <div>
            <dt>Pickup</dt>
            <dd>{pickupCityLabels[order.pickupCity]}</dd>
          </div>
        ) : null}
      </dl>

      <ul className="order-lines">
        {order.lines.map((line) => (
          <li key={line.productId}>
            {line.name}
            <span>
              ×{line.quantity} · {formatPrice(line.unitPrice * line.quantity)}
            </span>
          </li>
        ))}
      </ul>

      {canMarkPaid(order) || canMarkCollected(order) || canCancel(order) ? (
        <div className="order-card-actions">
          {canMarkPaid(order) ? (
            <button className="button button-primary" type="button" onClick={() => onMarkPaid(order.id)}>
              Mark paid
            </button>
          ) : null}
          {order.status === "pending_hosted" ? (
            <Link className="button button-outline" href={`/checkout/pay?order=${encodeURIComponent(order.id)}`}>
              Pay with Stripe test
            </Link>
          ) : null}
          {canMarkCollected(order) ? (
            <button className="button button-primary" type="button" onClick={() => onMarkCollected(order.id)}>
              Mark collected
            </button>
          ) : null}
          {canCancel(order) ? (
            <button className="button button-outline" type="button" onClick={() => onCancel(order.id)}>
              Cancel order
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// Every press shows and announces something new; a blocked copy says so (catalog CPY1).
function CopyButton({ value }: { value: string }) {
  const copy = useCopyFeedback();

  return (
    <>
      <button type="button" className="copy-button" data-copy-state={copy.state} onClick={() => void copy.copy(value, `order ID ${value}`)}>
        {copy.state === "idle" ? "Copy ID" : copy.label}
      </button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{copy.message}</span>
    </>
  );
}
