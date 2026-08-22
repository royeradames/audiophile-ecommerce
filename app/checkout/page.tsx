"use client";

/* eslint-disable @next/next/no-img-element */

import { AnyFieldApi, useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { formatPrice, getProduct } from "../catalog";
import { checkoutTotals, DEMO_USD_TO_DOP, formatDopFromUsd, formatUsd } from "../checkout-totals";
import { useCart } from "../cart-context";
import { CardPayment } from "../card-payment";
import { useOrders } from "../order-context";
import { buildOrder } from "../order-record";
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
  { name: "address", label: "Address", type: "text", autoComplete: "street-address", placeholder: "1137 Sound Avenue", wide: true },
  { name: "zip", label: "ZIP code", type: "text", autoComplete: "postal-code", placeholder: "10001" },
  { name: "city", label: "City", type: "text", autoComplete: "address-level2", placeholder: "New York" },
  { name: "country", label: "Country", type: "text", autoComplete: "country-name", placeholder: "United States" },
] as const;

function requiredText(label: string) {
  return z.string().refine((value) => value.trim().length > 0, {
    error: `${label} is required.`,
  });
}

const checkoutSchema = z
  .object({
    name: requiredText("Name"),
    email: z.string().superRefine((value, ctx) => {
      if (!value.trim()) {
        ctx.addIssue({ code: "custom", message: "Email address is required." });
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(value)) {
        ctx.addIssue({ code: "custom", message: "Enter a valid email address." });
      }
    }),
    phone: requiredText("Phone number"),
    address: requiredText("Address"),
    zip: requiredText("ZIP code"),
    city: requiredText("City"),
    country: requiredText("Country"),
    payment: z.enum(paymentMethods),
    pickupCity: z.enum(["santo_domingo", "santiago", ""]),
  })
  .superRefine((value, ctx) => {
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
  });

type CheckoutValues = z.input<typeof checkoutSchema>;

type Confirmation = {
  total: number;
  orderId: string;
  payment: PaymentMethod;
  pickupCity: PickupCity | "";
  email: string;
  paid: boolean;
};

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
  const { items, clearCart } = useCart();
  const { addOrder, markPaid } = useOrders();
  const { settings } = usePayeeSettings();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
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
      setCanceled(new URLSearchParams(window.location.search).get("canceled") === "1");
    });
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
  const { subtotal, shipping, tax, grandTotal } = checkoutTotals(
    detailedItems.reduce((sum, line) => sum + line.product.price * line.quantity, 0),
  );
  const formattedTotal = formatUsd(grandTotal);

  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: checkoutSchema,
    },
    onSubmit: async ({ value }) => {
      setCheckoutError(null);
      const order = buildOrder({
        id: createOrderId(),
        createdAt: new Date().toISOString(),
        payment: value.payment,
        pickupCity: value.pickupCity === "" ? "" : value.pickupCity,
        customer: {
          name: value.name.trim(),
          email: value.email.trim(),
          phone: value.phone.trim(),
          address: value.address.trim(),
          zip: value.zip.trim(),
          city: value.city.trim(),
          country: value.country.trim(),
        },
        lines: detailedItems.map((line) => ({
          productId: line.product.productId,
          name: line.product.shortName,
          quantity: line.quantity,
          unitPrice: line.product.price,
        })),
        subtotal,
        shipping,
        vat: tax,
        grandTotal,
      });
      addOrder(order);

      if (value.payment === "hosted") {
        setRedirecting(true);
        const result = await startHostedCheckout({
          orderId: order.id,
          amount: order.grandTotal,
          email: order.customer.email,
          description: order.lines.map((line) => `${line.quantity}× ${line.name}`).join(", "),
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
        total: order.grandTotal,
        orderId: order.id,
        payment: order.payment,
        pickupCity: order.pickupCity,
        email: order.customer.email,
        paid: false,
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

  if (!detailedItems.length && confirmation === null) {
    return (
      <section className="checkout-page section">
        <div className="container narrow-empty">
          <p className="eyebrow">Checkout</p>
          <h1>Your cart is empty</h1>
          <p>Add a product before starting checkout. Your cart is saved only in this browser.</p>
          <Link className="button button-primary" href="/headphones">Browse headphones</Link>
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
                Catalog prices are USD. Shipping and 18% ITBIS are demo figures,
                not a live tax or FX quote. Hosted card and own card form use
                Stripe test mode when keys are on the server. DR bank transfer
                and Zelle stay unpaid until matched by hand. Pay in person uses
                a dedicated AZUL terminal in the Dominican Republic. Payee
                details come from the <Link href="/payments">payment stack</Link>.
              </p>
              {canceled ? (
                <p className="stack-hint">
                  Stripe test Checkout was canceled. The order stays unpaid in{" "}
                  <Link href="/orders">pending orders</Link>.
                </p>
              ) : null}
              {checkoutError ? <p className="stack-hint">{checkoutError}</p> : null}
            </div>

            <fieldset>
              <legend>Billing details</legend>
              <div className="form-grid">
                {fields.slice(0, 3).map((field) => (
                  <form.Field key={field.name} name={field.name}>
                    {(api) => <FormField field={api} spec={field} />}
                  </form.Field>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Shipping info</legend>
              <div className="form-grid">
                {fields.slice(3).map((field) => (
                  <form.Field key={field.name} name={field.name}>
                    {(api) => <FormField field={api} spec={field} />}
                  </form.Field>
                ))}
              </div>
            </fieldset>

            <fieldset>
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

            <button className="button button-primary button-block mobile-order-button" type="submit" disabled={redirecting}>
              {redirecting ? "Opening Stripe…" : `Place order · ${formattedTotal} USD`}
            </button>
          </form>

          <aside className="order-summary" aria-labelledby="summary-title">
            <h2 id="summary-title">Summary</h2>
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
              <div><dt>Demo ITBIS 18% (USD)</dt><dd>{formatUsd(tax)}</dd></div>
              <div className="grand-total"><dt>Grand total (USD)</dt><dd>{formatUsd(grandTotal)}</dd></div>
            </dl>
            <p className="stack-hint">
              Demo DOP equivalent at {DEMO_USD_TO_DOP} DOP / USD: {formatDopFromUsd(grandTotal)}.
              Not a live FX quote or tax filing.
            </p>
            <button className="button button-primary button-block desktop-order-button" type="submit" form="checkout-form" disabled={redirecting}>
              {redirecting ? "Opening Stripe…" : "Place order"}
            </button>
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
            <p>{confirmation.paid ? "Stripe test payment recorded. This is not a live merchant charge." : confirmationCopy(confirmation.payment)}</p>
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
            {confirmation.payment === "element" && !confirmation.paid ? (
              <CardPayment
                orderId={confirmation.orderId}
                amount={confirmation.total}
                email={confirmation.email}
                onPaid={() => {
                  markPaid(confirmation.orderId);
                  setConfirmation({ ...confirmation, paid: true });
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
                    amount: confirmation.total,
                    email: confirmation.email,
                    description: `Audiophile ${confirmation.orderId}`,
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
            <Link className="button button-outline button-block" href="/orders">
              Open pending orders
            </Link>
            <Link className="button button-primary button-block" href="/" onClick={() => setConfirmation(null)}>Back to home</Link>
          </section>
        </div>
      ) : null}
    </section>
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
    <label className={`form-field ${spec.wide ? "field-wide" : ""}`} htmlFor={spec.name}>
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
