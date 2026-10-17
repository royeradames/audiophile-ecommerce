"use client";

/* eslint-disable @next/next/no-img-element */

import { AnyFieldApi, useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod/mini";
import en from "zod/v4/locales/en.js";
import { formatPrice, getProduct } from "../catalog";
import { checkoutTotals, DEMO_USD_TO_DOP, formatDopFromUsd, formatUsd } from "../checkout-totals";
import { useCart } from "../cart-context";
import { CardPayment } from "../card-payment";
import { useOrders } from "../order-context";
import { buildOrder, fromServerOrder, orderStatusLabels, type OrderRecord } from "../order-record";
import type { StoreFeatures } from "../order-api";
import { PaymentInstructions } from "../payment-instructions";
import {
  confirmationCopy,
  createOrderId,
  paymentMethodLabels,
  paymentMethods,
  pickupCityLabels,
  type PaymentMethod,
  type PickupCity,
} from "../payment-methods";
import { usePayeeSettings } from "../payee-context";
import { startHostedCheckout } from "../stripe-client";
import { createServerOrder, fetchCustomer, fetchStoreFeatures } from "../store-client";
import { sampleCheckoutDetails } from "../demo-store";
import type { PaymentRequest } from "../payment-request";

// Zod Mini loads no messages by default; English keeps built-in messages identical to classic Zod.
z.config(en());

const fieldOrder = [
  "name",
  "email",
  "phone",
  "address",
  "zip",
  "city",
  "country",
  "payment",
  "pickupCity",
] as const;

const fields = [
  { name: "name", label: "Name", type: "text", autoComplete: "name", placeholder: "Alex Morgan" },
  { name: "email", label: "Email address", type: "email", autoComplete: "email", placeholder: "alex@example.com" },
  { name: "phone", label: "Phone number", type: "tel", autoComplete: "tel", placeholder: "+1 202 555 0148" },
  { name: "address", label: "Address", type: "text", autoComplete: "address-line1", placeholder: "1137 Sound Avenue", wide: true },
  { name: "zip", label: "ZIP code", type: "text", autoComplete: "postal-code", placeholder: "10001" },
  { name: "city", label: "City", type: "text", autoComplete: "address-level2", placeholder: "New York" },
  { name: "country", label: "Country", type: "text", autoComplete: "country-name", placeholder: "United States" },
] as const;

function requiredText(label: string) {
  return z.string().check(z.refine((value) => value.trim().length > 0, {
    error: `${label} is required.`,
  }));
}

const checkoutSchema = z
  .object({
    name: requiredText("Name"),
    email: z.string().check(z.superRefine((value, ctx) => {
      if (!value.trim()) {
        ctx.addIssue({ code: "custom", message: "Email address is required." });
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(value)) {
        ctx.addIssue({ code: "custom", message: "Enter a valid email address." });
      }
    })),
    phone: requiredText("Phone number"),
    address: requiredText("Address"),
    zip: requiredText("ZIP code"),
    city: requiredText("City"),
    country: requiredText("Country"),
    payment: z.enum(paymentMethods),
    pickupCity: z.enum(["santo_domingo", "santiago", ""]),
  })
  .check(z.superRefine((value, ctx) => {
    if (value.payment !== "in_person") {
      return;
    }
    if (value.pickupCity !== "santo_domingo" && value.pickupCity !== "santiago") {
      ctx.addIssue({
        code: "custom",
        path: ["pickupCity"],
        message: "Choose Santo Domingo or Santiago.",
      });
    }
  }));

type CheckoutValues = z.input<typeof checkoutSchema>;

type Confirmation = {
  items: PaymentRequest["items"];
  total: number;
  orderId: string;
  payment: PaymentMethod;
  pickupCity: PickupCity | "";
  email: string;
  paid: boolean;
  /** Stripe accepted a payment the store has not confirmed yet. */
  confirming: boolean;
  /** Stored on the server, so its status link works in any browser. */
  durable: boolean;
  savedToAccount: boolean;
};

type CustomerBanner =
  | { state: "loading" }
  | { state: "coming_soon" }
  | { state: "signed_in"; name: string }
  | { state: "signed_out" }
  | { state: "unavailable" };

const defaultValues: CheckoutValues = {
  name: "",
  email: "",
  phone: "",
  address: "",
  zip: "",
  city: "",
  country: "",
  payment: "transfer",
  pickupCity: "",
};

function fieldErrorMessage(errors: unknown[]): string | undefined {
  for (const error of errors) {
    if (!error) {
      continue;
    }
    if (typeof error === "string") {
      return error;
    }
    if (Array.isArray(error)) {
      const nested = fieldErrorMessage(error);
      if (nested) {
        return nested;
      }
    } else if (typeof error === "object" && "message" in error) {
      const message = (error as { message: unknown }).message;
      if (typeof message === "string" && message) {
        return message;
      }
    }
  }
}

export default function CheckoutPage() {
  const { items, hydrated, clearCart } = useCart();
  const { addOrder, saveOrder, markPaid, orders } = useOrders();
  const { settings } = usePayeeSettings();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [returnedOrderId, setReturnedOrderId] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [features, setFeatures] = useState<StoreFeatures | null>(null);
  const [account, setAccount] = useState<CustomerBanner>({ state: "loading" });
  // One key per distinct submission: a retry after a lost response returns
  // the order the server already saved instead of creating a second one.
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const busy = saving || redirecting;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!confirmation) {
      return;
    }
    const panel = panelRef.current;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusable = () => {
      if (!panel) {
        return [];
      }
      return [...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !node.hasAttribute("disabled") && node.tabIndex !== -1);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmation(null);
        return;
      }
      if (event.key !== "Tab" || !panel) {
        return;
      }
      const nodes = focusable();
      if (!nodes.length) {
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const listed = nodes.includes(active as HTMLElement);
      if (event.shiftKey && (active === first || !listed)) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && (active === last || !listed)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      restore?.focus();
    };
  }, [confirmation]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      const params = new URLSearchParams(window.location.search);
      setCanceled(params.get("canceled") === "1");
      setReturnedOrderId(params.get("order"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let available: StoreFeatures;
      try {
        available = await fetchStoreFeatures();
      } catch {
        if (!cancelled) setAccount({ state: "unavailable" });
        return;
      }
      if (cancelled) return;
      setFeatures(available);
      if (available.accounts !== "enabled") {
        setAccount({ state: "coming_soon" });
        return;
      }
      try {
        const customer = await fetchCustomer();
        if (!cancelled) setAccount(customer ? { state: "signed_in", name: customer.name || customer.email } : { state: "signed_out" });
      } catch {
        if (!cancelled) setAccount({ state: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const detailedItems = useMemo(
    () =>
      items.flatMap((line) => {
        const product = getProduct(line.productId);
        return product ? [{ ...line, product }] : [];
      }),
    [items],
  );
  const { subtotal, shipping, vat, grandTotal } = checkoutTotals(
    detailedItems.reduce((sum, line) => sum + line.product.price * line.quantity, 0),
  );
  const formattedTotal = formatUsd(grandTotal);

  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: checkoutSchema,
    },
    onSubmit: async ({ value }) => {
      if (!hydrated || detailedItems.length === 0 || busy) return;
      setCheckoutError(null);
      const customer = {
        name: value.name.trim(),
        email: value.email.trim(),
        phone: value.phone.trim(),
        address: value.address.trim(),
        zip: value.zip.trim(),
        city: value.city.trim(),
        country: value.country.trim(),
      };
      const pickupCity: PickupCity | "" = value.payment === "in_person" ? value.pickupCity : "";
      const cart = detailedItems.map((line) => ({ productId: line.product.productId, quantity: line.quantity }));
      let available: StoreFeatures;
      try {
        available = features ?? await fetchStoreFeatures();
      } catch {
        setCheckoutError("The store could not be reached. Nothing was placed or charged; try again.");
        return;
      }

      let order: OrderRecord;
      let savedToAccount = false;
      if (available.durableOrders) {
        const fingerprint = JSON.stringify([value.payment, pickupCity, customer, cart]);
        if (submission.current?.fingerprint !== fingerprint) {
          submission.current = { fingerprint, key: crypto.randomUUID() };
        }
        setSaving(true);
        const saved = await createServerOrder({
          requestKey: submission.current.key,
          payment: value.payment,
          pickupCity,
          items: cart,
        });
        setSaving(false);
        if (!saved.ok) {
          setCheckoutError(saved.error);
          return;
        }
        submission.current = null;
        order = fromServerOrder(saved.order, customer);
        savedToAccount = saved.order.savedToAccount;
        saveOrder(order);
      } else {
        order = buildOrder({
          id: createOrderId(),
          createdAt: new Date().toISOString(),
          payment: value.payment,
          pickupCity,
          customer,
          lines: detailedItems.map((line) => ({
            productId: line.product.productId,
            name: line.product.shortName,
            quantity: line.quantity,
            unitPrice: line.product.price,
          })),
          subtotal,
          shipping,
          vat,
          grandTotal,
        });
        addOrder(order);
      }

      if (value.payment === "hosted") {
        setRedirecting(true);
        const result = await startHostedCheckout({
          orderId: order.id,
          items: cart,
          email: order.customer.email,
        });
        if (result.ok) {
          clearCart();
          window.location.assign(result.url);
          return;
        }
        setRedirecting(false);
        setCheckoutError(result.error);
      }

      setConfirmation({
        items: cart,
        total: order.grandTotal,
        orderId: order.id,
        payment: order.payment,
        pickupCity: order.pickupCity,
        email: order.customer.email,
        paid: false,
        confirming: false,
        durable: available.durableOrders,
        savedToAccount,
      });
      clearCart();
      requestAnimationFrame(() => headingRef.current?.focus());
    },
    onSubmitInvalid: ({ formApi }) => {
      const firstError = fieldOrder.find((name) => {
        const meta = formApi.getFieldMeta(name);
        return Boolean(meta?.errors.length);
      });
      if (firstError) {
        requestAnimationFrame(() => document.getElementById(firstError)?.focus());
      }
    },
  });

  const returnedOrder = orders.find((order) => order.id === returnedOrderId);

  if (hydrated && !detailedItems.length && confirmation === null) {
    return (
      <section className="checkout-page section">
        <div className="container">
          <div className="narrow-empty checkout-empty">
            <p className="eyebrow">Checkout</p>
            <h1>{canceled ? "Card checkout canceled" : "Your cart is empty"}</h1>
            {canceled ? (
              <CanceledCheckoutNotice order={returnedOrder} />
            ) : (
              <p>Add a product before starting checkout. Your cart is saved only in this browser.</p>
            )}
            <Link className="button button-primary" href="/headphones">Browse headphones</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="checkout-page section" aria-labelledby="checkout-title">
      <div className="container">
        <Link className="back-link" href="/">← Continue shopping</Link>
        <div className="checkout-layout">
          <form
            id="checkout-form"
            className="checkout-form"
            noValidate
            aria-busy={!hydrated}
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <div className="checkout-intro">
              <p className="overline overline-accent">Learning shop</p>
              <h1 id="checkout-title">Checkout</h1>
              <p>
                Catalog prices are USD and include 20% VAT. Shipping and VAT
                are demo figures, not a live tax or FX quote. Hosted card and
                own card form use Stripe test mode when keys are on the server. DR bank transfer
                and Zelle stay unpaid until matched by hand. Pay in person uses
                a dedicated AZUL terminal in the Dominican Republic. Payee
                details come from the <Link href="/payments">payment stack</Link>.
              </p>
              <div className="demo-checkout-note" role="note" aria-label="Demo store">
                <p>
                  <strong>Demo store:</strong> nothing is sold, charged or shipped. Test the whole
                  flow with fictional details and Stripe&apos;s test card.
                </p>
                <p>
                  The store saves the order and its total only. Your name, email, phone and
                  address stay in this browser; the store doesn&apos;t save them. Stripe&apos;s test
                  page may ask for an email and a name: use fictional ones.
                </p>
                <p>
                  To stop abuse, the store sets an anonymous session cookie and keeps a keyed
                  fingerprint of your connection for up to two days. Orders never paid are
                  deleted after 7 days.
                </p>
                <button
                  className="button button-outline"
                  type="button"
                  onClick={() => {
                    for (const [name, value] of Object.entries(sampleCheckoutDetails)) {
                      form.setFieldValue(name as keyof typeof sampleCheckoutDetails, value);
                    }
                  }}
                >
                  Fill sample details
                </button>
              </div>
              <AccountNotice account={account} />
              {canceled ? (
                <CanceledCheckoutNotice order={returnedOrder} />
              ) : null}
              {checkoutError ? <p className="stack-hint" role="alert">{checkoutError}</p> : null}
            </div>

            <fieldset disabled={!hydrated}>
              <legend>Billing details</legend>
              <div className="form-grid">
                {fields.slice(0, 3).map((field) => (
                  <form.Field key={field.name} name={field.name}>
                    {(api) => <FormField field={api} spec={field} />}
                  </form.Field>
                ))}
              </div>
            </fieldset>

            <fieldset disabled={!hydrated}>
              <legend>Shipping info</legend>
              <div className="form-grid">
                {fields.slice(3).map((field) => (
                  <form.Field key={field.name} name={field.name}>
                    {(api) => <FormField field={api} spec={field} />}
                  </form.Field>
                ))}
              </div>
            </fieldset>

            <fieldset disabled={!hydrated}>
              <legend>Payment details</legend>
              <form.Field name="payment">
                {(field) => (
                  <>
                    <div className="payment-options" role="radiogroup" aria-label="Payment method">
                      {paymentMethods.map((method) => (
                        <label key={method} className={field.state.value === method ? "selected" : ""}>
                          <input
                            type="radio"
                            name={field.name}
                            value={method}
                            checked={field.state.value === method}
                            onBlur={field.handleBlur}
                            onChange={() => {
                              field.handleChange(method);
                              if (method !== "in_person") {
                                form.setFieldValue("pickupCity", "");
                              }
                            }}
                          />
                          {paymentMethodLabels[method]}
                        </label>
                      ))}
                    </div>
                    <PaymentInstructions
                      method={field.state.value}
                      amount={formattedTotal}
                      orderId={null}
                      payee={settings}
                    />
                    {field.state.value === "in_person" ? (
                      <form.Field name="pickupCity">
                        {(pickup) => {
                          const error = fieldErrorMessage(pickup.state.meta.errors);
                          return (
                            <div className="pickup-city">
                              <p id="pickupCity-label">Pickup city</p>
                              <div
                                className="payment-options"
                                role="radiogroup"
                                aria-labelledby="pickupCity-label"
                                aria-invalid={Boolean(error)}
                                aria-describedby={error ? "pickupCity-error" : undefined}
                              >
                                {(Object.keys(pickupCityLabels) as PickupCity[]).map((city) => (
                                  <label key={city} className={pickup.state.value === city ? "selected" : ""}>
                                    <input
                                      id={city === "santo_domingo" ? "pickupCity" : undefined}
                                      type="radio"
                                      name={pickup.name}
                                      value={city}
                                      checked={pickup.state.value === city}
                                      onBlur={pickup.handleBlur}
                                      onChange={() => pickup.handleChange(city)}
                                    />
                                    {pickupCityLabels[city]}
                                  </label>
                                ))}
                              </div>
                              {error ? <small id="pickupCity-error">{error}</small> : null}
                            </div>
                          );
                        }}
                      </form.Field>
                    ) : null}
                  </>
                )}
              </form.Field>
            </fieldset>

            <button
              className="button button-primary button-block mobile-order-button"
              type="submit"
              disabled={!hydrated}
              aria-busy={busy}
            >
              {!hydrated ? "Loading cart…" : saving ? "Saving order…" : redirecting ? "Opening Stripe…" : `Place order · ${formattedTotal} USD`}
            </button>
          </form>

          <aside className="order-summary" aria-labelledby="summary-title">
            <h2 id="summary-title">Summary</h2>
            {hydrated ? (
              <>
                <ul className="summary-list">
                  {detailedItems.map(({ product, quantity }) => (
                    <li key={product.productId}>
                      <img src={product.cartImage} alt="" width="72" height="72" />
                      <div><strong>{product.shortName}</strong><span>{formatPrice(product.price)}</span></div>
                      <span>×{quantity}</span>
                    </li>
                  ))}
                </ul>
                <dl className="totals">
                  <div><dt>Subtotal (USD)</dt><dd>{formatUsd(subtotal)}</dd></div>
                  <div><dt>Demo shipping (USD)</dt><dd>{formatUsd(shipping)}</dd></div>
                  <div><dt>Demo VAT 20%, included (USD)</dt><dd>{formatUsd(vat)}</dd></div>
                  <div className="grand-total"><dt>Grand total (USD)</dt><dd>{formatUsd(grandTotal)}</dd></div>
                </dl>
                <p className="stack-hint">
                  Demo DOP equivalent at {DEMO_USD_TO_DOP} DOP / USD: {formatDopFromUsd(grandTotal)}.
                  Not a live FX quote or tax filing.
                </p>
                <button
                  className="button button-primary button-block desktop-order-button"
                  type="submit"
                  form="checkout-form"
                  disabled={!hydrated}
                  aria-busy={busy}
                >
                  {saving ? "Saving order…" : redirecting ? "Opening Stripe…" : "Place order"}
                </button>
              </>
            ) : (
              <p role="status">Loading your saved cart…</p>
            )}
          </aside>
        </div>
      </div>

      {confirmation ? (
        <div className="dialog-layer confirmation-layer">
          <section
            className="confirmation-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
            ref={panelRef}
          >
            <span className={`confirmation-mark ${confirmation.paid ? "is-paid" : "is-pending"}`} aria-hidden="true">
              {confirmation.paid ? "✓" : "•"}
            </span>
            <h2 id="confirmation-title" ref={headingRef} tabIndex={-1}>
              Order {confirmation.orderId}
            </h2>
            <p>
              {confirmation.paid
                ? "Stripe test payment recorded. This is not a live merchant charge."
                : confirmation.confirming
                  ? "Stripe accepted the test payment. The store is still confirming it; check the order status in a moment."
                  : confirmationCopy(confirmation.payment)}
            </p>
            {confirmation.savedToAccount ? (
              <p>Saved to your account. Find it under Account in any browser.</p>
            ) : confirmation.durable ? (
              <p>
                Saved on our server. Keep this link to check the order from any browser:{" "}
                <Link href={orderPath(confirmation.orderId)}>order {confirmation.orderId}</Link>.
              </p>
            ) : null}
            {confirmation.payment === "in_person" && confirmation.pickupCity ? (
              <p>Pickup in {pickupCityLabels[confirmation.pickupCity]}.</p>
            ) : null}
            <PaymentInstructions
              method={confirmation.payment}
              amount={formatUsd(confirmation.total)}
              orderId={confirmation.orderId}
              payee={settings}
              showPageLink={confirmation.payment !== "zelle"}
            />
            {confirmation.payment === "element" && !confirmation.paid && !confirmation.confirming ? (
              <CardPayment
                orderId={confirmation.orderId}
                items={confirmation.items}
                email={confirmation.email}
                onPaid={(recorded) => {
                  if (recorded) markPaid(confirmation.orderId);
                  setConfirmation({ ...confirmation, paid: recorded, confirming: !recorded });
                }}
              />
            ) : null}
            {confirmation.payment === "hosted" && checkoutError ? (
              <button
                className="button button-primary button-block"
                type="button"
                onClick={async () => {
                  setCheckoutError(null);
                  const result = await startHostedCheckout({
                    orderId: confirmation.orderId,
                    items: confirmation.items,
                    email: confirmation.email,
                  });
                  if (result.ok) {
                    window.location.assign(result.url);
                    return;
                  }
                  setCheckoutError(result.error);
                }}
              >
                Retry Stripe test Checkout
              </button>
            ) : null}
            {confirmation.payment === "zelle" ? (
              <Link
                className="button button-primary button-block"
                href={`/zelle?order=${encodeURIComponent(confirmation.orderId)}&amount=${encodeURIComponent(formatUsd(confirmation.total))}`}
              >
                Pay with Zelle
              </Link>
            ) : null}
            <div className="confirmation-total"><span>Total (USD)</span><strong>{formatUsd(confirmation.total)}</strong></div>
            {confirmation.durable ? (
              <Link className="button button-outline button-block" href={orderPath(confirmation.orderId)}>
                View order status
              </Link>
            ) : (
              <Link className="button button-outline button-block" href="/orders">
                Open pending orders
              </Link>
            )}
            <Link className="button button-primary button-block" href="/" onClick={() => setConfirmation(null)}>Back to home</Link>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function orderPath(orderId: string) {
  return `/checkout/pay?order=${encodeURIComponent(orderId)}`;
}

function AccountNotice({ account }: { account: CustomerBanner }) {
  switch (account.state) {
    case "loading":
      return null;
    case "coming_soon":
      return <p className="account-note">Customer accounts are coming soon. Guest checkout works today.</p>;
    case "signed_in":
      return <p className="account-note">Signed in as {account.name}. This order will be saved to your account.</p>;
    case "signed_out":
      return (
        <p className="account-note">
          Checking out as a guest. <Link href="/account">Sign in</Link> to save this order to your account.
        </p>
      );
    case "unavailable":
      return <p className="account-note">Your account could not be checked right now. Placing an order will try again.</p>;
  }
}

function CanceledCheckoutNotice({ order }: { order: OrderRecord | undefined }) {
  return (
    <div role="status">
      <p>Stripe test Checkout was canceled. Returning here does not mark an order paid.</p>
      {order?.status === "pending_hosted" ? (
        <>
          <p>Order {order.id} is still unpaid. You can retry its payment without placing another order.</p>
          <Link className="button button-primary" href={`/checkout/pay?order=${encodeURIComponent(order.id)}`}>
            Retry Stripe test payment
          </Link>
        </>
      ) : order ? (
        <p>Saved order {order.id}: {orderStatusLabels[order.status]}. This return did not change its status.</p>
      ) : (
        <p>The order is not available in this browser. Use the browser where you started checkout to find it, or return to browsing.</p>
      )}
    </div>
  );
}

function FormField({
  field,
  spec,
}: {
  field: AnyFieldApi;
  spec: { name: string; label: string; type: string; autoComplete: string; placeholder: string; wide?: boolean };
}) {
  const error = fieldErrorMessage(field.state.meta.errors);

  return (
    <label className={`form-field ${spec.wide ? "field-wide" : ""}`}>
      <span>{spec.label}</span>
      <input
        id={spec.name}
        name={field.name}
        type={spec.type}
        value={field.state.value}
        autoComplete={spec.autoComplete}
        placeholder={spec.placeholder}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${spec.name}-error` : undefined}
      />
      {error ? <small id={`${spec.name}-error`}>{error}</small> : null}
    </label>
  );
}
